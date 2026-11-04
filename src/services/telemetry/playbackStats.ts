/**
 * Playback health and feature use, sent under the same Settings switch as
 * crash reports.
 *
 * Amazon tells us when Astra crashes, and nothing about the far more common
 * "it won't play" or "it keeps buffering". This module keeps one summary per
 * playback (what was asked of the stick, how long the picture took, stalls,
 * failures) and daily counts of the features people open, and sends them in
 * batches to the public endpoint.
 *
 * What never leaves the device: titles, item ids, search terms, server
 * addresses or names, account or Jellyfin ids, and anything finer than the
 * day an event happened on. The install id is random and changes every
 * calendar month, so it can tell one stick crashing thirty times from thirty
 * sticks crashing once, and cannot follow anyone for longer than that.
 *
 * The same facts are the crash context: the playback a crash happened in and
 * the last buffer sample, stored with the crash tail (crashTail.ts).
 */
import {APP_VERSION, BUILD_NUMBER} from '../../config/app';
import {readDeviceModel} from '../deviceModel';
import type {JellyfinStreamInfo} from '../jellyfin/types';
import {getItem, setItem} from '../storageAdapter';
import {STATS_ENDPOINT, TELEMETRY_REQUEST_TIMEOUT_MS} from './config';
import {scrubForCrashReport} from './crashReports';
import type {HeartbeatSample} from './heartbeat';

const INSTALL_KEY = 'astra.stats.install.v1';
const QUEUE_KEY = 'astra.stats.queue.v1';
const QUEUE_MAX = 200;
const SEND_BATCH = 50;
// Batches go out at launch, on background, and once this many have built up.
const SEND_AT = 20;
const SAVE_DELAY_MS = 2000;
// Vega OS can end a backgrounded app within a second of the switch, before a
// background handler gets to run, so an open playback saves itself as it goes.
const SNAPSHOT_EVERY_MS = 30000;
const ERROR_MAX = 160;

export type StatsEventName = 'app.launch' | 'playback' | 'usage';
export interface StatsEvent {
  ev: StatsEventName;
  /**
   * Random. A batch can be sent and then lost from storage when the OS kills
   * the app, so the same event may arrive twice; the last line per id wins.
   */
  id: string;
  /** UTC calendar day. Deliberately nothing finer. */
  day: string;
  d: Record<string, unknown>;
}

/** The features worth counting. A fixed list, so nothing free-form is sent. */
export type UsageName =
  | 'screen.home'
  | 'screen.library'
  | 'screen.detail'
  | 'screen.episodeDetail'
  | 'screen.player'
  | 'screen.music'
  | 'screen.musicArtist'
  | 'screen.musicAlbum'
  | 'screen.musicCollection'
  | 'screen.nowPlaying'
  | 'screen.search'
  | 'screen.settings'
  | 'screen.addServer'
  | 'screen.personDetail'
  | 'play.video'
  | 'play.live'
  | 'play.music'
  | 'syncplay.create'
  | 'syncplay.join';

const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
const clip = (text: string | undefined, max = 48) =>
  text === undefined ? undefined : scrubForCrashReport(text).slice(0, max);

let sending = false;
let enabled = false;
let queue: StatsEvent[] = [];
// Events at the front of the queue that are on their way; a count merged into
// one of them now would be lost when they are removed.
let inFlight = 0;
let loaded: Promise<void> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let install: {id: string; month: string} | undefined;
const startedAtMs = Date.now();
let memoryWarnings = 0;
let screen: string | undefined;

const randomId = (length = 16): string =>
  Array.from({length}, () => Math.floor(Math.random() * 16).toString(16)).join(
    '',
  );

/** Random, and replaced on the first use in each new calendar month. */
export const readMonthlyInstallId = async (
  now = Date.now(),
): Promise<string> => {
  const month = utcDay(now).slice(0, 7);
  if (install?.month === month) {
    return install.id;
  }
  try {
    const saved = JSON.parse((await getItem(INSTALL_KEY)) ?? 'null');
    if (saved?.month === month && /^[0-9a-f]{16}$/.test(saved.id)) {
      install = saved;
      return saved.id;
    }
  } catch {
    /* a fresh id below */
  }
  install = {id: randomId(), month};
  try {
    await setItem(INSTALL_KEY, JSON.stringify(install));
  } catch {
    /* still usable for this run */
  }
  return install.id;
};

