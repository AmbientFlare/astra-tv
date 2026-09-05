jest.mock('../src/services/telemetry/config', () => ({
  TELEMETRY_ENDPOINT: 'http://collector.test/ingest',
  TELEMETRY_TOKEN: 'token',
  TELEMETRY_MAX_BATCH: 40,
  TELEMETRY_QUEUE_CAPACITY: 400,
  TELEMETRY_FLUSH_INTERVAL_MS: 5000,
  TELEMETRY_REQUEST_TIMEOUT_MS: 4000,
  TELEMETRY_BACKOFF_START_MS: 15000,
  TELEMETRY_BACKOFF_MAX_MS: 300000,
}));

import {TelemetryTransport} from '../src/services/telemetry/transport';

const event = (ev = 'test', d?: Record<string, unknown>) =>
  ({
    v: 1,
    ts: 1,
    inst: 'i',
    app: 'a',
    build: 'b',
    ev,
    ...(d ? {d} : {}),
  } as any);

describe('TelemetryTransport', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('coalesces flush calls into one request', async () => {
    let resolve!: (r: any) => void;
    const pending = new Promise((r) => {
      resolve = r;
    });
    const fetchMock = jest.fn(() => pending);
    (global as any).fetch = fetchMock;
    const t = new TelemetryTransport();
    t.enqueue(event('a'));
    t.enqueue(event('b'));
    const first = t.flush();
    const second = t.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolve({ok: true, json: async () => ({accepted: 2})});
    await Promise.all([first, second]);
    expect(t.counters.sent).toBe(2);
  });

  it('honours a hard deadline when fetch ignores abort', async () => {
    const fetchMock = jest.fn(() => new Promise(() => undefined));
    (global as any).fetch = fetchMock;
    const t = new TelemetryTransport();
    t.enqueue(event(), true);
    const flush = t.flush();
    jest.advanceTimersByTime(4000);
    await flush;
    expect(t.counters.failed).toBe(1);
  });

  it('backs off at the retry deadline and requeues', async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('offline'));
    const t = new TelemetryTransport();
    t.enqueue(event(), true);
    await t.flush();
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(14999);
    await Promise.resolve();
    expect((global as any).fetch).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();
    expect((global as any).fetch).toHaveBeenCalledTimes(2);
  });

  it('does not mutate counters or queue after stop', async () => {
    let resolve!: (r: any) => void;
    (global as any).fetch = jest.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const t = new TelemetryTransport();
    t.enqueue(event(), true);
    const p = t.flush();
    t.stop();
    resolve({ok: true, json: async () => ({accepted: 1})});
    await p;
    expect(t.counters.sent).toBe(0);
    t.enqueue(event());
    expect(t.counters.queued).toBe(1); // stopped enqueue is ignored; initial enqueue counted
  });

  it('counts overflow, partial acknowledgements, and oversized Unicode events', async () => {
    (global as any).fetch = jest
      .fn()
      .mockResolvedValue({ok: true, json: async () => ({accepted: 1})});
    const delivered: any[] = [];
    const t = new TelemetryTransport({
      onDelivered: (e) => delivered.push(...e),
    });
    for (let i = 0; i < 401; i++) {
      t.enqueue(event(String(i)));
    }
    await t.flush();
    expect(t.counters.dropped).toBe(1);
    expect(t.counters.sent).toBe(1);
    expect(delivered).toHaveLength(1);
    const before = t.counters.dropped;
    t.enqueue(event('huge', {text: '😀'.repeat(20000)}));
    expect(t.counters.dropped).toBe(before + 1);
  });
});
