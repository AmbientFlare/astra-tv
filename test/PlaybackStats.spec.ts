export {};

const mockStore = new Map<string, string>();
jest.mock('../src/services/storageAdapter', () => ({
  getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => {
    mockStore.set(k, v);
  }),
  removeItem: jest.fn(async (k: string) => {
    mockStore.delete(k);
  }),
}));
jest.mock('../src/services/deviceModel', () => ({
  readDeviceModel: () => ({model: 'AFTCA002', os: '2.0'}),
}));
jest.mock('../src/config/app', () => ({
  APP_VERSION: '1.7.0',
  BUILD_NUMBER: '2026110301',
}));

type Stats = typeof import('../src/services/telemetry/playbackStats');

const stream = {
  itemId: 'item-secret-id',
  playMethod: 'Transcode',
  transcodeReasons: ['VideoCodecNotSupported'],
  sourceContainer: 'mkv',
  outputContainer: 'ts',
  sourceVideoCodec: 'hevc',
  outputVideoCodec: 'h264',
  sourceAudioCodec: 'truehd',
  outputAudioCodec: 'aac',
  sourceVideoRangeType: 'HDR10',
  width: 3840,
  height: 2160,
  bitrate: 18_000_000,
  subtitleStreamIndex: 3,
  subtitleBurnIn: true,
  subtitleTracks: [{id: 's', index: 3, title: 'English', codec: 'PGSSUB'}],
  audioTracks: [],
  qualityOptions: [],
  url: 'https://jelly.example.net/videos/main.m3u8?api_key=s3cret',
};

let fetchMock: jest.Mock;
const sentBodies = () =>
  fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith('/usage'))
    .map(([, init]) => JSON.parse(init.body));

const load = (): Stats => {
  let api: Stats | undefined;
  jest.isolateModules(() => {
    api = require('../src/services/telemetry/playbackStats');
  });
  return api!;
};

