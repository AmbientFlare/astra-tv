jest.mock('../src/services/deviceIdentity', () => ({
  initializeDeviceIdentity: jest.fn(async () => 'test-installation'),
  getDeviceId: () => 'test-installation',
  getDeviceName: () => 'FireTV',
}));

import {
  getNebulaBridgeCapabilities,
  hydrateNebulaBridgeSeries,
  resetNebulaBridgeCapabilityCacheForTests,
} from '../src/services/nebulabridge';

const SERVER = 'https://media.example.com';
const TOKEN = 'token-123';
const USER = 'user-1';

const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});

afterEach(() => {
  resetNebulaBridgeCapabilityCacheForTests();
  jest.restoreAllMocks();
});

it('silently treats a missing endpoint as ordinary Jellyfin', async () => {
  global.fetch = jest.fn(async () =>
    response({}, 404),
  ) as unknown as typeof fetch;

  await expect(getNebulaBridgeCapabilities(SERVER, TOKEN, USER)).resolves.toBe(
    null,
  );
});

it('caches a capability result per server and user', async () => {
  const fetchMock = (global.fetch = jest.fn(async () =>
    response({
      apiVersion: 1,
      features: {hierarchyPrefetch: true, seriesHydration: true},
    }),
  ) as unknown as typeof fetch);

  await getNebulaBridgeCapabilities(SERVER, TOKEN, USER);
  await getNebulaBridgeCapabilities(`${SERVER}/`, TOKEN, USER);
  await getNebulaBridgeCapabilities(SERVER, TOKEN, 'user-2');

  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('does not hydrate when the plugin is disabled for this user', async () => {
  const fetchMock = (global.fetch = jest.fn(async () =>
    response({
      apiVersion: 1,
      availability: {available: false, hierarchyPrefetchAllowed: false},
      features: {hierarchyPrefetch: true, seriesHydration: true},
    }),
  ) as unknown as typeof fetch);

  await expect(
    hydrateNebulaBridgeSeries(SERVER, TOKEN, USER, 'series-1'),
  ).resolves.toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('hydrates only an advertised hierarchy feature through the optional API', async () => {
  const calls: Array<{method?: string; url: string}> = [];
  global.fetch = jest.fn(
    async (url: string, options: {method?: string} = {}) => {
      calls.push({method: options.method, url});
      return calls.length === 1
        ? response({
            apiVersion: 1,
            availability: {available: true, hierarchyPrefetchAllowed: true},
            features: {hierarchyPrefetch: true, seriesHydration: true},
          })
        : response({state: 'Hydrated'});
    },
  ) as unknown as typeof fetch;

  await expect(
    hydrateNebulaBridgeSeries(SERVER, TOKEN, USER, 'series-1'),
  ).resolves.toBe(true);

  expect(calls).toHaveLength(2);
  expect(calls[1]).toMatchObject({method: 'POST'});
  expect(calls[1].url).toContain('/nebulabridge/hydrate/series/series-1');
});
