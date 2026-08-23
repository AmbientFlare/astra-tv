import {BufferOperationTracker} from '../src/w3cmedia/bufferOperationTracker';

describe('ShakaPlayer native buffer tracking', () => {
  it('invokes appendBuffer synchronously and waits only for its native update', async () => {
    const listeners = new Map<string, Set<() => void>>();
    const originalAppendBuffer = jest.fn(function (
      this: {updating: boolean},
      _data: ArrayBuffer,
    ) {
      this.updating = true;
    });
    const sourceBuffer = {
      updating: false,
      appendBuffer: originalAppendBuffer,
      remove: jest.fn(),
      abort: jest.fn(),
      addEventListener: (event: string, listener: () => void) => {
        const eventListeners = listeners.get(event) ?? new Set();
        eventListeners.add(listener);
        listeners.set(event, eventListeners);
      },
      removeEventListener: (event: string, listener: () => void) => {
        listeners.get(event)?.delete(listener);
      },
    };
    const tracker = new BufferOperationTracker();

    tracker.track(
      sourceBuffer,
      () => sourceBuffer.appendBuffer(new ArrayBuffer(1)),
      true,
    );

    expect(originalAppendBuffer).toHaveBeenCalledTimes(1);
    expect(sourceBuffer.updating).toBe(true);

    let completed = false;
    const completion = tracker.waitForComplete().then(() => {
      completed = true;
    });
    await Promise.resolve();
    expect(completed).toBe(false);

    sourceBuffer.updating = false;
    listeners.get('updateend')?.forEach((listener) => listener());
    await completion;

    expect(completed).toBe(true);
  });
});
