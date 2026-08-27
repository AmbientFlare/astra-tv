import {
  clearNebulaSessionCache,
  detectNebulaCapabilities,
  hydrateNebulaHierarchy,
} from '../src/services/nebula';
import {ServerProfile} from '../src/services/storage';

const profile: ServerProfile = {
  accessToken: 'token',
  id: 'profile-1',
  lastUsed: 1,
  name: 'Test',
  serverUrl: 'https://media.example.com',
  serverType: 'jellyfin',
  userId: 'user-1',
  username: 'viewer',
};

const response = (body: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 404,
  text: async () => JSON.stringify(body),
});

beforeEach(() => {
  clearNebulaSessionCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('optional Nebula capability integration', () => {
  it('treats a missing plugin as an ordinary Jellyfin server', async () => {
    global.fetch = jest.fn(async () =>
      response({}, false),
    ) as unknown as typeof fetch;

    await expect(detectNebulaCapabilities(profile)).resolves.toBeNull();
    await expect(
      hydrateNebulaHierarchy(profile, {
        id: 'series-1',
        name: 'Show',
        type: 'Series',
      }),
    ).resolves.toBe(false);
  });

  it('deduplicates rapid focus and open hydration requests', async () => {
    global.fetch = jest.fn(async (url: string) =>
      url.includes('/Capabilities')
        ? response({
            apiVersion: 1,
            features: {
              hierarchyPrefetch: true,
              seasonHydration: true,
              seriesHydration: true,
            },
          })
        : response({state: 'Hydrated'}),
    ) as unknown as typeof fetch;
    const item = {id: 'series-1', name: 'Show', type: 'Series'};

    await detectNebulaCapabilities(profile);

    await Promise.all([
      hydrateNebulaHierarchy(profile, item),
      hydrateNebulaHierarchy(profile, item),
      hydrateNebulaHierarchy(profile, item),
    ]);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toContain(
      '/NebulaBridge/Hydrate/Series/series-1',
    );
  });

  it('ignores unsupported API revisions', async () => {
    global.fetch = jest.fn(async () =>
      response({apiVersion: 2, features: {hierarchyPrefetch: true}}),
    ) as unknown as typeof fetch;

    await expect(detectNebulaCapabilities(profile)).resolves.toBeNull();
  });
});
