import {
  KMC_OWNED_ACTIONS,
  normalizeKeyEvent,
} from '../src/hooks/useRemoteInput';

describe('normalizeKeyEvent', () => {
  it('collapses the up phase onto the same action', () => {
    // Vega delivers both phases of one physical press; some keys emit a
    // separate "<key>_up" type.
    expect(normalizeKeyEvent('select')).toBe('select');
    expect(normalizeKeyEvent('select_up')).toBe(normalizeKeyEvent('select'));
    expect(normalizeKeyEvent('right_up')).toBe('right');
  });

  it('maps both spellings of play/pause', () => {
    expect(normalizeKeyEvent('playPause')).toBe('playPause');
    expect(normalizeKeyEvent('playpause')).toBe('playPause');
  });

  it('maps the skip and seek families onto seek actions', () => {
    expect(normalizeKeyEvent('skip_forward')).toBe('seekForward');
    expect(normalizeKeyEvent('forward')).toBe('seekForward');
    expect(normalizeKeyEvent('fast_forward')).toBe('seekForward');
    expect(normalizeKeyEvent('skip_backward')).toBe('seekBackward');
    expect(normalizeKeyEvent('rewind')).toBe('seekBackward');
  });

  it('treats context_menu as menu', () => {
    expect(normalizeKeyEvent('context_menu')).toBe('menu');
    expect(normalizeKeyEvent('menu')).toBe('menu');
  });

  it('ignores unknown and empty keys', () => {
    expect(normalizeKeyEvent('')).toBeNull();
    expect(normalizeKeyEvent(undefined)).toBeNull();
    expect(normalizeKeyEvent('focus')).toBeNull();
    expect(normalizeKeyEvent('blur')).toBeNull();
  });
});

describe('channel ownership', () => {
  // One physical skip press emits BOTH `DPAD: skip_forward` and
  // `KMC: FAST_FORWARD`. Whichever channel does not own the action must ignore
  // it, or every skip moves twice as far.
  it('assigns transport actions to the media-controls channel', () => {
    expect(KMC_OWNED_ACTIONS.has('seekForward')).toBe(true);
    expect(KMC_OWNED_ACTIONS.has('seekBackward')).toBe(true);
    expect(KMC_OWNED_ACTIONS.has('next')).toBe(true);
    expect(KMC_OWNED_ACTIONS.has('previous')).toBe(true);
    expect(KMC_OWNED_ACTIONS.has('play')).toBe(true);
    expect(KMC_OWNED_ACTIONS.has('pause')).toBe(true);
    expect(KMC_OWNED_ACTIONS.has('playPause')).toBe(true);
  });

  it('leaves navigation on the dpad channel', () => {
    expect(KMC_OWNED_ACTIONS.has('up')).toBe(false);
    expect(KMC_OWNED_ACTIONS.has('down')).toBe(false);
    expect(KMC_OWNED_ACTIONS.has('left')).toBe(false);
    expect(KMC_OWNED_ACTIONS.has('right')).toBe(false);
    expect(KMC_OWNED_ACTIONS.has('select')).toBe(false);
    expect(KMC_OWNED_ACTIONS.has('back')).toBe(false);
    expect(KMC_OWNED_ACTIONS.has('menu')).toBe(false);
  });

  it('keeps Select separate from the KMC-owned play/pause command', () => {
    // Device evidence: the dedicated button arrives over both KMC and DPAD.
    // KMC must own playPause exclusively or resume immediately toggles back
    // to pause. The centre Select button remains D-pad navigation.
    expect(KMC_OWNED_ACTIONS.has('select')).toBe(false);
  });
});
