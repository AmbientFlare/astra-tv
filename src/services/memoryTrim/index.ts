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
/* global globalThis */

import {releaseFreedMemory} from '@astra/user-engagement';

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

/**
 * Frees what can be freed now: a full JS collection, where the engine offers
 * one, then the freed native memory handed back to the system. Media segments
 * and other buffers are held natively until the JS objects that own them are
 * collected, and the allocator keeps what is freed unless asked. A
 * backgrounded app is paused a few seconds in, before either happens on its
 * own. On the stick this takes Astra from ~190 MB to ~65 MB after the player
 * closes in the background.
 */
export const collectGarbage = () => {
  try {
    (globalThis as {gc?: () => void}).gc?.();
  } catch {
    // Only a missed saving.
  }
  releaseFreedMemory();
};

export const trimMemory = (level: MemoryTrimLevel) => {
  listeners.forEach((listener) => {
    try {
      listener(level);
    } catch {
      // One cache failing to trim must not stop the others.
    }
  });
  collectGarbage();
};
