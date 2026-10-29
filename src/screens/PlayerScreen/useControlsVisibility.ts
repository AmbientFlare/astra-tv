import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type {VideoPlayer} from '@amazon-devices/react-native-w3cmedia';
import {CONTROL_HIDE_DELAY_MS} from './types';

interface ControlsVisibilityDeps {
  videoRef: MutableRefObject<VideoPlayer | null>;
  unmountedRef: MutableRefObject<boolean>;
  sessionReady: MutableRefObject<boolean>;
  /**
   * True while React state says the controls must stay open: paused,
   * buffering, starting, a modal, or a finished video.
   */
  keepControlsVisible: boolean;
}

/**
 * The auto-hiding transport controls. Reveal arms a timer; the timer only
 * hides when playback is live and nothing has pinned the controls open.
 */
export const useControlsVisibility = ({
  videoRef,
  unmountedRef,
  sessionReady,
  keepControlsVisible,
}: ControlsVisibilityDeps) => {
  const [showControls, setShowControls] = useState(true);
  const controlsHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirrors keepControlsVisible for the timer callback, which must read the
  // value current at expiry rather than the one captured when it was armed.
  const controlsPinned = useRef(false);
  controlsPinned.current = keepControlsVisible;

  const clearControlsHideTimer = useCallback(() => {
    if (controlsHideTimer.current) {
      clearTimeout(controlsHideTimer.current);
      controlsHideTimer.current = null;
    }
  }, []);

  const scheduleControlsHide = useCallback(() => {
    clearControlsHideTimer();
    controlsHideTimer.current = setTimeout(() => {
      const video = videoRef.current;
      if (
        !video ||
        unmountedRef.current ||
        !sessionReady.current ||
        controlsPinned.current
      ) {
        return;
      }
      setShowControls(false);
    }, CONTROL_HIDE_DELAY_MS);
  }, [clearControlsHideTimer, sessionReady, unmountedRef, videoRef]);

  const revealControls = useCallback(
    (autoHide = true) => {
      setShowControls(true);
      if (autoHide) {
        scheduleControlsHide();
      } else {
        clearControlsHideTimer();
      }
    },
    [clearControlsHideTimer, scheduleControlsHide],
  );

  const hideControls = useCallback(() => {
    clearControlsHideTimer();
    setShowControls(false);
  }, [clearControlsHideTimer]);

  // React state owns whether controls must stay open. Native pause getters can
  // lag behind playback, and a timer that fires during startup must be rearmed.
  useEffect(() => {
    if (showControls && !keepControlsVisible) {
      scheduleControlsHide();
    } else {
      clearControlsHideTimer();
    }
    return clearControlsHideTimer;
  }, [
    showControls,
    keepControlsVisible,
    scheduleControlsHide,
    clearControlsHideTimer,
  ]);

  return {
    showControls,
    clearControlsHideTimer,
    scheduleControlsHide,
    revealControls,
    hideControls,
  };
};
