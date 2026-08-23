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
