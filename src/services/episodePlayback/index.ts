/**
 * Pure decisions behind Skip Credits, Next Episode and unattended episode
 * advancement. Nothing here touches the player or the network, so every rule
 * — where the credits are, which episode is next, whether to count down or
 * to ask — is unit-testable and the player only wires results to the screen.
 */
import type {JellyfinChapter, JellyfinMediaItem} from '../jellyfin';

/**
 * Unattended advances allowed in a row before Astra asks the viewer: the
 * episode the viewer started plus two that followed on their own, so three
 * episodes play before "Continue watching?".
 */
export const MAX_CONSECUTIVE_AUTO_ADVANCES = 2;

export interface TimedSegment {
  endTicks: number;
  id?: string;
  startTicks: number;
  type: string;
}

export interface CreditsWindow {
  endTicks: number;
  /** Identifies the window so a dismissed or skipped one is not re-offered. */
  key: string;
  source: 'segment' | 'chapter';
  startTicks: number;
}

const CREDITS_CHAPTER_PATTERN = /\bcredits\b/i;
// A "post-credits scene" chapter is the thing after the credits, not them.
const NOT_CREDITS_CHAPTER_PATTERN = /\b(?:post|mid|after|pre)[\s-]*credits\b/i;

const isCreditsChapterName = (name: string) =>
  CREDITS_CHAPTER_PATTERN.test(name) && !NOT_CREDITS_CHAPTER_PATTERN.test(name);

const isValidRange = (startTicks: number, endTicks: number) =>
  Number.isFinite(startTicks) &&
  Number.isFinite(endTicks) &&
  startTicks >= 0 &&
  endTicks > startTicks;

/**
 * Where the credits are, from data the server already holds. Media segments
 * (an `Outro`, written by the server or its plugins) win; otherwise the last
 * chapter whose name says "credits" is used, ending at the following chapter
 * or the runtime. Nothing is guessed from fixed offsets.
 */
export const findCreditsWindow = (
  segments: readonly TimedSegment[],
  chapters: readonly JellyfinChapter[] | undefined,
  runTimeTicks: number | undefined,
): CreditsWindow | null => {
  const outros = segments
    .filter(
      (segment) =>
        segment.type.toLowerCase() === 'outro' &&
        isValidRange(segment.startTicks, segment.endTicks),
    )
    .sort((a, b) => a.startTicks - b.startTicks);
  const outro = outros[outros.length - 1];
  if (outro) {
    return {
      endTicks: outro.endTicks,
      key: `segment:${outro.id ?? `${outro.startTicks}-${outro.endTicks}`}`,
      source: 'segment',
      startTicks: outro.startTicks,
    };
  }

  const ordered = (chapters ?? [])
    .filter((chapter) => Number.isFinite(chapter.startPositionTicks))
    .sort((a, b) => a.startPositionTicks - b.startPositionTicks);
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const chapter = ordered[index];
    if (!isCreditsChapterName(chapter.name)) {
      continue;
    }

    const nextStart = ordered[index + 1]?.startPositionTicks;
    const endTicks =
      nextStart !== undefined && nextStart > chapter.startPositionTicks
        ? nextStart
        : runTimeTicks ?? 0;
    if (!isValidRange(chapter.startPositionTicks, endTicks)) {
      return null;
    }

    return {
      endTicks,
      key: `chapter:${chapter.startPositionTicks}`,
      source: 'chapter',
      startTicks: chapter.startPositionTicks,
    };
  }

  return null;
};

export const isInsideWindow = (
  window: Pick<CreditsWindow, 'startTicks' | 'endTicks'> | null,
  positionTicks: number,
) =>
  window !== null &&
  positionTicks >= window.startTicks &&
  positionTicks < window.endTicks;

/**
 * The episode that follows `current` among `candidates`, in the order the
 * server listed them. Only episodes of the same series qualify; the list is
 * never wrapped, so the last episode has no successor.
 */
export const resolveNextEpisode = (
  candidates: readonly JellyfinMediaItem[],
  current: Pick<
    JellyfinMediaItem,
    'id' | 'seriesId' | 'indexNumber' | 'parentIndexNumber'
  >,
): JellyfinMediaItem | null => {
  if (!current.seriesId) {
    return null;
  }

  const episodes = candidates.filter(
    (candidate) =>
      candidate.type === 'Episode' && candidate.seriesId === current.seriesId,
  );
  const index = episodes.findIndex((episode) => episode.id === current.id);
  if (index < 0) {
    return null;
  }

  // A library can hold the same episode twice (another cut or quality). The
  // successor is the first later item that is a different episode number,
  // never a second copy of the one that just ended.
  const isSameEpisodeNumber = (candidate: JellyfinMediaItem) =>
    current.indexNumber !== undefined &&
    candidate.indexNumber === current.indexNumber &&
    (candidate.parentIndexNumber ?? null) ===
      (current.parentIndexNumber ?? null);

  for (let position = index + 1; position < episodes.length; position += 1) {
    const candidate = episodes[position];
    if (candidate.id !== current.id && !isSameEpisodeNumber(candidate)) {
      return candidate;
    }
  }

  return null;
};

export type EndOfPlaybackAction = 'finished' | 'countdown' | 'confirm';

/**
 * What to show when a video reaches its end. Movies always finish. An
 * episode with a next episode counts down only while autoplay is on and the
 * viewer has not already been carried across two episodes unattended;
 * after that it asks.
 */
export const decideEndOfPlayback = ({
  autoplayEnabled,
  consecutiveAutoAdvances,
  hasNextEpisode,
  itemType,
}: {
  autoplayEnabled: boolean;
  consecutiveAutoAdvances: number;
  hasNextEpisode: boolean;
  itemType: string | undefined;
}): EndOfPlaybackAction => {
  if (itemType !== 'Episode' || !hasNextEpisode) {
    return 'finished';
  }

  return autoplayEnabled &&
    consecutiveAutoAdvances < MAX_CONSECUTIVE_AUTO_ADVANCES
    ? 'countdown'
    : 'confirm';
};

/** The count the next player entry starts with after an advance. */
export const nextAutoAdvanceCount = (current: number, automatic: boolean) =>
  automatic ? Math.max(0, current) + 1 : 0;

export interface Countdown {
  cancel: () => void;
}

/**
 * A one-second countdown that reports each remaining value and fires once at
 * zero. `cancel` is idempotent and stops both the ticks and the expiry, so a
 * cancelled countdown can never advance an episode late.
 */
export const createCountdown = ({
  onExpire,
  onTick,
  seconds,
}: {
  onExpire: () => void;
  onTick: (remainingSeconds: number) => void;
  seconds: number;
}): Countdown => {
  let remaining = Math.max(0, Math.floor(seconds));
  let finished = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const cancel = () => {
    finished = true;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  onTick(remaining);
  if (remaining === 0) {
    finished = true;
    onExpire();
    return {cancel};
  }

  timer = setInterval(() => {
    if (finished) {
      return;
    }
    remaining -= 1;
    if (remaining <= 0) {
      cancel();
      onExpire();
      return;
    }
    onTick(remaining);
  }, 1000);

  return {cancel};
};