const save = (): void => {
  if (saveTimer !== undefined) {
    clearTimeout(saveTimer);
  }
  saveTimer = undefined;
  void setItem(QUEUE_KEY, JSON.stringify(queue)).catch(() => undefined);
};
const saveSoon = (): void => {
  if (saveTimer === undefined) {
    saveTimer = setTimeout(save, SAVE_DELAY_MS);
  }
};

const validEvent = (value: unknown): value is StatsEvent => {
  const event = value as StatsEvent;
  return (
    Boolean(event) &&
    (event.ev === 'app.launch' ||
      event.ev === 'playback' ||
      event.ev === 'usage') &&
    typeof event.day === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(event.day) &&
    Boolean(event.d) &&
    typeof event.d === 'object'
  );
};

const load = (): Promise<void> => {
  loaded ??= (async () => {
    try {
      const raw = await getItem(QUEUE_KEY);
      const parsed = raw && raw.length < 256 * 1024 ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) {
        const saved = parsed.filter(validEvent).map((event) => ({
          ...event,
          id: typeof event.id === 'string' ? event.id : randomId(),
        }));
        // Events queued while this run was already counting come after.
        queue = [...saved, ...queue].slice(-QUEUE_MAX);
      }
    } catch {
      /* start empty */
    }
  })();
  return loaded;
};

const enqueue = (
  ev: StatsEventName,
  d: Record<string, unknown>,
  id = randomId(),
): void => {
  if (!enabled) {
    return;
  }
  // A playback's earlier snapshot that has not gone out yet is replaced.
  const unsent = queue.findIndex(
    (event, index) => index >= inFlight && event.id === id,
  );
  if (unsent >= 0) {
    queue.splice(unsent, 1);
  }
  queue.push({ev, id, day: utcDay(), d});
  if (queue.length > QUEUE_MAX) {
    const drop = queue.length - QUEUE_MAX;
    queue.splice(0, drop);
    inFlight = Math.max(0, inFlight - drop);
  }
  saveSoon();
  if (queue.length - inFlight >= SEND_AT) {
    void flushStats();
  }
};

/** Counts one use of a feature, merged into today's tally. */
export const countUsage = (name: UsageName): void => {
  if (!enabled) {
    return;
  }
  const day = utcDay();
  for (let i = queue.length - 1; i >= inFlight; i -= 1) {
    const event = queue[i];
    if (event.ev === 'usage' && event.day === day) {
      event.d[name] = ((event.d[name] as number) ?? 0) + 1;
      saveSoon();
      return;
    }
  }
  enqueue('usage', {[name]: 1});
};

export const flushStats = async (): Promise<boolean> => {
  if (!enabled || sending || !STATS_ENDPOINT) {
    return false;
  }
  sending = true;
  const abort =
    typeof AbortController === 'function' ? new AbortController() : undefined;
  const timer = setTimeout(() => abort?.abort(), TELEMETRY_REQUEST_TIMEOUT_MS);
  try {
    await load();
    // Last month's events would tie that month's id to this one's.
    const month = utcDay().slice(0, 7);
    const current = queue.filter((event) => event.day.startsWith(month));
    if (current.length !== queue.length) {
      queue = current;
      saveSoon();
    }
    if (!queue.length) {
      return true;
    }
    inFlight = Math.min(queue.length, SEND_BATCH);
    const batch = queue.slice(0, inFlight);
    const response = await fetch(STATS_ENDPOINT, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        v: 1,
        inst: await readMonthlyInstallId(),
        app: APP_VERSION,
        build: BUILD_NUMBER,
        ...readDeviceModel(),
        events: batch,
      }),
      signal: abort?.signal,
    });
    if (response.ok) {
      queue.splice(0, inFlight);
      save();
    }
    return response.ok;
  } catch {
    return false;
  } finally {
    inFlight = 0;
    clearTimeout(timer);
    sending = false;
  }
};

/**
 * Called by telemetry/index.ts with the Settings switch. `cleanExit` is how
 * the previous run ended (null when there is nothing to go on), which is how
 * crashes are counted per build without trusting Amazon's numbers.
 */
export const startStats = async (prior: {
  cleanExit: boolean | null;
}): Promise<void> => {
  enabled = true;
  await load();
  enqueue('app.launch', {cleanExit: prior.cleanExit});
  await flushStats();
};
export const stopStats = (): void => {
  enabled = false;
};
/** On background: keep what is queued, and try to send it. */
export const backgroundStats = (): void => {
  if (!enabled) {
    return;
  }
  if (playback) {
    snapshotPlayback(playback);
  }
  save();
  void flushStats();
};

