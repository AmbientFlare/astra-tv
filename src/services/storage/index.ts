import {AsyncStorage} from '@amazon-devices/react-native-kepler';

export type ServerType = 'jellyfin' | 'kodi' | 'emby';

export interface ServerProfile {
  id: string;
  name: string;
  serverUrl: string;
  serverType: ServerType;
  userId: string;
  accessToken: string;
  lastUsed: number;
}

interface ServerProfilesConfig {
  version: 1;
  servers: ServerProfile[];
}

const STORAGE_KEY = 'astra.serverProfiles.v1';

const emptyConfig: ServerProfilesConfig = {
  version: 1,
  servers: [],
};

const normalizeServerUrl = (serverUrl: string) => serverUrl.trim();

const parseConfig = (rawConfig: string | null): ServerProfilesConfig => {
  if (!rawConfig) {
    return emptyConfig;
  }

  try {
    const parsed = JSON.parse(rawConfig);

    if (parsed?.version !== 1 || !Array.isArray(parsed.servers)) {
      return emptyConfig;
    }

    return {
      version: 1,
      servers: parsed.servers.map((server: ServerProfile) => ({
        ...server,
        serverUrl: normalizeServerUrl(server.serverUrl),
      })),
    };
  } catch {
    return emptyConfig;
  }
};

export const readServerProfiles = async (): Promise<ServerProfile[]> => {
  const rawConfig = await AsyncStorage.getItem(STORAGE_KEY);
  return parseConfig(rawConfig).servers;
};

export const writeServerProfiles = async (
  servers: ServerProfile[],
): Promise<void> => {
  const config: ServerProfilesConfig = {
    version: 1,
    servers: servers.map((server) => ({
      ...server,
      serverUrl: normalizeServerUrl(server.serverUrl),
    })),
  };

  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(config));
};

export const upsertServerProfile = async (
  profile: ServerProfile,
): Promise<void> => {
  const profiles = await readServerProfiles();
  const nextProfiles = profiles.filter((server) => server.id !== profile.id);

  await writeServerProfiles([
    ...nextProfiles,
    {
      ...profile,
      lastUsed: profile.lastUsed || Date.now(),
      serverUrl: normalizeServerUrl(profile.serverUrl),
    },
  ]);
};

export const getLastUsedServerProfile =
  async (): Promise<ServerProfile | null> => {
    const profiles = await readServerProfiles();

    return (
      profiles.sort((left, right) => right.lastUsed - left.lastUsed)[0] ?? null
    );
  };

export const clearServerProfiles = async (): Promise<void> => {
  await AsyncStorage.removeItem(STORAGE_KEY);
};
