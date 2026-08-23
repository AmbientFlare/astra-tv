export interface TimedMediaSegment {
  endTicks: number;
  id?: string;
  startTicks: number;
  type: string;
}

export const findActiveOutro = <Segment extends TimedMediaSegment>(
  segments: readonly Segment[],
  positionTicks: number,
): Segment | null =>
  segments.find(
    (segment) =>
      segment.type.toLowerCase() === 'outro' &&
      segment.startTicks <= positionTicks &&
      positionTicks < segment.endTicks,
  ) ?? null;

export const mediaSegmentKey = (segment: TimedMediaSegment) =>
  segment.id ?? `${segment.startTicks}:${segment.endTicks}:${segment.type}`;

export const shouldAutoAdvanceEpisode = ({
  enabled,
  itemType,
  seriesId,
  userId,
}: {
  enabled: boolean;
  itemType: string;
  seriesId?: string;
  userId?: string;
}) =>
  enabled &&
  itemType.toLowerCase() === 'episode' &&
  Boolean(seriesId && userId);
