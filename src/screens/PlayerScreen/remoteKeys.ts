export type SeekDirection = 1 | -1 | 0;

export interface RemoteKey {
  /** The event type with any `_up` / `_down` suffix removed. */
  key: string;
  /** Which way a transport or directional key seeks; 0 for other keys. */
  seekDirection: SeekDirection;
  /** True for the release half of a press. */
  released: boolean;
  /**
   * A dedicated transport key (rewind, fast-forward, skip). Left and Right
   * are directional and may belong to the media controls instead.
   */
  transport: boolean;
}

const FORWARD_KEYS = ['right', 'forward', 'fast_forward', 'skip_forward'];
const BACKWARD_KEYS = ['left', 'rewind', 'skip_backward'];

/** Normalises one remote event into the shape the key handler switches on. */
export const classifyRemoteKey = (
  eventType: string | undefined,
  eventKeyAction: number | undefined,
): RemoteKey => {
  const rawKey = eventType ?? '';
  const key = rawKey.replace(/_(up|down)$/, '');
  const seekDirection: SeekDirection = FORWARD_KEYS.includes(key)
    ? 1
    : BACKWARD_KEYS.includes(key)
    ? -1
    : 0;
  return {
    key,
    seekDirection,
    released: rawKey.endsWith('_up') || eventKeyAction === 1,
    transport: seekDirection !== 0 && !['left', 'right'].includes(key),
  };
};

export const isPlayPauseKey = (key: string): boolean =>
  key === 'playPause' || key === 'playpause';

export const isMenuKey = (key: string): boolean =>
  key === 'menu' || key === 'context_menu';