export const noteScreen = (route: string): void => {
  screen = route.slice(0, 32);
  countUsage(`screen.${route}` as UsageName);
};
export const noteMemoryWarning = (): void => {
  memoryWarnings += 1;
};

// ---------------------------------------------------------------------------
// One playback, from opening the player to leaving it. Seeks and track
// changes reload the stream; they are counted here, not sent as new ones.
// ---------------------------------------------------------------------------
interface PlaybackRecord {
  id: string;
  openedAtMs: number;
  live: boolean;
  bitrateCapKbps?: number;
  serverVersion?: string;
  stream?: Record<string, unknown>;
  ttffMs?: number;
  sessions: number;
  watchedSec: number;
  bufferingSec: number;
  stalls: number;
  waiting: number;
  errors: number;
  dropped: number;
  decoded: number;
  lastError?: string;
  endedFailed: boolean;
  snapshotAtMs?: number;
}
let playback: PlaybackRecord | undefined;
let lastSample: HeartbeatSample | undefined;
const serverVersions = new Map<string, Promise<string | undefined>>();

const readServerVersion = (serverUrl: string): Promise<string | undefined> => {
  let version = serverVersions.get(serverUrl);
  if (!version) {
    version = (async () => {
      const abort =
        typeof AbortController === 'function'
          ? new AbortController()
          : undefined;
      const timer = setTimeout(
        () => abort?.abort(),
        TELEMETRY_REQUEST_TIMEOUT_MS,
      );
      try {
        const response = await fetch(
          `${serverUrl.replace(/\/+$/, '')}/System/Info/Public`,
          {signal: abort?.signal},
        );
        const info = (await response.json()) as {Version?: unknown};
        return typeof info.Version === 'string'
          ? clip(info.Version, 24)
          : undefined;
      } catch {
        return undefined;
      } finally {
        clearTimeout(timer);
      }
    })();
    serverVersions.set(serverUrl, version);
  }
  return version;
};

/** Opening the player. The handle ends this playback and no later one. */
export const beginPlayback = (options: {
  live: boolean;
  serverUrl: string;
}): object => {
  endPlayback();
  playback = {
    id: randomId(),
    openedAtMs: Date.now(),
    live: options.live,
    sessions: 0,
    watchedSec: 0,
    bufferingSec: 0,
    stalls: 0,
    waiting: 0,
    errors: 0,
    dropped: 0,
    decoded: 0,
    endedFailed: false,
  };
  lastSample = undefined;
  countUsage(options.live ? 'play.live' : 'play.video');
  if (enabled) {
    const record = playback;
    void readServerVersion(options.serverUrl).then((version) => {
      record.serverVersion = version;
    });
  }
  return playback;
};

const subtitleSummary = (stream: JellyfinStreamInfo): string => {
  if (stream.subtitleStreamIndex === undefined) {
    return 'off';
  }
  const track = stream.subtitleTracks.find(
    (candidate) => candidate.index === stream.subtitleStreamIndex,
  );
  return `${clip(track?.codec, 16) ?? 'unknown'}${
    stream.subtitleBurnIn ? '+burnin' : ''
  }`;
};

/** The stream the server handed back. A later reload replaces it. */
export const notePlaybackStream = (
  stream: JellyfinStreamInfo,
  bitrateCap?: number,
): void => {
  if (!playback) {
    return;
  }
  playback.bitrateCapKbps = bitrateCap
    ? Math.round(bitrateCap / 1000)
    : undefined;
  playback.stream = {
    method: stream.playMethod,
    reasons: stream.transcodeReasons?.slice(0, 8).map((r) => clip(r, 40)),
    container: clip(stream.sourceContainer ?? stream.container, 16),
    outContainer: clip(stream.outputContainer, 16),
    vcodec: clip(stream.sourceVideoCodec, 16),
    outVcodec: clip(stream.outputVideoCodec, 16),
    acodec: clip(stream.sourceAudioCodec, 16),
    outAcodec: clip(stream.outputAudioCodec, 16),
    range: clip(stream.sourceVideoRangeType, 24),
    width: stream.width,
    height: stream.height,
    bitrateKbps: stream.bitrate ? Math.round(stream.bitrate / 1000) : undefined,
    subs: subtitleSummary(stream),
    audioPolicy: clip(stream.audioTranscodePolicy, 24),
  };
};

