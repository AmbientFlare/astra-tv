/**
 * Shared TV remote input handling.
 *
 * Vega's key delivery has three separate hazards, all observed on real
 * hardware during the 2026-07-27 audio spike. Every screen that handles remote
 * input needs all three fixes, which is why this lives in one place rather than
 * being copied per screen.
 *
 * 1. DOUBLE DELIVERY. One physical press arrives twice — the down and up
 *    phases, and for some keys a separate "<key>_up" event type. Observed
 *    corrupting state, not merely cosmetic: one press of RIGHT advanced two
 *    tracks at once.
 *
 * 2. SLOW HANDLERS OUTLIVE THE DEDUPE WINDOW. A fixed time window is not
 *    enough on its own. If the handler takes longer than the window (a ~1.4s
 *    async diagnostic, or a network fetch), the up-phase lands after the window
 *    has expired and fires a second time. So the window is also held open for
 *    as long as an async handler is still running.
 *
 * 3. DUAL CHANNELS. The skip buttons emit BOTH a dpad event and a Kepler Media
 *    Controls command for a single press:
 *        DPAD: skip_forward
 *        KMC:  FAST_FORWARD
 *    Deduping cannot catch this — the two arrive by different paths with
 *    different type strings. A screen must therefore claim each logical action
 *    for exactly one channel, or every skip moves twice as far.
 */
import {useCallback, useRef} from 'react';
import {useTVEventHandler} from '@amazon-devices/react-native-kepler';
import {audioIdleGate} from '../services/audioIdleGate';

/** Matches PlayerScreen's long-standing value. */
export const DEFAULT_KEY_DEDUPE_MS = 350;

/**
 * Logical actions a screen can handle. Each must be owned by exactly one
 * input channel — see `RemoteChannel`.
 */
export type RemoteAction =
  | 'back'
  | 'down'
  | 'left'
  | 'menu'
  | 'next'
  | 'pause'
  | 'play'
  | 'playPause'
  | 'previous'
  | 'right'
  | 'seekBackward'
  | 'seekForward'
  | 'select'
  | 'startOver'
  | 'stop'
  | 'up';

/**
 * Which input path an action came from. `dpad` is the React Native TV event
 * stream; `kmc` is the Kepler Media Controls server (also driven by voice and
 * by the system's own transport UI, so it cannot simply be ignored).
 */
export type RemoteChannel = 'dpad' | 'kmc';

/**
 * Actions the media-controls channel owns by default.
 *
 * Transport commands are claimed by KMC because that channel also carries
 * voice control and the system transport overlay, which the dpad stream does
 * not. Navigation stays on the dpad. Anything not listed here is dpad-owned.
 */
export const KMC_OWNED_ACTIONS: ReadonlySet<RemoteAction> = new Set([
  'next',
  'pause',
  'play',
  'playPause',
  'previous',
  'seekBackward',
  'seekForward',
  'startOver',
  'stop',
]);

/** Normalizes Vega's event type strings onto logical actions. */
const ACTION_BY_KEY: Record<string, RemoteAction> = {
  back: 'back',
  context_menu: 'menu',
  down: 'down',
  fast_forward: 'seekForward',
  forward: 'seekForward',
  left: 'left',
  menu: 'menu',
  pause: 'pause',
  play: 'play',
  playPause: 'playPause',
  playpause: 'playPause',
  rewind: 'seekBackward',
  right: 'right',
  select: 'select',
  skip_backward: 'seekBackward',
  skip_forward: 'seekForward',
  up: 'up',
};

export const normalizeKeyEvent = (eventType?: string): RemoteAction | null => {
  if (!eventType) {
    return null;
  }

  // Strip the trailing up-phase marker so both phases collapse to one key.
  const key = eventType.replace(/_up$/, '');

  return ACTION_BY_KEY[key] ?? null;
};

export interface RemoteInputOptions {
  /**
   * When false the handler ignores everything except the always-allowed keys.
   * Use this while a modal or panel is open so focusable controls own Select
   * and the directional keys — the pattern PlayerScreen already relies on.
   */
  enabled?: boolean;
  /** Actions still delivered while `enabled` is false. */
  allowWhileDisabled?: readonly RemoteAction[];
  dedupeMs?: number;
  /**
   * Actions this screen wants from the dpad channel even though KMC owns them
   * by default. Rarely needed; provided so a screen without KMC focus can still
   * drive transport from the dpad.
   */
  dpadOverrides?: readonly RemoteAction[];
}

/**
 * Deduplicating remote handler.
 *
 * `handler` may be async; the dedupe window stays open until it settles, which
 * is what prevents a held button from firing twice on a slow action.
 */
export const useRemoteInput = (
  handler: (
    action: RemoteAction,
    channel: RemoteChannel,
  ) => void | Promise<void>,
  options: RemoteInputOptions = {},
) => {
  const {
    allowWhileDisabled = ['back', 'menu'],
    dedupeMs = DEFAULT_KEY_DEDUPE_MS,
    dpadOverrides = [],
    enabled = true,
  } = options;

  const lastEvent = useRef<{action: string; time: number}>({
    action: '',
    time: 0,
  });
  const inFlight = useRef<Set<string>>(new Set());

  const dispatch = useCallback(
    (action: RemoteAction, channel: RemoteChannel) => {
      const now = Date.now();
      const key = `${action}`;

      // Hazard 2: a still-running handler holds its own window open.
      if (inFlight.current.has(key)) {
        return;
      }

      // Hazard 1: collapse the two phases of one physical press.
      if (
        lastEvent.current.action === key &&
        now - lastEvent.current.time < dedupeMs
      ) {
        return;
      }

      lastEvent.current = {action: key, time: now};

      let result: void | Promise<void>;

      try {
        result = handler(action, channel);
      } catch (error) {
        console.warn('[Astra] Remote handler threw:', error);
        return;
      }

      if (result && typeof (result as Promise<void>).then === 'function') {
        inFlight.current.add(key);
        (result as Promise<void>)
          .catch((error) => {
            console.warn('[Astra] Remote handler rejected:', error);
          })
          .finally(() => {
            inFlight.current.delete(key);
            // Restart the window from completion, so a long action cannot be
            // immediately re-triggered by its own trailing key-up.
            lastEvent.current = {action: key, time: Date.now()};
          });
      }
    },
    [dedupeMs, handler],
  );

  useTVEventHandler((event: {eventType?: string}) => {
    if (audioIdleGate.consumeInput()) {
      return;
    }

    const action = normalizeKeyEvent(event?.eventType);

    if (!action) {
      return;
    }

    if (!enabled && !allowWhileDisabled.includes(action)) {
      return;
    }

    // Hazard 3: skip actions also arrive over KMC. Ignore the dpad copy unless
    // this screen has explicitly claimed it.
    if (KMC_OWNED_ACTIONS.has(action) && !dpadOverrides.includes(action)) {
      return;
    }

    dispatch(action, 'dpad');
  });

  /**
   * Feed a Kepler Media Controls command in. Returned rather than wired
   * automatically because the KMC handler is owned by the playback service,
   * which outlives any one screen.
   */
  const handleMediaControl = useCallback(
    (action: RemoteAction) => dispatch(action, 'kmc'),
    [dispatch],
  );

  return {handleMediaControl};
};
