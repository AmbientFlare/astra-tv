import {getItem, removeItem, setItem} from './kvStore';

export {runStorageMigration} from './kvStore';

export type ServerType = 'jellyfin' | 'emby';

export interface ServerProfile {
  id: string;
  name: string;
  serverId?: string;
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

export interface DisplayPreferences {
  imageSize: 'small' | 'medium' | 'large';
  imageType: 'Primary' | 'Thumb' | 'Banner';
}

export interface PlaybackPreferences {
  version: 1;
  maxBitrateBps: number;
  maxAudioChannels: 2 | 3 | 4 | 6 | 8;
  preferredAudioLanguage: string;
  preferredSubtitleLanguage: string;
  subtitleMode: 'alwaysOn' | 'alwaysOff';
  seekDurationSeconds: number;
}

export interface UserPreferences {
  accountSortBy: 'lastUsed' | 'name';
  autoSignIn: 'disabled' | 'mostRecent';
  focusedBackdropEnabled: boolean;
  homeSections: {
    continueWatching: boolean;
    latestMovies: boolean;
    latestShows: boolean;
    myMedia: boolean;
    nextUp: boolean;
  };
  maxStreamingBitrate:
    | 'auto'
    | '20000000'
    | '12000000'
    | '8000000'
    | '4000000'
    | '2000000';
  nextEpisodeAutoplay: boolean;
  nextEpisodeCountdownSeconds: 10 | 15 | 30;
  preferredAudioLanguage: string;
  preferredSubtitleLanguage: string;
  seekDurationSeconds: 10 | 15 | 30 | 60;
  skipIntroCredits: 'ask' | 'auto' | 'ignore';
  subtitleMode: 'default' | 'alwaysOn' | 'alwaysOff' | 'forcedOnly';
}

const STORAGE_KEY = 'astra.serverProfiles.v1';
const DEVICE_ID_KEY = 'astra.deviceId.v1';
const APP_STATE_KEY = 'astra.appState.v1';
const DISPLAY_PREFERENCES_KEY = 'astra.displayPreferences.v1';
const USER_PREFERENCES_KEY = 'astra.userPreferences.v1';
const PLAYBACK_PREFS_KEY = 'astra.playbackPrefs.v1';

const emptyConfig: ServerProfilesConfig = {
  version: 1,
  servers: [],
};

const emptyAppState: AppStateConfig = {
  isPro: false,
  launchCount: 0,
  version: 1,
};

const defaultDisplayPreferences: DisplayPreferences = {
  imageSize: 'medium',
  imageType: 'Primary',
};

export const defaultUserPreferences: UserPreferences = {
  accountSortBy: 'lastUsed',
  autoSignIn: 'mostRecent',
  focusedBackdropEnabled: true,
  homeSections: {
    continueWatching: true,
    latestMovies: true,
    latestShows: true,
    myMedia: true,
    nextUp: true,
  },
  maxStreamingBitrate: 'auto',
  nextEpisodeAutoplay: false,
  nextEpisodeCountdownSeconds: 15,
  preferredAudioLanguage: 'English',
  preferredSubtitleLanguage: 'English',
  seekDurationSeconds: 10,
  skipIntroCredits: 'ask',
  subtitleMode: 'default',
};

export const defaultPlaybackPrefs: PlaybackPreferences = {
  version: 1,
  maxBitrateBps: 80000000,
  maxAudioChannels: 6,
  preferredAudioLanguage: 'en',
  preferredSubtitleLanguage: 'en',
  subtitleMode: 'alwaysOff',
  seekDurationSeconds: 10,
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
        serverId: server.serverId ?? server.id,
        serverUrl: normalizeServerUrl(server.serverUrl),
      })),
    };
  } catch {
    return emptyConfig;
  }
};

export const readServerProfiles = async (): Promise<ServerProfile[]> => {
  const rawConfig = await getItem(STORAGE_KEY);
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

  await setItem(STORAGE_KEY, JSON.stringify(config));
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
      serverId: profile.serverId ?? profile.id,
      serverUrl: normalizeServerUrl(profile.serverUrl),
    },
  ]);
};

