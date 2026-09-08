import {buildUrl, getAuthHeaders, getJson} from './http';

/**
 * Whether the server is permitted to re-encode video for this account.
 *
 * This is the only transcoding signal a non-admin client can read. It is a
 * permission, not a capability: it says nothing about whether the server has
 * a usable GPU. A container on a NAS with the policy enabled will accept the
 * request and encode in software, which for a 4K source is slower than
 * realtime. Treat a `true` here as "a re-encode is allowed to be attempted",
 * and let the playback telemetry catch a server that cannot keep up.
 */
interface UserPolicyResponse {
  Policy?: {
    EnableVideoPlaybackTranscoding?: boolean;
  };
}

const cache = new Map<string, Promise<boolean>>();

const fetchPolicy = async (
  baseUrl: string,
  accessToken: string,
  userId: string,
  signal?: AbortController['signal'],
): Promise<boolean> => {
  const response = await getJson<UserPolicyResponse>(
    buildUrl(baseUrl, `/Users/${userId}`),
    {headers: getAuthHeaders(accessToken), signal},
  );
  // Older servers omit the field entirely. Assume permitted: the previous
  // behaviour was to always ask, and a refused transcode already falls back.
  return response.Policy?.EnableVideoPlaybackTranscoding !== false;
};

/**
 * Cached per server+user for the life of the process. A policy change mid
 * session is rare enough that re-reading it on every title is not worth the
 * request; signing out and back in clears it.
 */
export const canServerTranscodeVideo = async (
  baseUrl: string,
  accessToken: string,
  userId: string,
  signal?: AbortController['signal'],
): Promise<boolean> => {
  const key = `${baseUrl}|${userId}`;
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  const pending = fetchPolicy(baseUrl, accessToken, userId, signal).catch(
    (error) => {
      // A failed read must not block playback or force a needless re-encode.
      console.warn('[Astra] Unable to read transcoding policy:', error);
      cache.delete(key);
      return true;
    },
  );
  cache.set(key, pending);
  return pending;
};

export const clearUserPolicyCache = () => cache.clear();
