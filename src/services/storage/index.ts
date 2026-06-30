import {AsyncStorage} from '@amazon-devices/react-native-kepler';

export type ServerType = 'jellyfin' | 'kodi' | 'emby';

export interface ServerProfile {
  id: string;
  name: string;
  serverUrl: string;
  serverType: ServerType;
  username?: string;
  userId: string;
  accessToken: string;
  lastUsed: number;
}

interface ServerProfilesConfig {
  version: 1;
  servers: ServerProfile[];
}

interface AppStateConfig {
  isPro: boolean;
  launchCount: number;
  version: 1;
}

const STORAGE_KEY = 'astra.serverProfiles.v1';
const APP_STATE_KEY = 'astra.appState.v1';

const emptyConfig: ServerProfilesConfig = {
  version: 1,
  servers: [],
};

const emptyAppState: AppStateConfig = {
  isPro: false,
  launchCount: 0,
  version: 1,
};

const normalizeServerUrl = (serverUrl: string) =>
  serverUrl
    .trim()
    .replace(
      /^http:\/\/jelly2\.ambientflare\.art\/?$/i,
      'https://jelly2.ambientflare.art',
    );

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

const parseAppState = (rawState: string | null): AppStateConfig => {
  if (!rawState) {
    return emptyAppState;
  }

  try {
    const parsed = JSON.parse(rawState);

    if (parsed?.version !== 1) {
      return emptyAppState;
    }

    return {
      isPro: Boolean(parsed.isPro),
      launchCount: Number(parsed.launchCount) || 0,
      version: 1,
    };
  } catch {
    return emptyAppState;
  }
};

export const readAppState = async (): Promise<AppStateConfig> => {
  const rawState = await AsyncStorage.getItem(APP_STATE_KEY);
  return parseAppState(rawState);
};

export const writeAppState = async (
  state: Partial<AppStateConfig>,
): Promise<AppStateConfig> => {
  const currentState = await readAppState();
  const nextState: AppStateConfig = {
    ...currentState,
    ...state,
    isPro: Boolean(state.isPro ?? currentState.isPro),
    launchCount: Number(state.launchCount ?? currentState.launchCount) || 0,
    version: 1,
  };

  await AsyncStorage.setItem(APP_STATE_KEY, JSON.stringify(nextState));

  return nextState;
};

export const incrementLaunchCount = async (): Promise<number> => {
  const currentState = await readAppState();
  const launchCount = currentState.launchCount + 1;

  await writeAppState({launchCount});

  return launchCount;
};

export const setProStatus = async (isPro: boolean): Promise<void> => {
  await writeAppState({isPro});
};
