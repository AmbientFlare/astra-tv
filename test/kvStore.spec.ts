import type * as KvStoreModule from '../src/services/storage/kvStore';

// In-memory stand-ins for the two native stores. `mock`-prefixed so jest
// allows the mock factories below to reference them.
const mockNextStore = new Map<string, string>();
const mockLegacyStore = new Map<string, string>();
const mockState = {nextThrows: false};

jest.mock('@amazon-devices/react-native-async-storage__async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => {
      if (mockState.nextThrows) {
        throw new Error('native module unavailable');
      }
      return mockNextStore.has(key) ? (mockNextStore.get(key) as string) : null;
    },
    setItem: async (key: string, value: string) => {
      if (mockState.nextThrows) {
        throw new Error('native module unavailable');
      }
      mockNextStore.set(key, value);
    },
    removeItem: async (key: string) => {
      if (mockState.nextThrows) {
        throw new Error('native module unavailable');
      }
      mockNextStore.delete(key);
    },
  },
}));

jest.mock('@amazon-devices/react-native-kepler', () => ({
  AsyncStorage: {
    getItem: async (key: string) =>
      mockLegacyStore.has(key) ? (mockLegacyStore.get(key) as string) : null,
    setItem: async (key: string, value: string) => {
      mockLegacyStore.set(key, value);
    },
    removeItem: async (key: string) => {
      mockLegacyStore.delete(key);
    },
  },
}));

// Fresh module (fresh internal fallback flag) per test.
const loadKv = (): typeof KvStoreModule => {
  let mod: typeof KvStoreModule | undefined;
  jest.isolateModules(() => {
    mod = require('../src/services/storage/kvStore');
  });
  return mod as typeof KvStoreModule;
};

describe('kvStore', () => {
  beforeEach(() => {
    mockNextStore.clear();
    mockLegacyStore.clear();
    mockState.nextThrows = false;
  });

  it('copies existing legacy data into the new store once', async () => {
    mockLegacyStore.set(
      'astra.serverProfiles.v1',
      '{"version":1,"servers":["x"]}',
    );
    const kv = loadKv();

    await kv.runStorageMigration();

    expect(mockNextStore.get('astra.serverProfiles.v1')).toContain('"x"');
    expect(await kv.getItem('astra.serverProfiles.v1')).toContain('"x"');
  });

  it('never clobbers a value already in the new store', async () => {
    mockLegacyStore.set('astra.serverProfiles.v1', 'LEGACY');
    mockNextStore.set('astra.serverProfiles.v1', 'NEW');
    const kv = loadKv();

    await kv.runStorageMigration();

    expect(mockNextStore.get('astra.serverProfiles.v1')).toBe('NEW');
  });

  it('is a no-op on subsequent runs once the marker is set', async () => {
    mockLegacyStore.set('astra.appState.v1', 'A');
    const kv = loadKv();
    await kv.runStorageMigration();

    // Legacy changes and the new copy is wiped; a second run must not re-copy.
    mockLegacyStore.set('astra.appState.v1', 'B');
    mockNextStore.delete('astra.appState.v1');
    await kv.runStorageMigration();

    expect(mockNextStore.get('astra.appState.v1')).toBeUndefined();
  });

  it('falls back to the legacy store when the new one is unavailable', async () => {
    mockState.nextThrows = true;
    mockLegacyStore.set('astra.serverProfiles.v1', 'FROM_LEGACY');
    const kv = loadKv();

    expect(await kv.getItem('astra.serverProfiles.v1')).toBe('FROM_LEGACY');

    await kv.setItem('astra.appState.v1', 'written');
    expect(mockLegacyStore.get('astra.appState.v1')).toBe('written');
  });
});
