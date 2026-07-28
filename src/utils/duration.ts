/**
 * Duration formatting for music UI.
 *
 * Jellyfin measures time in "ticks" of 100 nanoseconds.
 */
export const TICKS_PER_SECOND = 10000000;

export const ticksToSeconds = (ticks?: number) =>
  ticks && ticks > 0 ? ticks / TICKS_PER_SECOND : 0;

/**
 * Track-length style: `3:24`, or `1:02:15` once past an hour. Minutes are only
 * zero-padded when there is an hour component, matching how track times are
 * conventionally written.
 */
export const formatTrackDuration = (ticks?: number): string => {
  const total = Math.floor(ticksToSeconds(ticks));

  if (!total) {
    return '--:--';
  }

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const paddedSeconds = String(seconds).padStart(2, '0');

  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`
    : `${minutes}:${paddedSeconds}`;
};

/**
 * Album/playlist total, written the way a listener would say it:
 * `1 hr 20 min`, `47 min`, `38 sec`.
 */
export const formatTotalRuntime = (ticks?: number): string => {
  const total = Math.floor(ticksToSeconds(ticks));

  if (!total) {
    return '';
  }

  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  if (!hours && !minutes) {
    return `${total} sec`;
  }

  if (!hours) {
    return `${minutes} min`;
  }

  return minutes ? `${hours} hr ${minutes} min` : `${hours} hr`;
};

/** Seconds -> `3:24`, for live playback position where ticks are not involved. */
export const formatSeconds = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }

  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const paddedSeconds = String(total % 60).padStart(2, '0');

  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`
    : `${minutes}:${paddedSeconds}`;
};

/** Joins the non-empty parts of a metadata line with a middot. */
export const metaLine = (...parts: Array<string | number | undefined | null>) =>
  parts
    .filter((part) => part !== undefined && part !== null && part !== '')
    .join('  ·  ');
