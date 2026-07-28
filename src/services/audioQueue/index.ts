/**
 * Playback queue model.
 *
 * Deliberately pure: no player, no network, no React. Every queue decision —
 * what plays next, what shuffle does, how repeat interacts with the end of the
 * list — is decided here so it can be tested without a device.
 */
import {MusicTrack} from '../jellyfin/music';

export type RepeatMode = 'off' | 'all' | 'one';

export interface QueueState {
  /** Position within `order`, not within `tracks`. */
  cursor: number;
  /** Playback order as indices into `tracks`. Identity unless shuffled. */
  order: number[];
  repeat: RepeatMode;
  shuffle: boolean;
  tracks: MusicTrack[];
}

export const emptyQueue: QueueState = {
  cursor: 0,
  order: [],
  repeat: 'off',
  shuffle: false,
  tracks: [],
};

const identityOrder = (length: number) =>
  Array.from({length}, (_, index) => index);

/**
 * Fisher-Yates over a copy. `pinnedTrackIndex` is placed first so that turning
 * shuffle on never interrupts what is currently playing.
 */
const shuffledOrder = (length: number, pinnedTrackIndex?: number) => {
  const order = identityOrder(length);

  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }

  if (pinnedTrackIndex !== undefined && pinnedTrackIndex >= 0) {
    const position = order.indexOf(pinnedTrackIndex);

    if (position > 0) {
      [order[0], order[position]] = [order[position], order[0]];
    }
  }

  return order;
};

export const currentTrack = (state: QueueState): MusicTrack | null => {
  const trackIndex = state.order[state.cursor];

  return trackIndex === undefined ? null : state.tracks[trackIndex] ?? null;
};

export const queueLength = (state: QueueState) => state.tracks.length;

/** 1-based position for display; 0 when the queue is empty. */
export const displayPosition = (state: QueueState) =>
  state.order.length ? state.cursor + 1 : 0;

export interface CreateQueueOptions {
  repeat?: RepeatMode;
  shuffle?: boolean;
  /** Index into `tracks` to start from, before any shuffling. */
  startIndex?: number;
}

export const createQueue = (
  tracks: MusicTrack[],
  options: CreateQueueOptions = {},
): QueueState => {
  const {repeat = 'off', shuffle = false, startIndex = 0} = options;
  const safeStart =
    tracks.length === 0
      ? 0
      : Math.min(Math.max(startIndex, 0), tracks.length - 1);
  const order = shuffle
    ? shuffledOrder(tracks.length, safeStart)
    : identityOrder(tracks.length);

  return {
    cursor: shuffle ? 0 : safeStart,
    order,
    repeat,
    shuffle,
    tracks,
  };
};

/**
 * Advance.
 *
 * `auto` distinguishes a track ending on its own from the user pressing skip.
 * They differ for repeat-one: a finished track repeats itself, but a user who
 * presses next expects to actually move on.
 */
export const nextTrack = (
  state: QueueState,
  {auto = false}: {auto?: boolean} = {},
): QueueState | null => {
  if (!state.order.length) {
    return null;
  }

  if (auto && state.repeat === 'one') {
    return state;
  }

  const atEnd = state.cursor >= state.order.length - 1;

  if (!atEnd) {
    return {...state, cursor: state.cursor + 1};
  }

  if (state.repeat === 'all' || state.repeat === 'one') {
    // Reshuffle on wrap so a repeated shuffled queue is not the same order
    // forever, which is what listeners expect from shuffle+repeat.
    return state.shuffle
      ? {...state, cursor: 0, order: shuffledOrder(state.tracks.length)}
      : {...state, cursor: 0};
  }

  // End of queue, no repeat: signal stop rather than silently wrapping.
  return null;
};

export const previousTrack = (state: QueueState): QueueState => {
  if (!state.order.length) {
    return state;
  }

  if (state.cursor > 0) {
    return {...state, cursor: state.cursor - 1};
  }

  // At the head: wrap only when repeating, otherwise stay put and let the
  // caller restart the current track.
  return state.repeat === 'off'
    ? state
    : {...state, cursor: state.order.length - 1};
};

/** Jump to a position in the *visible* queue order. */
export const jumpTo = (state: QueueState, cursor: number): QueueState => {
  if (!state.order.length) {
    return state;
  }

  return {
    ...state,
    cursor: Math.min(Math.max(cursor, 0), state.order.length - 1),
  };
};

/**
 * Toggle shuffle without interrupting playback: the current track stays
 * current, and the rest of the queue is reordered around it.
 */
export const setShuffle = (state: QueueState, shuffle: boolean): QueueState => {
  if (shuffle === state.shuffle) {
    return state;
  }

  const playingTrackIndex = state.order[state.cursor];

  if (!shuffle) {
    return {
      ...state,
      cursor: playingTrackIndex ?? 0,
      order: identityOrder(state.tracks.length),
      shuffle: false,
    };
  }

  return {
    ...state,
    cursor: 0,
    order: shuffledOrder(state.tracks.length, playingTrackIndex),
    shuffle: true,
  };
};

export const setRepeat = (
  state: QueueState,
  repeat: RepeatMode,
): QueueState => ({
  ...state,
  repeat,
});

export const cycleRepeat = (state: QueueState): QueueState => {
  const nextMode: Record<RepeatMode, RepeatMode> = {
    all: 'one',
    off: 'all',
    one: 'off',
  };

  return setRepeat(state, nextMode[state.repeat]);
};

/** Append tracks, keeping the current position. */
export const enqueue = (
  state: QueueState,
  tracks: MusicTrack[],
): QueueState => {
  if (!tracks.length) {
    return state;
  }

  const appendedIndices = tracks.map((_, index) => state.tracks.length + index);

  return {
    ...state,
    order: [...state.order, ...appendedIndices],
    tracks: [...state.tracks, ...tracks],
  };
};

/** Insert directly after the current track. */
export const playNext = (
  state: QueueState,
  tracks: MusicTrack[],
): QueueState => {
  if (!tracks.length) {
    return state;
  }

  const appendedIndices = tracks.map((_, index) => state.tracks.length + index);
  const order = [...state.order];
  order.splice(state.cursor + 1, 0, ...appendedIndices);

  return {...state, order, tracks: [...state.tracks, ...tracks]};
};

/** Remove one entry by its position in the playback order. */
export const removeAt = (state: QueueState, position: number): QueueState => {
  if (position < 0 || position >= state.order.length) {
    return state;
  }

  const order = state.order.filter((_, index) => index !== position);
  // Keep the same track playing when something before it is removed.
  const cursor =
    position < state.cursor
      ? state.cursor - 1
      : Math.min(state.cursor, Math.max(order.length - 1, 0));

  return {...state, cursor, order};
};

/** Tracks in playback order — what a queue view should render. */
export const orderedTracks = (state: QueueState): MusicTrack[] =>
  state.order
    .map((trackIndex) => state.tracks[trackIndex])
    .filter((track): track is MusicTrack => Boolean(track));
