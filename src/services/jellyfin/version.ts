/** The oldest Jellyfin Server version Astra officially supports. */
export const MIN_SUPPORTED_JELLYFIN_VERSION = '10.10.0';

type JellyfinVersionParts = readonly [number, number, number];

const parseJellyfinVersion = (value: unknown): JellyfinVersionParts | null => {
  if (typeof value !== 'string') {
    return null;
  }

  // Accept a leading `v`, release suffixes, and the server's two-component
  // form (10.10), while requiring a major and minor component before making a
  // support decision.
  const match = value
    .trim()
    .match(/(?:^|[^\d])(\d+)\.(\d+)(?:\.(\d+))?(?=$|[^\d])/);
  if (!match) {
    return null;
  }

  const parts: JellyfinVersionParts = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3] ?? 0),
  ];
  return parts.every((part) => Number.isSafeInteger(part) && part >= 0)
    ? parts
    : null;
};

/**
 * Compare a server version with the supplied minimum. Unknown versions return
 * null so setup can avoid falsely classifying an unparseable server.
 */
export const compareJellyfinVersions = (
  version: unknown,
  minimumVersion: string = MIN_SUPPORTED_JELLYFIN_VERSION,
): -1 | 0 | 1 | null => {
  const candidate = parseJellyfinVersion(version);
  const minimum = parseJellyfinVersion(minimumVersion);
  if (!candidate || !minimum) {
    return null;
  }

  for (let index = 0; index < candidate.length; index += 1) {
    if (candidate[index] < minimum[index]) {
      return -1;
    }
    if (candidate[index] > minimum[index]) {
      return 1;
    }
  }

  return 0;
};

export const isJellyfinVersionBelowMinimum = (version: unknown) =>
  compareJellyfinVersions(version) === -1;

export const getJellyfinVersionWarning = (version: unknown) => {
  if (!isJellyfinVersionBelowMinimum(version)) {
    return null;
  }

  const displayVersion = typeof version === 'string' ? version.trim() : '';
  const minimumVersionLabel = MIN_SUPPORTED_JELLYFIN_VERSION.replace(
    /\.0$/,
    '',
  );
  return `Astra officially supports Jellyfin Server ${minimumVersionLabel} and newer. This server is running Jellyfin ${displayVersion}. It may work, but this version is unsupported. Update Jellyfin if you experience problems.`;
};