/** The first time any session of this playback is ready to show a picture. */
export const notePlaybackReady = (): void => {
  if (playback && playback.ttffMs === undefined) {
    playback.ttffMs = Date.now() - playback.openedAtMs;
    snapshotPlayback(playback);
  }
};

/** The heartbeat's last reading, kept only as crash context. */
export const notePlaybackSample = (sample: HeartbeatSample): void => {
  lastSample = sample;
  if (
    playback &&
    Date.now() - (playback.snapshotAtMs ?? 0) >= SNAPSHOT_EVERY_MS
  ) {
    snapshotPlayback(playback);
  }
};

/**
 * One session's totals, from releaseMedia. Buffering time and frame counts
 * come from that session's player and are added up; the event counts are the
 * visit's running totals.
 */
export const notePlaybackSession = (session: {
  failed: boolean;
  watchedSec?: number;
  bufferingSec?: number;
  stalls?: number;
  waiting?: number;
  errors?: number;
  dropped?: number;
  decoded?: number;
  lastError?: string;
}): void => {
  if (!playback) {
    return;
  }
  const add = (value: number | undefined) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : 0;
  playback.sessions += 1;
  playback.watchedSec += add(session.watchedSec);
  playback.bufferingSec += add(session.bufferingSec);
  // The player keeps these three for the whole visit, not per session.
  playback.stalls = Math.max(playback.stalls, add(session.stalls));
  playback.waiting = Math.max(playback.waiting, add(session.waiting));
  playback.errors = Math.max(playback.errors, add(session.errors));
  playback.dropped += add(session.dropped);
  playback.decoded += add(session.decoded);
  playback.endedFailed = session.failed;
  if (session.lastError) {
    playback.lastError = clip(session.lastError, ERROR_MAX);
  }
};

const outcome = (record: PlaybackRecord): string =>
  record.ttffMs === undefined
    ? record.lastError || record.endedFailed
      ? 'failedStart'
      : 'abandonedStart'
    : record.endedFailed
    ? 'failedMidway'
    : 'played';

/**
 * Leaving the player. Sends the summary; safe to call more than once. With a
 * handle, only that playback ends, so a late call cannot end the next one.
 */
export const endPlayback = (handle?: object): void => {
  const record = playback;
  if (handle !== undefined && handle !== record) {
    return;
  }
  playback = undefined;
  lastSample = undefined;
  if (!record) {
    return;
  }
  enqueue('playback', playbackSummary(record, false), record.id);
};

/**
 * The playback so far, queued as open. If the app is ended before the viewer
 * leaves the player, this is what gets sent at the next launch.
 */
const snapshotPlayback = (record: PlaybackRecord): void => {
  record.snapshotAtMs = Date.now();
  enqueue('playback', playbackSummary(record, true), record.id);
};

const playbackSummary = (
  record: PlaybackRecord,
  open: boolean,
): Record<string, unknown> => ({
  outcome: outcome(record),
  open: open || undefined,
  live: record.live,
  ...record.stream,
  ttffMs: record.ttffMs,
  sessions: record.sessions,
  watchedMin: Math.round(record.watchedSec / 60),
  bufferingSec: Math.round(record.bufferingSec),
  stalls: record.stalls,
  waiting: record.waiting,
  errors: record.errors,
  dropRatio:
    record.decoded > 0
      ? Number((record.dropped / record.decoded).toFixed(4))
      : undefined,
  lastError: record.lastError,
  bitrateCapKbps: record.bitrateCapKbps,
  serverVersion: record.serverVersion,
});

/** What a crash report says about the moment it happened. */
export const crashContext = (): Record<string, unknown> => ({
  screen,
  uptimeSec: Math.round((Date.now() - startedAtMs) / 1000),
  memoryWarnings,
  playback: playback && {
    live: playback.live,
    ...playback.stream,
    ready: playback.ttffMs !== undefined,
    sessions: playback.sessions,
    serverVersion: playback.serverVersion,
    bitrateCapKbps: playback.bitrateCapKbps,
    ahead: lastSample?.ahead,
    buffering: lastSample?.buffering,
    paused: lastSample?.paused,
    bwKbps: lastSample?.bwEst ? Math.round(lastSample.bwEst / 1000) : undefined,
    decodedFrames: lastSample?.decodedFrames,
    droppedFrames: lastSample?.droppedFrames,
    rangeCount: lastSample?.rangeCount,
  },
});
