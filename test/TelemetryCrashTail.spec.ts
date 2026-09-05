export {};

const mockStore = new Map<string, string>();
const mockGetItem = jest.fn(async (k: string) => mockStore.get(k) ?? null);
const mockSetItem = jest.fn(async (k: string, v: string) => {
  mockStore.set(k, v);
});
const mockRemoveItem = jest.fn(async (k: string) => {
  mockStore.delete(k);
});
jest.mock('../src/services/storageAdapter', () => ({
  getItem: mockGetItem,
  setItem: mockSetItem,
  removeItem: mockRemoveItem,
}));
jest.mock('../src/services/logging/trace', () => ({
  getTraces: () => [{label: 'x', detail: 'token=secret', atMs: Date.now()}],
}));
jest.mock('../src/services/telemetry/envelope', () => ({
  scrubText: (s: string) => s.replace('secret', 'REDACTED'),
}));

describe('crash tail', () => {
  beforeEach(() => {
    jest.resetModules();
    mockStore.clear();
    jest.clearAllMocks();
  });
  it('persists scrubbed traces and returns prior tail once', async () => {
    mockStore.set(
      'astra.telemetry.crashtail.v1',
      JSON.stringify({
        traces: [{label: 'old', detail: 'd', atMs: Date.now()}],
        savedAtMs: Date.now(),
      }),
    );
    const api = require('../src/services/telemetry/crashTail');
    const prior = await api.prepareCrashTail();
    expect(prior.traces[0].label).toBe('old');
    await api.persistCrashTail('sid');
    expect(
      JSON.parse(mockStore.get('astra.telemetry.crashtail.v1')!).traces[0]
        .detail,
    ).toContain('REDACTED');
  });
  it('acknowledges only matching pending tail', async () => {
    const api = require('../src/services/telemetry/crashTail');
    const savedAtMs = Date.now();
    mockStore.set(
      'astra.telemetry.crashtail.v1',
      JSON.stringify({traces: [], savedAtMs}),
    );
    await api.prepareCrashTail();
    await api.acknowledgeCrashTail(savedAtMs);
    expect(mockStore.has('astra.telemetry.crashtail.pending.v1')).toBe(false);
  });
});
