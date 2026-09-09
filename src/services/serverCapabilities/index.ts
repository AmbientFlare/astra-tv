import {AsyncStorage} from '@amazon-devices/react-native-kepler';

import {capabilityNoticeWarranted, defaultServerCapabilities} from './defaults';
import {ServerCapabilities, VideoTranscodeCapability} from './types';

export type {
  CapabilitySource,
  ServerCapabilities,
  VideoTranscodeCapability,
} from './types';
export {
  TRANSCODE_PROBE_INTERVAL_MS,
  capabilityNoticeWarranted,
  defaultServerCapabilities,
  shouldAttemptServerTranscode,
  shouldProbeTranscode,
  shouldWarnForCapability,
  suppressesForcedTranscode,
} from './defaults';

const STORAGE_KEY = 'astra.serverCapabilities.v1';

interface CapabilitiesConfig {
  version: 1;
  servers: Record<string, ServerCapabilities>;
}

const emptyConfig: CapabilitiesConfig = {version: 1, servers: {}};

/**
 * What a server is filed under.
 *
 * The base URL, not the profile id: a profile id is `<server>:<user>`, and
 * whether a box has a GPU is a fact about the box rather than about who is
 * signed in to it. Keying by URL also means PlayerScreen -- which is handed a
 * server URL and no profile -- can read the same record the wizard wrote.
 */
export const serverCapabilityKey = (serverUrl: string): string =>
  serverUrl.trim().toLowerCase().replace(/\/+$/, '');

/**
 * Unknown values fall back to the default field by field rather than dropping
 * the whole record, so a future field added to this shape does not discard the
 * answers a user has already given.
 */
const parseCapabilities = (raw: string | null): CapabilitiesConfig => {
  if (!raw) return emptyConfig;

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || typeof parsed.servers !== 'object') {
      return emptyConfig;
    }

    const servers: Record<string, ServerCapabilities> = {};
    for (const [id, value] of Object.entries(
      parsed.servers as Record<string, Partial<ServerCapabilities>>,
    )) {
      if (!id || typeof value !== 'object' || value === null) continue;
      servers[id] = {...defaultServerCapabilities, ...value};
    }

    return {version: 1, servers};
  } catch {
    return emptyConfig;
  }
};

const readConfig = async (): Promise<CapabilitiesConfig> =>
  parseCapabilities(await AsyncStorage.getItem(STORAGE_KEY));

const writeConfig = async (config: CapabilitiesConfig): Promise<void> => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(config));
};

/**
 * Every answer is stored per server. Two servers on one device -- a NAS and a
 * GPU box, say -- have genuinely different answers, and the record for one
 * must never be read for the other. A server nobody has answered for gets the
 * defaults rather than another server's answers.
 */
export const getServerCapabilities = async (
  serverId: string,
): Promise<ServerCapabilities> => {
  if (!serverId) return defaultServerCapabilities;
  return (await readConfig()).servers[serverId] ?? defaultServerCapabilities;
};

export const updateServerCapabilities = async (
  serverId: string,
  patch: Partial<ServerCapabilities>,
): Promise<ServerCapabilities> => {
  if (!serverId) return defaultServerCapabilities;

  const config = await readConfig();
  const next: ServerCapabilities = {
    ...(config.servers[serverId] ?? defaultServerCapabilities),
    ...patch,
    updatedAtMs: Date.now(),
  };

  await writeConfig({
    version: 1,
    servers: {...config.servers, [serverId]: next},
  });

  return next;
};

/**
 * Record what playback proved. Called when a forced re-encode produced no
 * frames, which is the one observation that settles the question outright.
 *
 * Measurement outranks the stated answer, so this writes unconditionally; the
 * notice is raised only where the user was told something better, so that the
 * person whose GPU has fallen out of its container hears about it and the
 * person who already said "CPU only" is left alone.
 */
export const recordTranscodeFailure = async (
  serverId: string,
): Promise<ServerCapabilities> => {
  const current = await getServerCapabilities(serverId);

  return updateServerCapabilities(serverId, {
    videoTranscode: 'unable',
    videoTranscodeSource: 'detected',
    pendingCapabilityNotice:
      current.pendingCapabilityNotice ||
      capabilityNoticeWarranted(
        current.videoTranscode,
        current.videoTranscodeSource,
      ),
  });
};

/**
 * A server that re-encoded successfully is a server with working transcoding,
 * whatever it was previously believed to be. This is what makes a probe worth
 * running: it clears a stale `unable`, and it corrects a `cpu` or `unknown`
 * answer from someone who did not know what their server could do.
 *
 * Silent by design. Being told bad news you can act on is useful; being told
 * good news about a setting you never thought about is just a dialog. The new
 * answer shows in Settings as measured rather than stated.
 */
export const recordTranscodeSuccess = async (
  serverId: string,
  capability: VideoTranscodeCapability,
): Promise<void> => {
  if (capability === 'hardware') return;
  await updateServerCapabilities(serverId, {
    videoTranscode: 'hardware',
    videoTranscodeSource: 'detected',
  });
};

/**
 * Stamped when a forced attempt is actually made against a suppressed server,
 * not when one is merely scheduled: a probe the viewer backed out of before it
 * started has measured nothing and should not buy another week of silence.
 */
export const recordTranscodeProbe = async (serverId: string): Promise<void> => {
  await updateServerCapabilities(serverId, {
    lastTranscodeProbeAtMs: Date.now(),
  });
};

export const acknowledgeCapabilityNotice = async (
  serverId: string,
): Promise<void> => {
  await updateServerCapabilities(serverId, {pendingCapabilityNotice: false});
};

export const clearServerCapabilities = async (
  serverId: string,
): Promise<void> => {
  const config = await readConfig();
  if (!(serverId in config.servers)) return;

  const rest = Object.fromEntries(
    Object.entries(config.servers).filter(([id]) => id !== serverId),
  );
  await writeConfig({version: 1, servers: rest});
};

/**
 * Push a server's remembered answers into the live playback preferences.
 *
 * The device profile is built from a single set of preferences, so switching
 * servers has to restate that server's answers -- otherwise the NAS inherits
 * whatever the GPU box last asked for. Only fields a user actually answered
 * are applied; a server still on defaults leaves the current settings alone.
 */
export const applyServerCapabilities = async (
  serverId: string,
  writePrefs: (patch: {maxAudioChannels: 2 | 6}) => Promise<unknown>,
): Promise<ServerCapabilities> => {
  const capabilities = await getServerCapabilities(serverId);

  if (capabilities.maxAudioChannelsSource !== 'default') {
    await writePrefs({maxAudioChannels: capabilities.maxAudioChannels});
  }

  return capabilities;
};
