/**
 * The playhead moves about four times a second. Routing every one of those
 * updates through React state re-rendered the whole player tree at that rate,
 * for a value that is usually not even on screen — the progress bar and the
 * controls only exist while `controlsVisible` is true.
 *
 * External subtitle cues are the one consumer that genuinely needs sub-second
 * timing, so they subscribe here and re-render alone. Everything else reads the
 * `positionSeconds` state, which is now only advanced once a second.
 *
 * Nothing here touches media timing: the store is told the same logical seconds
 * the component already computed.
 */
export type PositionListener = (seconds: number) => void;

export interface PositionStore {
  get(): number;
  set(seconds: number): void;
  subscribe(listener: PositionListener): () => void;
}

export const createPositionStore = (initialSeconds = 0): PositionStore => {
  let current = Number.isFinite(initialSeconds) ? initialSeconds : 0;
  const listeners = new Set<PositionListener>();

  return {
    get: () => current,
    set: (seconds: number) => {
      if (!Number.isFinite(seconds) || seconds === current) {
        return;
      }
      current = seconds;
      // Copy before iterating: a listener may unsubscribe on a cue change.
      for (const listener of Array.from(listeners)) {
        listener(current);
      }
    },
    subscribe: (listener: PositionListener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
