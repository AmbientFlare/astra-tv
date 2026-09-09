import type {
  JellyfinServerInfo,
  JellyfinAuthResult,
  QuickConnectInitiateResult,
} from './types';
import {
  getServerUrlCandidates,
  getJson,
  normalizeServerUrl,
  getPreAuthHeaders,
  buildUrl,
} from './http';
import {initializeDeviceIdentity} from '../deviceIdentity';

// Each scheme candidate gets a shorter budget than a normal request so that
// falling back to the alternate scheme stays within the time a single attempt
// used to take. A server that cannot answer /System/Info/Public inside this
// window is unreachable for practical purposes.
const CONNECT_TIMEOUT_MS = 20000;

/**
 * Probe a server, resolving http/https automatically.
 *
 * The returned `baseUrl` is the URL that actually answered and is what callers
 * must persist and reuse — it may differ in scheme from what the user typed.
 */
export const connect = async (
  serverUrl: string,
): Promise<JellyfinServerInfo> => {
  const candidates = getServerUrlCandidates(serverUrl);

  if (!candidates.length) {
    throw new Error('Enter a server address.');
  }

  let firstError: unknown;

  for (const baseUrl of candidates) {
    try {
      const response = await getJson<{
        Id?: string;
        ServerName?: string;
        Version?: string;
        OperatingSystem?: string;
      }>(`${baseUrl}/System/Info/Public`, {}, CONNECT_TIMEOUT_MS);

      return {
        baseUrl,
        id: response.Id ?? baseUrl,
        name: response.ServerName ?? 'Media Server',
        version: response.Version ?? 'unknown',
        operatingSystem: response.OperatingSystem,
      };
    } catch (error) {
      // Report the failure for what the user actually typed, not for the
      // fallback scheme they never asked about.
      firstError = firstError ?? error;
    }
  }

  throw firstError instanceof Error
    ? firstError
    : new Error('Unable to reach the server.');
};

export const authenticate = async (
  serverUrl: string,
  username: string,
  password: string,
): Promise<JellyfinAuthResult> => {
  await initializeDeviceIdentity();
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await getJson<{
    User?: {Id?: string; Name?: string};
    AccessToken?: string;
  }>(`${baseUrl}/Users/AuthenticateByName`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getPreAuthHeaders(),
    },
    body: JSON.stringify({
      Username: username,
      Pw: password,
    }),
  });

  if (!response.User?.Id || !response.AccessToken) {
    throw new Error('Authentication response was missing credentials');
  }

  return {
    userId: response.User.Id,
    accessToken: response.AccessToken,
    username: response.User.Name,
  };
};

export const isQuickConnectEnabled = async (
  serverUrl: string,
): Promise<boolean> => {
  const baseUrl = normalizeServerUrl(serverUrl);

  try {
    return (await getJson<boolean>(`${baseUrl}/QuickConnect/Enabled`)) === true;
  } catch {
    return false;
  }
};

export const initiateQuickConnect = async (
  serverUrl: string,
): Promise<QuickConnectInitiateResult> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await getJson<{Code?: string; Secret?: string}>(
    `${baseUrl}/QuickConnect/Initiate`,
    {
      method: 'POST',
      headers: getPreAuthHeaders(),
    },
  );

  if (!response.Code || !response.Secret) {
    throw new Error('Quick Connect could not be started on this server');
  }

  return {code: response.Code, secret: response.Secret};
};

export const pollQuickConnect = async (
  serverUrl: string,
  secret: string,
): Promise<boolean> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await getJson<{Authenticated?: boolean}>(
    buildUrl(baseUrl, '/QuickConnect/Connect', {Secret: secret}),
    {headers: getPreAuthHeaders()},
  );

  return response.Authenticated === true;
};

export const authenticateWithQuickConnect = async (
  serverUrl: string,
  secret: string,
): Promise<JellyfinAuthResult> => {
  await initializeDeviceIdentity();
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await getJson<{
    User?: {Id?: string; Name?: string};
    AccessToken?: string;
  }>(`${baseUrl}/Users/AuthenticateWithQuickConnect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getPreAuthHeaders(),
    },
    body: JSON.stringify({Secret: secret}),
  });

  if (!response.User?.Id || !response.AccessToken) {
    throw new Error(
      'Quick Connect authentication response was missing credentials',
    );
  }

  return {
    userId: response.User.Id,
    accessToken: response.AccessToken,
    username: response.User.Name,
  };
};
