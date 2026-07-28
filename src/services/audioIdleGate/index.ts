/**
 * Coordinates the audio idle overlay with every remote-input path.
 *
 * Vega delivers one physical press in multiple phases, and Select can arrive
 * through a focusable control rather than useTVEventHandler. Keeping this gate
 * outside React lets both paths consume the complete first press.
 */
const DISMISS_PRESS_BLOCK_MS = 600;

let active = false;
let blockedUntil = 0;
let dismiss: (() => void) | null = null;

export const audioIdleGate = {
  activate(onDismiss: () => void) {
    active = true;
    dismiss = onDismiss;
  },

  deactivate() {
    active = false;
    dismiss = null;
  },

  consumeInput(): boolean {
    const now = Date.now();

    if (!active) {
      return now < blockedUntil;
    }

    active = false;
    blockedUntil = now + DISMISS_PRESS_BLOCK_MS;
    const onDismiss = dismiss;
    dismiss = null;
    onDismiss?.();
    return true;
  },

  isActive(): boolean {
    return active;
  },
};
