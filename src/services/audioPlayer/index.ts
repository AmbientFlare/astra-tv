/**
 * Music playback service.
 *
 * Wraps the Vega `AudioPlayer` and drives the pure queue model in
 * ../audioQueue. Everything here is informed by the 2026-07-27 device spike
 * (docs/music-support-notes.md); the non-obvious decisions are noted inline.
 *
 * Architecture note: this uses the in-UI `AudioPlayer` rather than a headless
 * player service. Background playback was measured working with this simpler
 * approach (audio advanced 35.1s across a 35s backgrounded gap), so the
 * headless runtime, its four extra packages and its separate-JS-context global
 * shims are all unnecessary.
 */
import {
  AudioContentType,
  AudioPlayer,
  AudioUsageType,
  KeplerMediaControlHandler,
} from '@amazon-devices/react-native-w3cmedia';
import {
  createQueue,
  currentTrack,
  cycleRepeat,
  enqueue,
  jumpTo,
  nextTrack,
  playNext,
  previousTrack,
  QueueState,
  removeAt,
  RepeatMode,
  setShuffle,
} from '../audioQueue';
import {
  getAudioHlsStreamUrl,
  getAudioStreamUrl,
  MusicSession,
  MusicTrack,
} from '../jellyfin/music';
import {isCleartextUrl} from '../serverUrl';

interface AdaptiveAudioPlayer {
  load(
    content: {
      drm_license_uri: string;
      drm_scheme: string;
      format: 'HLS';
      secure: boolean;
      uri: string;
    },
    autoplay: boolean,
  ): Promise<void>;
  unload(): Promise<void>;
}

/** Below this many seconds, "previous" means the previous track. */
const RESTART_THRESHOLD_SECONDS = 3;
/**
 * Seeking to exactly `duration` fires `ended` and advances the queue, which
 * makes a forward skip near the end look like an accidental track change.
 * Verified on device: `seek +10` from 207.99s on a 215.48s track ended it.
 */
const END_GUARD_SECONDS = 0.5;

export interface PlaybackStatus {
  durationSeconds: number;
  isBuffering: boolean;
  isPlaying: boolean;
  /** Set when playback gave up after repeated failures; cleared on success. */
  lastError: string | null;
  /** Redacted stream URL of the current track, for on-device diagnosis. */
  lastStreamUrl: string | null;
  /** Raw player readyState, so "playing but silent" is distinguishable. */
  readyState: number;
  positionSeconds: number;
  queue: QueueState;
  track: MusicTrack | null;
}

export type PlaybackListener = (status: PlaybackStatus) => void;

/**
 * How many consecutive load failures to tolerate before giving up.
 *
 * Without this, one bad URL walks the whole queue at speed: error -> advance ->
 * error -> advance, which looks to the user like every track is empty.
 */
const MAX_CONSECUTIVE_ERRORS = 3;

/**
 * Routes Kepler Media Controls commands to the service.
 *
 * Acquiring media control focus is not optional. Without it the platform
 * refuses to start playback and the player emits `error` immediately — which
 * presents as every track "playing" for zero seconds and skipping on.
 */
/**
 * Builds the media-control handler.
 *
 * The class is declared inside the factory rather than at module scope on
 * purpose: `KeplerMediaControlHandler` is a native-backed export that is not a
 * constructor outside a device runtime, so evaluating `extends` at import time
 * breaks anything that merely imports this module — including the test suite.
 * Declaring it lazily means the inheritance is only evaluated on a real device
 * at the point playback actually starts.
 */
const createControlHandler = (service: AudioPlaybackService) => {
  class PlaybackControlHandler extends KeplerMediaControlHandler {
    async handlePlay() {
      await service.resume();
    }

    async handlePause() {
      await service.pause();
    }

    async handleTogglePlayPause() {
      await service.togglePlayPause();
    }

    async handleNext() {
      await service.next();
    }

    async handlePrevious() {
      await service.previous();
    }

    async handleStop() {
      await service.pause();
    }

    async handleFastForward() {
      await service.seekBy(10);
    }

    async handleRewind() {
      await service.seekBy(-10);
    }

    async handleSkipForward() {
      await service.seekBy(10);
    }

    async handleSkipBackward() {
      await service.seekBy(-10);
    }

    async handleStartOver() {
      await service.seekTo(0);
    }
  }

  return new PlaybackControlHandler();
};

