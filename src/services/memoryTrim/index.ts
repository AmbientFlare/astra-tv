/**
 * Asks whatever holds a disposable cache to let go of it.
 *
 * Vega's low-memory killer picks the background app with the most memory
 * first, and on a 1GB stick that was Astra: most of the "crashes" Amazon
 * reports are these kills, not faults. Caches that only make a screen quicker
 * to come back to are cheap to rebuild and worth dropping to stay alive.
 *
 * - `background`: the app has left the screen. Drop what is pure speed-up.
 * - `critical`: the system has warned that memory is short. Drop everything
 *   that is not on screen.
 */
export type MemoryTrimLevel = 'background' | 'critical';

type TrimListener = (level: MemoryTrimLevel) => void;

const listeners = new Set<TrimListener>();

/** Registers a cache to trim. Returns the unsubscribe. */
export const onMemoryTrim = (listener: TrimListener) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const trimMemory = (level: MemoryTrimLevel) => {
  listeners.forEach((listener) => {
    try {
      listener(level);
    } catch {
      // One cache failing to trim must not stop the others.
    }
  });
};
