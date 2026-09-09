import {getDeviceId, initializeDeviceIdentity} from '../deviceIdentity';
import {APP_VERSION} from '../../config/app';
export {getServerUrlCandidates, normalizeServerUrl} from '../serverUrl';

const authHeader = () =>
  `MediaBrowser Client="Astra", Device="FireTV", DeviceId="${getDeviceId()}", Version="${APP_VERSION}"`;

// Jellyfin 10.12 disables the X-Emby-* legacy headers by default and 10.13
// removes them; send the standard Authorization header alongside them so both
// old and new servers accept requests.
export const getPreAuthHeaders = () => ({
  Authorization: authHeader(),
  'X-Emby-Authorization': authHeader(),
});

// Exported for the sibling music module; not part of the public surface.
export const getAuthHeaders = (accessToken: string) => ({
  Authorization: `${authHeader()}, Token="${accessToken}"`,
  'X-Emby-Authorization': `${authHeader()}, Token="${accessToken}"`,
  'X-Emby-Token': accessToken,
  'X-MediaBrowser-Token': accessToken,
});

export const buildUrl = (
  baseUrl: string,
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
) => {
  const url = new URL(path, `${baseUrl}/`);

  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
};

export const sanitizeUrlForLog = (rawUrl?: string) => {
  if (!rawUrl) {
    return rawUrl;
  }

  try {
    const parsed = new URL(rawUrl);
    const redactedPath = parsed.pathname.replace(
      /\b(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\b/gi,
      '[id]',
    );
    // No query parameter is useful enough to justify logging it. Jellyfin
    // URLs contain access tokens, play-session IDs, media-source IDs and item
    // IDs, sometimes duplicated with different casing.
    return `${parsed.origin}${redactedPath}`;
  } catch {
    return rawUrl
      .split(/[?#]/, 1)[0]
      .replace(
        /\b(?:[0-9a-f]{32}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\b/gi,
        '[id]',
      );
  }
};

/**
 * A failed server response, carrying its status so callers can tell "this is
 * gone" apart from "the server is unhappy". A library scan that drops an item
 * between a list and a detail request is ordinary, not an app error.
 */
export class ServerResponseError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ServerResponseError';
    this.status = status;
  }
}

export const isMissingItemError = (error: unknown) =>
  error instanceof ServerResponseError &&
  (error.status === 404 || error.status === 400);

export const getJson = async <ResponseBody>(
  url: string,
  options: {
    body?: string;
    headers?: Record<string, string>;
    method?: string;
    signal?: AbortController['signal'];
  } = {},
  timeoutMs = 45000,
): Promise<ResponseBody> => {
  await initializeDeviceIdentity();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortExternal = () => controller.abort();
  options.signal?.addEventListener('abort', abortExternal, {once: true});

  try {
    if (options.signal?.aborted) controller.abort();
    const requestOptions = {...options};
    // Headers may have been assembled synchronously before identity storage
    // finished loading. Refresh only our own token-bearing headers; callers'
    // unrelated headers must remain untouched.
    const authorization = options.headers?.Authorization;
    const tokenMatch = authorization?.match(/, Token="([^"]*)"/);
    if (
      tokenMatch &&
      authorization?.startsWith('MediaBrowser Client="Astra"')
    ) {
      requestOptions.headers = {
        ...options.headers,
        ...getAuthHeaders(tokenMatch[1]),
      };
    }
    const response = await fetch(url, {
      ...requestOptions,
      signal: controller.signal,
    });

    if (!response.ok) {
      const failedUrl = new URL(url);
      failedUrl.searchParams.delete('api_key');
      throw new ServerResponseError(
        `Server request failed ${response.status}: ${failedUrl.pathname}`,
        response.status,
      );
    }

    const text = await response.text();

    return (text ? JSON.parse(text) : undefined) as ResponseBody;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abortExternal);
  }
};
