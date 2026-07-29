import {useEffect, useRef} from 'react';
import {HWEvent, useTVEventHandler} from '@amazon-devices/react-native-kepler';
import {audioIdleGate} from '../services/audioIdleGate';

export const REMOTE_LONG_PRESS_MS = 2000;
type HoldDirection = 'left' | 'right';

export class RemoteHoldTracker {
  private timers = new Map<HoldDirection, ReturnType<typeof setTimeout>>();

  handle(
    event: Pick<HWEvent, 'eventKeyAction' | 'eventType'>,
    onHold: (direction: HoldDirection) => void,
  ) {
    const rawType = event.eventType ?? '';
    const direction = rawType.replace(/_(up|down)$/, '') as HoldDirection;

    if (direction !== 'left' && direction !== 'right') {
      return;
    }

    const isRelease = event.eventKeyAction === 1 || rawType.endsWith('_up');
    if (isRelease) {
      this.clear(direction);
      return;
    }

    const isPress = event.eventKeyAction === 0 || rawType.endsWith('_down');
    if (!isPress || this.timers.has(direction)) {
      return;
    }

    // A waking press belongs only to the idle overlay, even if held.
    if (audioIdleGate.consumeInput()) {
      return;
    }

    this.timers.set(
      direction,
      setTimeout(() => {
        this.timers.delete(direction);
        onHold(direction);
      }, REMOTE_LONG_PRESS_MS),
    );
  }

  clear(direction: HoldDirection) {
    const timer = this.timers.get(direction);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(direction);
    }
  }

  dispose() {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
  }
}

export const useRemoteLongPress = ({
  enabled,
  onLeft,
  onRight,
}: {
  enabled: boolean;
  onLeft: () => void;
  onRight: () => void;
}) => {
  const tracker = useRef(new RemoteHoldTracker()).current;

  useEffect(() => () => tracker.dispose(), [tracker]);

  useTVEventHandler((event) => {
    if (!enabled) {
      tracker.dispose();
      return;
    }

    tracker.handle(event, (direction) => {
      if (direction === 'left') {
        onLeft();
      } else {
        onRight();
      }
    });
  });
};
