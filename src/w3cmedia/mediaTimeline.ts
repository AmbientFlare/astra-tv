export const mediaToLogicalTime = (
  mediaTimeSeconds: number,
  timelineOffsetSeconds: number,
): number => Math.max(0, mediaTimeSeconds + timelineOffsetSeconds);

export const logicalToMediaTime = (
  logicalTimeSeconds: number,
  timelineOffsetSeconds: number,
): number => Math.max(0, logicalTimeSeconds - timelineOffsetSeconds);

export const calibrateTimelineOffset = (
  logicalStartSeconds: number,
  mediaStartSeconds: number,
): number => logicalStartSeconds - mediaStartSeconds;

/** Item duration is authoritative; a resumed playlist may contain only a suffix. */
export const logicalDurationSeconds = (
  runTimeTicks?: number,
  mediaDuration?: number,
  timelineOffsetSeconds = 0,
): number => {
  if (runTimeTicks && Number.isFinite(runTimeTicks) && runTimeTicks > 0) {
    return runTimeTicks / 10000000;
  }
  return mediaDuration && Number.isFinite(mediaDuration) && mediaDuration > 0
    ? Math.max(0, mediaDuration + timelineOffsetSeconds)
    : 0;
};

/** Unknown runtime cannot establish premature EOF; avoid inventing an end. */
export const isPrematureEnd = (
  positionSeconds: number,
  runTimeTicks?: number,
): boolean => {
  const duration = logicalDurationSeconds(runTimeTicks);
  return duration > 0 && positionSeconds < duration - 10;
};

/**
 * A stall this close to the item's end is the stream running out, not a
 * fault. Transcoded HLS can end a second short of the runtime without the
 * player ever firing `ended`.
 */
export const isStalledAtEnd = (
  positionSeconds: number,
  runTimeTicks?: number,
): boolean => {
  const duration = logicalDurationSeconds(runTimeTicks);
  return duration > 0 && positionSeconds >= duration - 10;
};

/**
 * The last two seconds with no progress since the previous check: the
 * stream has run out. Caught here instead of waiting out the stall budget.
 */
export const isFrozenAtEnd = (
  positionSeconds: number,
  previousSeconds: number | null,
  runTimeTicks?: number,
): boolean => {
  const duration = logicalDurationSeconds(runTimeTicks);
  return (
    duration > 0 &&
    previousSeconds !== null &&
    positionSeconds >= duration - 2 &&
    Math.abs(positionSeconds - previousSeconds) < 0.25
  );
};

export const requiresStreamReload = (
  fromSeconds: number,
  targetSeconds: number,
  firstAvailableSeconds: number,
  thresholdSeconds = 60,
) =>
  targetSeconds < firstAvailableSeconds ||
  Math.abs(targetSeconds - fromSeconds) >= thresholdSeconds;
