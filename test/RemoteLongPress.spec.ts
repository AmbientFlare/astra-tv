import {
  REMOTE_LONG_PRESS_MS,
  RemoteHoldTracker,
} from '../src/hooks/useRemoteLongPress';

describe('RemoteHoldTracker', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fires once only after a two-second directional hold', () => {
    const tracker = new RemoteHoldTracker();
    const onHold = jest.fn();

    tracker.handle({eventKeyAction: 0, eventType: 'right'}, onHold);
    jest.advanceTimersByTime(REMOTE_LONG_PRESS_MS - 1);
    expect(onHold).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onHold).toHaveBeenCalledWith('right');
    expect(onHold).toHaveBeenCalledTimes(1);

    tracker.dispose();
  });

  it('leaves a short directional press as navigation only', () => {
    const tracker = new RemoteHoldTracker();
    const onHold = jest.fn();

    tracker.handle({eventKeyAction: 0, eventType: 'left'}, onHold);
    jest.advanceTimersByTime(800);
    tracker.handle({eventKeyAction: 1, eventType: 'left'}, onHold);
    jest.advanceTimersByTime(REMOTE_LONG_PRESS_MS);

    expect(onHold).not.toHaveBeenCalled();
    tracker.dispose();
  });

  it('ignores repeat key-down events while one hold is active', () => {
    const tracker = new RemoteHoldTracker();
    const onHold = jest.fn();

    tracker.handle({eventKeyAction: 0, eventType: 'right'}, onHold);
    jest.advanceTimersByTime(900);
    tracker.handle({eventKeyAction: 0, eventType: 'right'}, onHold);
    jest.advanceTimersByTime(1100);

    expect(onHold).toHaveBeenCalledTimes(1);
    tracker.dispose();
  });
});