/**
 * Scheme, host and path of a stream URL, with the query dropped entirely.
 * The query contains an access token and these values are shown on screen.
 */
const describeStreamUrl = (url: string): string => {
  try {
    const parsed = new URL(url);

    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return url.split('?')[0];
  }
};

const emptyStatus = (queue: QueueState): PlaybackStatus => ({
  durationSeconds: 0,
  isBuffering: false,
  isPlaying: false,
  lastError: null,
  lastStreamUrl: null,
  positionSeconds: 0,
  readyState: 0,
  queue,
  track: currentTrack(queue),
});

export class AudioPlaybackService {
  private player: AudioPlayer | null = null;
  private adaptivePlayer: AdaptiveAudioPlayer | null = null;
  private session: MusicSession | null = null;
  private queue: QueueState = createQueue([]);
  private listeners = new Set<PlaybackListener>();
  private status: PlaybackStatus = emptyStatus(this.queue);
  /**
   * `ended` has been observed firing twice for a single track. Without this
   * guard the queue advances two entries and silently skips a song.
   */
  private advancing = false;
  private initializing: Promise<void> | null = null;
  private consecutiveErrors = 0;
  /**
   * Kepler component instance, needed to acquire media control focus. Supplied
   * by the UI because it comes from a React hook; playback cannot start
   * without it.
   */
  private componentInstance: unknown = null;

  // ------------------------------------------------------------- lifecycle

  setSession(session: MusicSession) {
    this.session = session;
  }

  setComponentInstance(componentInstance: unknown) {
    this.componentInstance = componentInstance;
  }

  /**
   * Creates the underlying player once. Declaring MUSIC/MEDIA rather than the
   * defaults is deliberate — these hints are the most plausible lever the
   * platform uses when deciding background and screensaver policy.
   */
  private async ensurePlayer(): Promise<AudioPlayer> {
    if (this.player) {
      return this.player;
    }

    if (!this.initializing) {
      this.initializing = (async () => {
        const player = new AudioPlayer(
          AudioContentType.CONTENT_TYPE_MUSIC,
          AudioUsageType.USAGE_MEDIA,
        );

        // Order matters: focus is acquired BEFORE initialize(), matching the
        // sequence proven on device. Without focus the platform refuses to
        // start playback and every track errors instantly.
        if (this.componentInstance) {
          await player.setMediaControlFocus(
            this.componentInstance as never,
            createControlHandler(this) as never,
          );
        } else {
          console.warn(
            '[Astra] No component instance for media control focus; ' +
              'playback will fail. Call setComponentInstance() first.',
          );
        }

        await player.initialize();
        this.attachEvents(player);
        player.autoplay = false;
        this.player = player;
      })();
    }

    await this.initializing;

    if (!this.player) {
      throw new Error('Audio player failed to initialize.');
    }

    return this.player;
  }

