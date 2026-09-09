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

export const requiresStreamReload = (
  fromSeconds: number,
  targetSeconds: number,
  firstAvailableSeconds: number,
  thresholdSeconds = 60,
) =>
  targetSeconds < firstAvailableSeconds ||
  Math.abs(targetSeconds - fromSeconds) >= thresholdSeconds;
