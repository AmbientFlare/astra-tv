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

const tail = (detail: string) => ({
  traces: [{label: 'playback.error', detail, atMs: 1}],
  savedAtMs: 2,
  cleanExit: false,
});

describe('crash reports', () => {
  beforeEach(() => {
    mockStore.clear();
  });

  it('is on until the viewer turns it off', async () => {
    const api = require('../src/services/telemetry/crashReports');
    expect(await api.readCrashReportsEnabled()).toBe(true);
    await api.storeCrashReportsEnabled(false);
    expect(await api.readCrashReportsEnabled()).toBe(false);
    await api.storeCrashReportsEnabled(true);
    expect(await api.readCrashReportsEnabled()).toBe(true);
  });

  it('removes server addresses, credentials and emails', () => {
    const {
      scrubForCrashReport,
    } = require('../src/services/telemetry/crashReports');
    const out = scrubForCrashReport(
      'failed https://media.example.net:8920/Videos/abc/main.m3u8?api_key=s3cret ' +
        'at 192.168.1.20:8096 and [fe80::1:2:3:4] for me@example.com code=3016',
    );
    expect(out).not.toMatch(/example|192\.168|s3cret|fe80|me@/);
    expect(out).toContain('code=3016');
  });

  it('sends no account or session id, and the install id only when given', () => {
    const {crashReportBody} = require('../src/services/telemetry/crashReports');
    const body = crashReportBody(tail('see http://10.0.0.5/x'));
    expect(body).not.toHaveProperty('inst');
    expect(body).not.toHaveProperty('sid');
    expect(
      crashReportBody(tail('x'), '0123456789abcdef'),
    ).toHaveProperty('inst', '0123456789abcdef');
    expect(body.ev).toBe('app.crashtail');
    expect(body.model).toBe('AFTCA002');
    expect(body.d.traces[0].detail).toBe('see <url>');
  });

  it('sends the crash context with strings scrubbed', () => {
    const {crashReportBody} = require('../src/services/telemetry/crashReports');
    const body = crashReportBody({
      ...tail('x'),
      ctx: {
        screen: 'player',
        uptimeSec: 90,
        playback: {
          vcodec: 'hevc',
          ahead: 2.5,
          lastError: 'failed http://10.0.0.5:8096/x',
          deeper: {dropped: true},
        },
      },
    });
    expect(body.d.ctx).toEqual({
      screen: 'player',
      uptimeSec: 90,
      playback: {vcodec: 'hevc', ahead: 2.5, lastError: 'failed <url>'},
    });
  });

  it('reports delivery only when the endpoint accepts it', async () => {
    const {sendCrashReport} = require('../src/services/telemetry/crashReports');
    const fetchMock = jest.fn().mockResolvedValueOnce({ok: true});
    (global as unknown as {fetch: unknown}).fetch = fetchMock;
    expect(await sendCrashReport(tail('x'))).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://crash.watchastra.com/crash',
    );
    fetchMock.mockResolvedValueOnce({ok: false});
    expect(await sendCrashReport(tail('x'))).toBe(false);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await sendCrashReport(tail('x'))).toBe(false);
  });
});

describe('JS error capture', () => {
  it('writes the tail before the default handler ends the app', async () => {
    jest.resetModules();
    const order: string[] = [];
    let installedHandler: (e: unknown, fatal?: boolean) => void = () => {};
    (global as unknown as {ErrorUtils: unknown}).ErrorUtils = {
      getGlobalHandler: () => () => order.push('default'),
      setGlobalHandler: (h: typeof installedHandler) => {
        installedHandler = h;
      },
    };
    const {
      installJsErrorCapture,
    } = require('../src/services/telemetry/jsErrors');
    const {getTraces} = require('../src/services/logging/trace');
    installJsErrorCapture(async () => {
      order.push('persist');
    });
    installedHandler(new TypeError('x is undefined'), true);
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(['persist', 'default']);
    const last = getTraces().pop();
    expect(last.label).toBe('js.fatal');
    expect(last.detail).toContain('TypeError: x is undefined');
  });
});