  private attachEvents(player: AudioPlayer) {
    player.addEventListener('playing', () => {
      this.consecutiveErrors = 0;
      this.patch({isBuffering: false, isPlaying: true});
    });
    player.addEventListener('pause', () => {
      this.patch({isPlaying: false});
    });
    player.addEventListener('waiting', () => {
      this.patch({isBuffering: true});
    });
    player.addEventListener('loadedmetadata', () => {
      const duration = player.duration;

      this.patch({
        // Some sources report NaN duration; surface 0 rather than rendering
        // "NaN" in the UI.
        durationSeconds: Number.isFinite(duration) ? duration : 0,
        isBuffering: false,
        readyState: player.readyState ?? 0,
      });
      player.play();
    });
    player.addEventListener('timeupdate', () => {
      this.patch({
        positionSeconds: player.currentTime ?? 0,
        readyState: player.readyState ?? 0,
      });
    });
    player.addEventListener('ended', () => {
      this.advance({auto: true});
    });
    player.addEventListener('error', () => {
      this.consecutiveErrors += 1;
      console.warn(
        `[Astra] Audio error on "${this.status.track?.name ?? 'unknown'}" ` +
          `(${this.consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}).`,
      );

      // Stop rather than racing through the rest of the queue. A run of
      // failures means something systemic (no media control focus, bad
      // credentials, server unreachable), not one unplayable file.
      if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        this.consecutiveErrors = 0;
        this.advancing = false;
        this.patch({
          isBuffering: false,
          isPlaying: false,
          lastError:
            'Playback failed. Check that the server is reachable and the ' +
            'track format is supported.',
        });
        return;
      }

      this.advance({auto: false});
    });
  }

  async dispose() {
    const player = this.player;
    const adaptivePlayer = this.adaptivePlayer;

    this.player = null;
    this.adaptivePlayer = null;
    this.initializing = null;
    this.listeners.clear();

    if (adaptivePlayer) {
      try {
        await adaptivePlayer.unload();
      } catch (error) {
        console.warn('[Astra] Failed to dispose adaptive audio player:', error);
      }
    }

    if (player) {
      try {
        await player.deinitialize();
      } catch (error) {
        console.warn('[Astra] Failed to dispose audio player:', error);
      }
    }
  }

  // -------------------------------------------------------------- observers

  subscribe(listener: PlaybackListener) {
    this.listeners.add(listener);
    listener(this.status);

    return () => {
      this.listeners.delete(listener);
    };
  }

  getStatus() {
    return this.status;
  }

  private patch(partial: Partial<PlaybackStatus>) {
    this.status = {...this.status, ...partial};
    this.listeners.forEach((listener) => listener(this.status));
  }

  private syncQueue(queue: QueueState) {
    this.queue = queue;
    this.patch({queue, track: currentTrack(queue)});
  }

  // --------------------------------------------------------------- playback

  /**
   * Replace the queue and start playing.
   *
   * `startIndex` is an index into `tracks` before shuffling, so "shuffle this
   * album starting from track 4" behaves sensibly.
   */
  async play(
    tracks: MusicTrack[],
    options: {repeat?: RepeatMode; shuffle?: boolean; startIndex?: number} = {},
  ) {
    if (!tracks.length) {
      return;
    }

    this.syncQueue(createQueue(tracks, options));
    await this.loadCurrent();
  }

  private async loadCurrent() {
    const session = this.session;
    const track = currentTrack(this.queue);

    if (!session || !track) {
      return;
    }

    const player = await this.ensurePlayer();

    this.patch({
      durationSeconds: 0,
      isBuffering: true,
      lastError: null,
      positionSeconds: 0,
      track,
    });

    const useHls = isCleartextUrl(session.serverUrl);
    const url = useHls
      ? getAudioHlsStreamUrl(session, track.id)
      : getAudioStreamUrl(session, track.id);

    // Origin + path only. The query carries the access token, and these
    // diagnostics get photographed and shared — a redacted query string is
    // still one regex slip away from leaking a live credential, and the scheme
    // and host are the only parts worth seeing anyway.
    this.patch({
      lastStreamUrl: `${describeStreamUrl(url)} [${useHls ? 'HLS' : 'direct'}]`,
    });
    this.advancing = false;

    if (this.adaptivePlayer) {
      await this.adaptivePlayer.unload();
      this.adaptivePlayer = null;
    }

    if (!useHls) {
      // Reassigning `src` on the live player is enough to change track —
      // proven on device across a 25-track queue.
      player.src = url;
      return;
    }

    // Vega's native media pipeline refuses cleartext URLs. Shaka fetches the
    // HLS manifest and segments in JavaScript and feeds the AudioPlayer via
    // MSE, the same path already proven by Astra's cleartext video playback.
    const {ShakaPlayer} = await import(
      '../../w3cmedia/shakaplayer/ShakaPlayer'
    );
    const adaptivePlayer: AdaptiveAudioPlayer = new ShakaPlayer(player, {
      secure: false,
      abrEnabled: false,
    });
    this.adaptivePlayer = adaptivePlayer;

    try {
      await adaptivePlayer.load(
        {
          uri: url,
          format: 'HLS',
          secure: false,
          drm_scheme: '',
          drm_license_uri: '',
        },
        false,
      );
    } catch (error) {
      if (this.adaptivePlayer === adaptivePlayer) {
        this.adaptivePlayer = null;
      }
      try {
        await adaptivePlayer.unload();
      } catch {
        // Preserve the load failure; unload is only best-effort cleanup.
      }
      const shakaError = error as {code?: number};
      console.warn(
        '[Astra] Adaptive audio load failed:',
        shakaError?.code ?? error,
      );
      this.patch({
        isBuffering: false,
        isPlaying: false,
        lastError: `HLS playback failed${
          shakaError?.code ? ` (stream error ${shakaError.code})` : ''
        }. Check that the server can transcode audio.`,
      });
    }
  }

  private async advance({auto}: {auto: boolean}) {
    if (this.advancing) {
      return;
    }

    this.advancing = true;

    const next = nextTrack(this.queue, {auto});

    if (!next) {
      // End of queue with repeat off.
      this.advancing = false;
      await this.pause();
      this.patch({isPlaying: false, positionSeconds: 0});
      return;
    }

    this.syncQueue(next);
    await this.loadCurrent();
  }

  async next() {
    await this.advance({auto: false});
  }

  /**
   * Standard music-player behaviour: part-way through a track, "previous"
   * restarts it; only near the start does it move to the previous track.
   */
  async previous() {
    const player = this.player;

    if (player && (player.currentTime ?? 0) > RESTART_THRESHOLD_SECONDS) {
      await this.seekTo(0);
      return;
    }

    const previous = previousTrack(this.queue);

    if (previous === this.queue) {
      await this.seekTo(0);
      return;
    }

    this.syncQueue(previous);
    await this.loadCurrent();
  }

  /** Move to the previous queue entry without the restart-current threshold. */
  async skipPrevious() {
    const previous = previousTrack(this.queue);

    if (previous === this.queue) {
      await this.seekTo(0);
      return;
    }

    this.syncQueue(previous);
    await this.loadCurrent();
  }

  async playAtPosition(position: number) {
    this.syncQueue(jumpTo(this.queue, position));
    await this.loadCurrent();
  }

  async resume() {
    const player = await this.ensurePlayer();
    player.play();
  }

  async pause() {
    this.player?.pause();
  }

  async togglePlayPause() {
    const player = this.player;

    if (!player) {
      return;
    }

    // With an MSE source Shaka owns part of the media lifecycle and
    // `AudioPlayer.paused` has proven stale on device. The playing/pause events
    // are the authoritative state for both direct and adaptive playback.
    if (this.status.isPlaying) {
      player.pause();
    } else {
      player.play();
    }
  }

  async stop() {
    this.player?.pause();
    if (this.adaptivePlayer) {
      const adaptivePlayer = this.adaptivePlayer;
      this.adaptivePlayer = null;
      try {
        await adaptivePlayer.unload();
      } catch (error) {
        console.warn('[Astra] Failed to unload stopped audio:', error);
      }
    }
    this.syncQueue(createQueue([]));
    this.patch({
      durationSeconds: 0,
      isBuffering: false,
      isPlaying: false,
      lastError: null,
      lastStreamUrl: null,
      positionSeconds: 0,
      readyState: 0,
    });
  }

  // ------------------------------------------------------------------ seek

  async seekTo(seconds: number) {
    const player = this.player;

    if (!player) {
      return;
    }

    const duration = player.duration;
    const upperBound = Number.isFinite(duration)
      ? Math.max(duration - END_GUARD_SECONDS, 0)
      : seconds;

    player.currentTime = Math.min(Math.max(seconds, 0), upperBound);
  }

  async seekBy(deltaSeconds: number) {
    const player = this.player;

    if (!player) {
      return;
    }

    await this.seekTo((player.currentTime ?? 0) + deltaSeconds);
  }

  // ----------------------------------------------------------- queue edits

  setShuffle(shuffle: boolean) {
    this.syncQueue(setShuffle(this.queue, shuffle));
  }

  toggleShuffle() {
    this.setShuffle(!this.queue.shuffle);
  }

  cycleRepeat() {
    this.syncQueue(cycleRepeat(this.queue));
  }

  setRepeat(repeat: RepeatMode) {
    this.syncQueue({...this.queue, repeat});
  }

  /** Append to the end of the queue. Starts playback if nothing is queued. */
  async addToQueue(tracks: MusicTrack[]) {
    const wasEmpty = this.queue.tracks.length === 0;

    this.syncQueue(enqueue(this.queue, tracks));

    if (wasEmpty && tracks.length) {
      await this.loadCurrent();
    }
  }

  async addNext(tracks: MusicTrack[]) {
    const wasEmpty = this.queue.tracks.length === 0;

    this.syncQueue(playNext(this.queue, tracks));

    if (wasEmpty && tracks.length) {
      await this.loadCurrent();
    }
  }

  removeFromQueue(position: number) {
    this.syncQueue(removeAt(this.queue, position));
  }
}

/**
 * Single shared instance. Playback must outlive any individual screen — the
 * user browses while music keeps playing — so this is module state rather than
 * React state.
 */
export const audioPlayback = new AudioPlaybackService();