export const markServerProfileUsed = async (
  profileId: string,
): Promise<ServerProfile | null> => {
  const profiles = await readServerProfiles();
  const profile = profiles.find(
    (savedProfile) => savedProfile.id === profileId,
  );

  if (!profile) {
    return null;
  }

  const updatedProfile = {...profile, lastUsed: Date.now()};

  await writeServerProfiles(
    profiles.map((savedProfile) =>
      savedProfile.id === profileId ? updatedProfile : savedProfile,
    ),
  );

  return updatedProfile;
};

export const getLastUsedServerProfile =
  async (): Promise<ServerProfile | null> => {
    const profiles = await readServerProfiles();

    return (
      profiles
        .filter((profile) => profile.accessToken)
        .sort((left, right) => right.lastUsed - left.lastUsed)[0] ?? null
    );
  };

export const clearServerProfiles = async (): Promise<void> => {
  await removeItem(STORAGE_KEY);
};

// Stable, unique-per-install device id. Jellyfin keys a session on
// (user, client, deviceId) and invalidates the previous token whenever a new
// login arrives with the SAME deviceId — so a fixed shared id makes installs
// (and dev tools) log each other out. Generated once and persisted.
export const getDeviceId = async (): Promise<string> => {
  const stored = await getItem(DEVICE_ID_KEY);
  if (stored) {
    return stored;
  }
  const generated = `astra-${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 12)}`;
  await setItem(DEVICE_ID_KEY, generated);
  return generated;
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
  const rawState = await getItem(APP_STATE_KEY);
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

  await setItem(APP_STATE_KEY, JSON.stringify(nextState));

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

export const getDisplayPreferences = async (): Promise<DisplayPreferences> => {
  const rawPreferences = await getItem(DISPLAY_PREFERENCES_KEY);

  if (!rawPreferences) {
    return defaultDisplayPreferences;
  }

  try {
    const parsed = JSON.parse(rawPreferences);

    return {
      imageSize: ['small', 'medium', 'large'].includes(parsed.imageSize)
        ? parsed.imageSize
        : defaultDisplayPreferences.imageSize,
      imageType: ['Primary', 'Thumb', 'Banner'].includes(parsed.imageType)
        ? parsed.imageType
        : defaultDisplayPreferences.imageType,
    };
  } catch {
    return defaultDisplayPreferences;
  }
};

export const setDisplayPreferences = async (
  preferences: DisplayPreferences,
): Promise<void> => {
  await setItem(
    DISPLAY_PREFERENCES_KEY,
    JSON.stringify({
      imageSize: preferences.imageSize,
      imageType: preferences.imageType,
    }),
  );
};

const parseUserPreferences = (
  rawPreferences: string | null,
): UserPreferences => {
  if (!rawPreferences) {
    return defaultUserPreferences;
  }

  try {
    const parsed = JSON.parse(rawPreferences);

    return {
      ...defaultUserPreferences,
      ...parsed,
      homeSections: {
        ...defaultUserPreferences.homeSections,
        ...(parsed.homeSections ?? {}),
      },
    };
  } catch {
    return defaultUserPreferences;
  }
};

export const getUserPreferences = async (): Promise<UserPreferences> => {
  const rawPreferences = await getItem(USER_PREFERENCES_KEY);
  return parseUserPreferences(rawPreferences);
};

export const setUserPreferences = async (
  preferences: UserPreferences,
): Promise<void> => {
  await setItem(USER_PREFERENCES_KEY, JSON.stringify(preferences));
};

export const updateUserPreferences = async (
  patch: Partial<UserPreferences>,
): Promise<UserPreferences> => {
  const current = await getUserPreferences();
  const next: UserPreferences = {
    ...current,
    ...patch,
    homeSections: {
      ...current.homeSections,
      ...(patch.homeSections ?? {}),
    },
  };

  await setUserPreferences(next);

  return next;
};

const coercePlaybackPrefs = (parsed: Partial<PlaybackPreferences>) => {
  const maxBitrateBps = Number(parsed.maxBitrateBps);
  const maxAudioChannels = Number(parsed.maxAudioChannels);
  const seekDurationSeconds = Number(parsed.seekDurationSeconds);

  const preferences: PlaybackPreferences = {
    version: 1,
    maxBitrateBps: [40000000, 80000000, 120000000, 200000000].includes(
      maxBitrateBps,
    )
      ? maxBitrateBps
      : defaultPlaybackPrefs.maxBitrateBps,
    maxAudioChannels: [2, 3, 4, 6, 8].includes(maxAudioChannels)
      ? (maxAudioChannels as PlaybackPreferences['maxAudioChannels'])
      : defaultPlaybackPrefs.maxAudioChannels,
    preferredAudioLanguage:
      typeof parsed.preferredAudioLanguage === 'string'
        ? parsed.preferredAudioLanguage
        : defaultPlaybackPrefs.preferredAudioLanguage,
    preferredSubtitleLanguage:
      typeof parsed.preferredSubtitleLanguage === 'string'
        ? parsed.preferredSubtitleLanguage
        : defaultPlaybackPrefs.preferredSubtitleLanguage,
    subtitleMode: ['alwaysOn', 'alwaysOff'].includes(parsed.subtitleMode ?? '')
      ? (parsed.subtitleMode as PlaybackPreferences['subtitleMode'])
      : defaultPlaybackPrefs.subtitleMode,
    seekDurationSeconds: [10, 15, 30, 60].includes(seekDurationSeconds)
      ? seekDurationSeconds
      : defaultPlaybackPrefs.seekDurationSeconds,
  };

  return preferences;
};

const parsePlaybackPreferences = (
  rawPreferences: string | null,
): PlaybackPreferences | null => {
  if (!rawPreferences) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawPreferences);

    if (parsed?.version !== 1) {
      return defaultPlaybackPrefs;
    }

    return coercePlaybackPrefs(parsed);
  } catch {
    return defaultPlaybackPrefs;
  }
};

