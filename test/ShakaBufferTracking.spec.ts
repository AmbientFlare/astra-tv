import {
  BufferOperationTracker,
  BufferOperationTimeoutError,
} from '../src/w3cmedia/bufferOperationTracker';

describe('ShakaPlayer native buffer tracking', () => {
  const buffer = () => {
    const listeners = new Map<string, (error?: unknown) => void>();
    return {
      updating: false,
      addEventListener: (event: string, fn: (error?: unknown) => void) => {
        listeners.set(event, fn);
      },
      removeEventListener: (event: string) => {
        listeners.delete(event);
      },
      emit: (event: string, error?: unknown) => listeners.get(event)?.(error),
    };
  };
  it('preserves the original synchronous quota exception for Shaka recovery', async () => {
    const tracker = new BufferOperationTracker();
    const source = buffer();
    const error = Object.assign(new Error('full'), {
      name: 'QuotaExceededError',
    });
    expect(() =>
      tracker.track(
        source,
        () => {
          throw error;
        },
        true,
      ),
    ).toThrow(error);
    expect(tracker.hasPendingOperations()).toBe(false);
    await expect(tracker.waitForComplete()).resolves.toBeUndefined();
  });
  it('records an asynchronous native error even when nobody is currently awaiting it', async () => {
    const notify = jest.fn();
    const tracker = new BufferOperationTracker(notify);
    const source = buffer();
    tracker.track(
      source,
      () => {
        source.updating = true;
      },
      true,
    );
    const error = new Error('native append failure');
    source.emit('error', error);
    await Promise.resolve();
    await Promise.resolve();
    expect(notify).toHaveBeenCalledWith(error);
    await expect(tracker.waitForComplete()).rejects.toBe(error);
  });
  it('bounds missing native completion without pretending it succeeded', async () => {
    jest.useFakeTimers();
    try {
      const tracker = new BufferOperationTracker();
      const source = buffer();
      tracker.track(
        source,
        () => {
          source.updating = true;
        },
        true,
      );
      const failure = expect(tracker.waitForComplete()).rejects.toBeInstanceOf(
        BufferOperationTimeoutError,
      );
      jest.advanceTimersByTime(30000);
      await failure;
      expect(tracker.hasPendingOperations()).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });
  it('releases an observer when native work aborts', async () => {
    const tracker = new BufferOperationTracker();
    const source = buffer();
    tracker.track(
      source,
      () => {
        source.updating = true;
      },
      false,
    );
    source.emit('abort');
    await expect(tracker.waitForComplete()).resolves.toBeUndefined();
  });
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
