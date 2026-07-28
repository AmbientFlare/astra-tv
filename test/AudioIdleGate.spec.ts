import {audioIdleGate} from '../src/services/audioIdleGate';

describe('audioIdleGate', () => {
  afterEach(() => {
    audioIdleGate.deactivate();
    jest.useRealTimers();
  });

  it('dismisses once and consumes every phase of the waking press', () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-28T08:00:00Z'));
    const dismiss = jest.fn();

    audioIdleGate.activate(dismiss);

    expect(audioIdleGate.consumeInput()).toBe(true);
    expect(dismiss).toHaveBeenCalledTimes(1);
    expect(audioIdleGate.isActive()).toBe(false);

    // The key-up phase is swallowed rather than reaching playback/navigation.
    expect(audioIdleGate.consumeInput()).toBe(true);

    jest.advanceTimersByTime(601);
    expect(audioIdleGate.consumeInput()).toBe(false);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });
});
