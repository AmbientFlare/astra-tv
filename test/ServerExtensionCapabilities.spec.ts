import {
  clearServerExtensionSessionCache,
  detectServerExtensionCapabilities,
  hydrateServerExtensionHierarchy,
} from '../src/services/serverExtension';
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
  clearServerExtensionSessionCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('optional ServerExtension capability integration', () => {
  it('treats a missing plugin as an ordinary Jellyfin server', async () => {
    global.fetch = jest.fn(async () =>
      response({}, false),
    ) as unknown as typeof fetch;

    await expect(detectServerExtensionCapabilities(profile)).resolves.toBeNull();
    await expect(
      hydrateServerExtensionHierarchy(profile, {
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

    await detectServerExtensionCapabilities(profile);

    await Promise.all([
      hydrateServerExtensionHierarchy(profile, item),
      hydrateServerExtensionHierarchy(profile, item),
      hydrateServerExtensionHierarchy(profile, item),
    ]);

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect((global.fetch as jest.Mock).mock.calls[1][0]).toContain(
      '/astra-extension/Hydrate/Series/series-1',
    );
  });

  it('ignores unsupported API revisions', async () => {
    global.fetch = jest.fn(async () =>
      response({apiVersion: 2, features: {hierarchyPrefetch: true}}),
    ) as unknown as typeof fetch;

    await expect(detectServerExtensionCapabilities(profile)).resolves.toBeNull();
  });
});
