export {};

const mockStorage = new Map<string, string>();
const mockGetItem = jest.fn(
  async (key: string) => mockStorage.get(key) ?? null,
);
const mockSetItem = jest.fn(async (key: string, value: string) => {
  mockStorage.set(key, value);
});

jest.mock('@amazon-devices/react-native-kepler', () => ({
  AsyncStorage: {getItem: mockGetItem, setItem: mockSetItem},
}));

describe('persistent installation identity', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockStorage.clear();
    mockGetItem.mockImplementation(async (key) => mockStorage.get(key) ?? null);
    mockSetItem.mockImplementation(async (key, value) => {
      mockStorage.set(key, value);
    });
  });
  it('shares concurrent initialization and keeps the ID across process reloads', async () => {
    const first = require('../src/services/deviceIdentity');
    const [a, b] = await Promise.all([
      first.initializeDeviceIdentity(),
      first.initializeDeviceIdentity(),
    ]);
    expect(a).toBe(b);
    expect(mockSetItem).toHaveBeenCalledTimes(1);
    jest.resetModules();
    const next = require('../src/services/deviceIdentity');
    expect(await next.initializeDeviceIdentity()).toBe(a);
    mockStorage.clear();
    jest.resetModules();
    const another = require('../src/services/deviceIdentity');
    expect(await another.initializeDeviceIdentity()).not.toBe(a);
  });
  it('retries a failed persistence write without advertising a shared fallback', async () => {
    mockSetItem.mockRejectedValueOnce(new Error('storage unavailable'));
    const identity = require('../src/services/deviceIdentity');
    await expect(identity.initializeDeviceIdentity()).rejects.toThrow(
      'storage unavailable',
    );
    const id = await identity.initializeDeviceIdentity();
    expect(mockStorage.get('astra.deviceIdentity.v1')).toBe(id);
    expect(id).not.toBe('astra-device-001');
  });
  it('refreshes a saved-account header before its first API request and preserves JSON content type', async () => {
    mockStorage.set('astra.deviceIdentity.v1', 'persisted-installation');
    const {
      getAuthHeaders,
      getJson,
      reportPlaybackStopped,
    } = require('../src/services/jellyfin');
    global.fetch = jest.fn(async () => ({
      ok: true,
      text: async () => '',
    })) as any;
    await getJson('https://server/Sessions/Playing', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getAuthHeaders('test-token'),
      },
      body: '{}',
    });
    const headers = (global.fetch as jest.Mock).mock.calls[0][1].headers;
    expect(headers.Authorization).toContain(
      'DeviceId="persisted-installation"',
    );
    expect(headers['Content-Type']).toBe('application/json');
    await reportPlaybackStopped('https://server', 'test-token', {
      itemId: 'movie',
      positionTicks: 1,
      failed: true,
    });
    expect(
      JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body).Failed,
    ).toBe(true);
    const music = require('../src/services/jellyfin/music');
    const session = {
      serverUrl: 'https://server',
      userId: 'user',
      accessToken: 'test-token',
    };
    expect(
      new URL(music.getAudioStreamUrl(session, 'track')).searchParams.get(
        'DeviceId',
      ),
    ).toBe('persisted-installation');
    expect(
      new URL(music.getAudioHlsStreamUrl(session, 'track')).searchParams.get(
        'DeviceId',
      ),
    ).toBe('persisted-installation');
  });
  it('does not send a request if the installation ID cannot be persisted', async () => {
    mockSetItem.mockRejectedValueOnce(new Error('storage unavailable'));
    const {getJson} = require('../src/services/jellyfin');
    global.fetch = jest.fn();
    await expect(getJson('https://server')).rejects.toThrow(
      'storage unavailable',
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('propagates session cancellation to an in-flight network request', async () => {
    const {getJson} = require('../src/services/jellyfin');
    const identity = require('../src/services/deviceIdentity');
    await identity.initializeDeviceIdentity();
    global.fetch = jest.fn(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          );
        }),
    ) as any;
    const controller = new AbortController();
    const request = getJson('https://server', {signal: controller.signal});
    const rejected = expect(request).rejects.toThrow('aborted');
    await Promise.resolve();
    controller.abort();
    await rejected;
  });
});