describe('playback stats', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.useRealTimers();
    fetchMock = jest.fn(async (url: string) =>
      String(url).endsWith('/System/Info/Public')
        ? {ok: true, json: async () => ({Version: '10.11.2'})}
        : {ok: true},
    );
    (global as unknown as {fetch: unknown}).fetch = fetchMock;
  });

  it('keeps one install id for a month and makes a new one after', async () => {
    const api = load();
    const nov = Date.UTC(2026, 10, 3);
    const id = await api.readMonthlyInstallId(nov);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(await load().readMonthlyInstallId(Date.UTC(2026, 10, 29))).toBe(id);
    expect(await load().readMonthlyInstallId(Date.UTC(2026, 11, 1))).not.toBe(
      id,
    );
  });

  it('counts nothing while the switch is off', async () => {
    const api = load();
    api.countUsage('screen.search');
    const handle = api.beginPlayback({live: false, serverUrl: 'http://x'});
    api.endPlayback(handle);
    expect(await api.flushStats()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the launch, daily counts and one summary per playback', async () => {
    const api = load();
    await api.startStats({cleanExit: false});
    api.noteScreen('search');
    api.noteScreen('search');
    api.noteScreen('player');
    const handle = api.beginPlayback({
      live: false,
      serverUrl: 'http://192.168.1.20:8096',
    });
    await new Promise((r) => setTimeout(r, 0));
    api.notePlaybackStream(stream as never, 20_000_000);
    api.notePlaybackReady();
    api.notePlaybackSession({
      failed: false,
      watchedSec: 600,
      bufferingSec: 4,
      decoded: 1000,
      dropped: 10,
      stalls: 2,
    });
    // A seek reload: buffering and frames add, the visit's event counts do not.
    api.notePlaybackSession({
      failed: false,
      watchedSec: 300,
      bufferingSec: 1,
      decoded: 1000,
      dropped: 0,
      stalls: 3,
    });
    api.endPlayback(handle);
    api.endPlayback(handle);
    expect(await api.flushStats()).toBe(true);

    const bodies = sentBodies();
    const events = bodies.flatMap((b) => b.events);
    expect(bodies[0].inst).toMatch(/^[0-9a-f]{16}$/);
    expect(bodies[0].model).toBe('AFTCA002');
    expect(events[0]).toMatchObject({ev: 'app.launch', d: {cleanExit: false}});
    const usage = events.find((e) => e.ev === 'usage');
    expect(usage.d).toMatchObject({
      'screen.search': 2,
      'screen.player': 1,
      'play.video': 1,
    });
    const playback = events.filter((e) => e.ev === 'playback');
    expect(playback).toHaveLength(1);
    expect(playback[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(playback[0].d).toMatchObject({
      outcome: 'played',
      method: 'Transcode',
      vcodec: 'hevc',
      range: 'HDR10',
      height: 2160,
      subs: 'PGSSUB+burnin',
      bitrateCapKbps: 20000,
      watchedMin: 15,
      bufferingSec: 5,
      stalls: 3,
      sessions: 2,
      dropRatio: 0.005,
      serverVersion: '10.11.2',
    });
    const text = JSON.stringify(bodies);
    expect(text).not.toMatch(/item-secret-id|example|s3cret|192\.168|English/);
    expect(mockStore.get('astra.stats.queue.v1')).toBe('[]');
  });

  it('calls a playback that never showed a picture a failed start', async () => {
    const api = load();
    await api.startStats({cleanExit: true});
    const handle = api.beginPlayback({live: true, serverUrl: 'http://x'});
    api.notePlaybackSession({
      failed: true,
      lastError: 'shaka 4032 at http://10.0.0.5:8096/x',
    });
    api.endPlayback(handle);
    await api.flushStats();
    const playback = sentBodies()
      .flatMap((b) => b.events)
      .find((e) => e.ev === 'playback');
    expect(playback.d).toMatchObject({outcome: 'failedStart', live: true});
    expect(playback.d.lastError).toBe('shaka 4032 at <url>');
  });

  it('keeps events when the endpoint is down and drops last month', async () => {
    const api = load();
    fetchMock.mockImplementation(async () => {
      throw new Error('offline');
    });
    await api.startStats({cleanExit: null});
    expect(JSON.parse(mockStore.get('astra.stats.queue.v1') ?? '[]')).toEqual(
      [],
    );
    api.countUsage('play.music');
    expect(await api.flushStats()).toBe(false);
    api.backgroundStats();
    const kept = JSON.parse(mockStore.get('astra.stats.queue.v1')!);
    expect(kept.map((e: {ev: string}) => e.ev)).toEqual([
      'app.launch',
      'usage',
    ]);

    mockStore.set(
      'astra.stats.queue.v1',
      JSON.stringify([{ev: 'usage', day: '2020-01-01', d: {'play.music': 9}}]),
    );
    const next = load();
    fetchMock.mockImplementation(async () => ({ok: true}));
    await next.startStats({cleanExit: true});
    const events = sentBodies().flatMap((b) => b.events);
    expect(events.map((e) => e.day)).not.toContain('2020-01-01');
  });

  it('sends an open playback on background, then the final under its id', async () => {
    const api = load();
    await api.startStats({cleanExit: true});
    const handle = api.beginPlayback({live: false, serverUrl: 'http://x'});
    api.notePlaybackReady();
    api.notePlaybackSession({failed: false, watchedSec: 120});
    api.backgroundStats();
    await new Promise((r) => setTimeout(r, 0));
    api.notePlaybackSession({failed: false, watchedSec: 120});
    api.endPlayback(handle);
    await api.flushStats();
    const playback = sentBodies()
      .flatMap((b) => b.events)
      .filter((e) => e.ev === 'playback');
    expect(playback).toHaveLength(2);
    expect(playback[0].id).toBe(playback[1].id);
    expect(playback[0].d).toMatchObject({open: true, watchedMin: 2});
    expect(playback[1].d.open).toBeUndefined();
    expect(playback[1].d.watchedMin).toBe(4);
  });

  it('sends an open playback at the next launch when the app was killed', async () => {
    const api = load();
    fetchMock.mockImplementation(async () => {
      throw new Error('offline');
    });
    await api.startStats({cleanExit: true});
    api.beginPlayback({live: false, serverUrl: 'http://x'});
    api.notePlaybackReady();
    // Killed here: no endPlayback, no background. The queue save is delayed.
    await new Promise((r) => setTimeout(r, 2100));
    fetchMock.mockImplementation(async () => ({ok: true}));
    await load().startStats({cleanExit: false});
    const playback = sentBodies()
      .flatMap((b) => b.events)
      .filter((e) => e.ev === 'playback');
    expect(playback).toHaveLength(1);
    expect(playback[0].d).toMatchObject({outcome: 'played', open: true});
  });

  it('gives every event an id, including ones saved by an older build', async () => {
    mockStore.set(
      'astra.stats.queue.v1',
      JSON.stringify([
        {ev: 'usage', day: new Date().toISOString().slice(0, 10), d: {}},
      ]),
    );
    const api = load();
    await api.startStats({cleanExit: true});
    const events = sentBodies().flatMap((b) => b.events);
    expect(events).toHaveLength(2);
    for (const event of events) {
      expect(event.id).toMatch(/^[0-9a-f]{16}$/);
    }
    expect(events[0].id).not.toBe(events[1].id);
  });

  it('puts the playback a crash happened in into the crash context', async () => {
    const api = load();
    api.noteScreen('player');
    api.noteMemoryWarning();
    api.beginPlayback({live: false, serverUrl: 'http://x'});
    api.notePlaybackStream(stream as never);
    api.notePlaybackSample({ahead: 12.5, buffering: false, droppedFrames: 3});
    const ctx = api.crashContext();
    expect(ctx).toMatchObject({screen: 'player', memoryWarnings: 1});
    expect(ctx.playback).toMatchObject({
      vcodec: 'hevc',
      ahead: 12.5,
      ready: false,
      droppedFrames: 3,
    });
  });
});

describe('setup failure kinds', () => {
  it('buckets errors without keeping their text', () => {
    const {setupFailKind} = require('../src/services/telemetry/playbackStats');
    const {ServerResponseError} = require('../src/services/jellyfin/http');
    const named = (name: string) => Object.assign(new Error('x'), {name});
    expect(setupFailKind(new ServerResponseError('x', 401))).toBe('wrongLogin');
    expect(setupFailKind(new ServerResponseError('x', 404))).toBe('notFound');
    expect(setupFailKind(new ServerResponseError('x', 502))).toBe(
      'serverError',
    );
    expect(setupFailKind(named('AbortError'))).toBe('timeout');
    expect(setupFailKind(new TypeError('Network request failed'))).toBe(
      'unreachable',
    );
    expect(setupFailKind(new SyntaxError('JSON'))).toBe('notJellyfin');
    expect(setupFailKind(named('SetupNoAddress'))).toBe('noAddress');
    expect(setupFailKind('weird')).toBe('other');
  });
});