const migrateLegacyPlaybackPreferences =
  async (): Promise<PlaybackPreferences> => {
    const legacy = await getUserPreferences();
    const migrated = coercePlaybackPrefs({
      maxBitrateBps:
        legacy.maxStreamingBitrate === 'auto'
          ? defaultPlaybackPrefs.maxBitrateBps
          : Number(legacy.maxStreamingBitrate),
      preferredAudioLanguage:
        legacy.preferredAudioLanguage === 'English'
          ? 'en'
          : legacy.preferredAudioLanguage,
      preferredSubtitleLanguage:
        legacy.preferredSubtitleLanguage === 'English'
          ? 'en'
          : legacy.preferredSubtitleLanguage,
      subtitleMode:
        legacy.subtitleMode === 'alwaysOn' ? 'alwaysOn' : 'alwaysOff',
      seekDurationSeconds: legacy.seekDurationSeconds,
    });

    await setItem(PLAYBACK_PREFS_KEY, JSON.stringify(migrated));

    return migrated;
  };

export const readPlaybackPreferences =
  async (): Promise<PlaybackPreferences> => {
    const rawPreferences = await getItem(PLAYBACK_PREFS_KEY);
    const parsed = parsePlaybackPreferences(rawPreferences);

    return parsed ?? migrateLegacyPlaybackPreferences();
  };

export const writePlaybackPreferences = async (
  prefs: Partial<PlaybackPreferences>,
): Promise<PlaybackPreferences> => {
  const current = await readPlaybackPreferences();
  const next = coercePlaybackPrefs({...current, ...prefs, version: 1});

  await setItem(PLAYBACK_PREFS_KEY, JSON.stringify(next));

  return next;
};

export const signOutServerProfile = async (
  profileId: string,
): Promise<void> => {
  const profiles = await readServerProfiles();

  await writeServerProfiles(
    profiles.map((profile) =>
      profile.id === profileId ? {...profile, accessToken: ''} : profile,
    ),
  );
};

export const removeServerProfile = async (profileId: string): Promise<void> => {
  const profiles = await readServerProfiles();

  await writeServerProfiles(
    profiles.filter((profile) => profile.id !== profileId),
  );
};
