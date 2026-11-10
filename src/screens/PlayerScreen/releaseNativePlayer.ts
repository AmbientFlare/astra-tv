import type {VideoPlayer} from '@amazon-devices/react-native-w3cmedia';

import {trace} from '../../services/logging/trace';
import type {ShakaPlayer} from '../../w3cmedia/shakaplayer/ShakaPlayer';

// After a background release, how long Shaka may take to clean up before a
// new player is allowed to attach.
const BACKGROUND_UNLOAD_WAIT_MS = 3000;
// How long the background switch blocks on the native player teardown. The
// OS holds the background transition while JS is blocked and only checks for a
// held decoder after it, so blocking is what keeps the app alive. A paused
// player takes ~0.4 s to let go on one stick and ~0.9 s on another.
const BACKGROUND_DEINIT_WAIT_MS = 1500;

/**
 * Tears down one video element and its Shaka player. Resolves once both have
 * let go; rejects if the native release failed.
 *
 * `immediate` is for the background switch. Vega OS suspends JS once the app
 * is in the background and ends an app that still holds a decoder (Amazon
 * reports it as ReclaimMediaResource), so the decoder is released before
 * anything is awaited, in Amazon's documented order: the video player
 * first, Shaka after.
 */
export const releaseNativePlayer = (
  video: VideoPlayer | null,
  shaka: ShakaPlayer | null,
  surfaceHandle: string | null,
  immediate: boolean,
): Promise<void> => {
  // The surface goes first, before anything that waits: unloading can take
  // seconds while appends finish, and a surface the system destroys in that
  // time must not still be attached when the player is finally torn down.
  try {
    if (surfaceHandle) {
      video?.clearSurfaceHandle(surfaceHandle);
    }
  } catch {
    /* Already detached by the native surface. */
  }
  try {
    video?.pause();
  } catch {
    /* Already detached by the native surface. */
  }
  let deinitialized: Promise<void> | undefined;
  if (immediate) {
    try {
      if (video && typeof video.deinitializeSync === 'function') {
        const status = video.deinitializeSync(BACKGROUND_DEINIT_WAIT_MS);
        trace('session.background', `decoder release ${status}`);
        deinitialized = Promise.resolve();
      } else {
        deinitialized = Promise.resolve(video?.deinitialize());
      }
    } catch (error) {
      deinitialized = Promise.reject(error);
    }
  }
  if (deinitialized) {
    const released = deinitialized;
    return (async () => {
      try {
        await released;
      } finally {
        // Bounded: appends cut off by the release may never report back,
        // and a later player must not wait on them forever.
        await Promise.race([
          shaka?.unload().catch(() => undefined),
          new Promise((resolve) =>
            setTimeout(resolve, BACKGROUND_UNLOAD_WAIT_MS),
          ),
        ]);
      }
    })();
  }
  return (async () => {
    try {
      await shaka?.unload();
    } finally {
      await video?.deinitialize();
    }
  })();
};
