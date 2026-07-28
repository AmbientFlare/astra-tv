/**
 * Shared server-URL handling.
 *
 * This lives in its own module because both the API client and the profile
 * store need it, and the API client already imports from the store — putting
 * it in either one would create a cycle.
 */

/**
 * Canonical form of a server URL: trimmed, no trailing slashes.
 *
 * Deliberately contains no host-specific rules. Scheme selection is resolved
 * once at connect time by `resolveServerUrl`, and the winning URL is what gets
 * persisted, so per-request probing is never needed.
 */
export const normalizeServerUrl = (serverUrl: string) =>
  serverUrl
    .trim()
    // The TV on-screen keyboard auto-capitalizes the first letter, so users
    // routinely enter "Http://…". React Native's URL implementation rejects a
    // non-lowercase scheme outright — every request then fails with
    // "Invalid base URL" and the server looks unreachable. Observed on device
    // 2026-07-27.
    .replace(
      /^([a-z][a-z0-9+.-]*):\/\//i,
      (_match, scheme: string) => `${scheme.toLowerCase()}://`,
    )
    // Hostnames are case-insensitive; lowercasing keeps "Jelly2.example.com"
    // and "jelly2.example.com" from becoming two separate stored profiles.
    .replace(
      /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]+)/i,
      (_match, scheme: string, host: string) => scheme + host.toLowerCase(),
    )
    .replace(/\/+$/, '');

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /\.local$/i,
];

/**
 * Private/LAN addresses are almost always plain HTTP (self-signed certs are
 * worse than useless on a TV), while a public hostname is usually HTTPS.
 * This only decides which scheme to *try first* — both are always attempted.
 */
const isPrivateHost = (host: string) => {
  const hostname = host.split(/[:/]/, 1)[0];

  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
};

/**
 * Ordered list of URLs to try for a server the user typed.
 *
 * Covers the common cases: a bare hostname with no scheme, and a server that
 * has since moved from HTTP to HTTPS (or sits behind a redirect) while the
 * user still types — or has stored — the old scheme.
 */
export const getServerUrlCandidates = (serverUrl: string): string[] => {
  const normalized = normalizeServerUrl(serverUrl);

  if (!normalized) {
    return [];
  }

  if (/^https?:\/\//i.test(normalized)) {
    const alternate = /^http:\/\//i.test(normalized)
      ? normalized.replace(/^http:/i, 'https:')
      : normalized.replace(/^https:/i, 'http:');

    return [normalized, alternate];
  }

  return isPrivateHost(normalized)
    ? [`http://${normalized}`, `https://${normalized}`]
    : [`https://${normalized}`, `http://${normalized}`];
};

/**
 * True when a URL would be fetched in the clear.
 *
 * SUSPECTED, NOT PROVEN: on 2026-07-27 a track failed with
 * `readyState 0 (HAVE_NOTHING)` from `http://192.168.0.18:8096` and played
 * from `https://jelly2.ambientflare.art`. Those two differ in host, port and
 * reverse-proxying as well as scheme, so cleartext is only one candidate
 * cause. Treat this as a hint to show after a failure, never as a reason to
 * refuse playback.
 *
 * Ordinary `fetch` over cleartext definitely works — browsing an http server
 * is fine. Whatever the real constraint is, it lives in the native media
 * pipeline, not in networking generally.
 */
export const isCleartextUrl = (url?: string | null) =>
  /^http:\/\//i.test((url ?? '').trim());

/**
 * Shown after a playback failure from an http:// server, as the most likely
 * explanation. Worded as a suggestion because the cause is not confirmed.
 */
export const CLEARTEXT_MEDIA_MESSAGE =
  'Playback from an unencrypted (http://) server may not be supported on this ' +
  'device. If your server also has an https:// address, try adding it that way.';
