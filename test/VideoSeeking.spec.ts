import {
  SEEK_DELAY_MS,
  playMedia,
  seekMedia,
  VideoSeekController,
} from '../src/services/videoSeeking';

const flush = async () => {
  for (let n = 0; n < 10; n++) {
    await Promise.resolve();
  }
};

describe('VideoSeekController', () => {
  const setup = () => {
    const options = {
      position: jest.fn(() => 100),
      duration: () => 1000,
      apply: jest.fn(
        async (_target: number, _signal: AbortController['signal']) => {},
      ),
      preview: jest.fn(),
      onSeeking: jest.fn(),
      onError: jest.fn(),
    };
    return {options, controller: new VideoSeekController(options)};
  };
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('combines rapid presses into one seek after the last press', async () => {
    const {options, controller} = setup();
    controller.skip(10);
    jest.advanceTimersByTime(300);
    controller.skip(10);
    // A stale native position must not become the next skip's base.
    options.position.mockReturnValue(95);
    jest.advanceTimersByTime(300);
    controller.skip(10);
    jest.advanceTimersByTime(SEEK_DELAY_MS - 1);
    expect(options.apply).not.toHaveBeenCalled();
    expect(options.preview).toHaveBeenLastCalledWith(130);
    jest.advanceTimersByTime(1);
    await flush();
    expect(options.apply).toHaveBeenCalledTimes(1);
    expect(options.apply.mock.calls[0][0]).toBe(130);
    expect(controller.pending).toBe(false);
  });

  it('reverses direction from the pending target', async () => {
    const {options, controller} = setup();
    controller.skip(30);
    controller.skip(-10);
    controller.commit();
    await flush();
    expect(options.apply.mock.calls[0][0]).toBe(120);
  });

  it('clamps at the beginning and before the end, and ignores invalid input', () => {
    const {options, controller} = setup();
    controller.skip(-1000);
    expect(options.preview).toHaveBeenLastCalledWith(0);
    controller.skip(2000);
    expect(options.preview).toHaveBeenLastCalledWith(999);
    controller.request(NaN);
    controller.skip(Infinity);
    expect(options.preview).toHaveBeenCalledTimes(2);
    controller.cancel();
  });

  it('cancels a preview without issuing a seek', async () => {
    const {options, controller} = setup();
    controller.skip(10);
    controller.cancel();
    jest.advanceTimersByTime(SEEK_DELAY_MS);
    await flush();
    expect(options.apply).not.toHaveBeenCalled();
    expect(options.preview).toHaveBeenLastCalledWith(null);
  });

  it('retains only the latest queued target while a seek is in flight', async () => {
    const {options, controller} = setup();
    let complete!: () => void;
    options.apply.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    controller.skip(10);
    controller.commit();
    controller.skip(10);
    controller.skip(10);
    controller.skip(-5);
    jest.advanceTimersByTime(SEEK_DELAY_MS);
    expect(options.apply).toHaveBeenCalledTimes(1);
    complete();
    await flush();
    expect(options.apply.mock.calls.map(([target]) => target)).toEqual([
      110, 125,
    ]);
    expect(controller.seeking).toBe(false);
  });

  it('does not skip the new request’s debounce when an earlier seek finishes', async () => {
    const {options, controller} = setup();
    let complete!: () => void;
    options.apply.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    controller.skip(10);
    controller.commit();
    controller.skip(10);
    complete();
    await flush();
    expect(options.apply).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(SEEK_DELAY_MS);
    await flush();
    expect(options.apply.mock.calls[1][0]).toBe(120);
  });

  it('invalidates an in-flight continuation on teardown', async () => {
    const {options, controller} = setup();
    let complete!: () => void;
    options.apply.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    controller.skip(10);
    controller.commit();
    const signal = options.apply.mock.calls[0][1];
    controller.skip(10);
    controller.cancel();
    expect(signal.aborted).toBe(true);
    complete();
    jest.advanceTimersByTime(SEEK_DELAY_MS);
    await flush();
    expect(options.apply).toHaveBeenCalledTimes(1);
    expect(controller.pending).toBe(false);
  });

  it('dismisses queued intent without allowing overlapping native seeks', async () => {
    const {options, controller} = setup();
    let complete!: () => void;
    options.apply.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    controller.skip(10);
    controller.commit();
    controller.skip(10);
    controller.cancelPreview();
    expect(controller.pending).toBe(false);
    expect(controller.seeking).toBe(true);
    controller.skip(30);
    controller.commit();
    expect(options.apply).toHaveBeenCalledTimes(1);
    complete();
    await flush();
    expect(options.apply.mock.calls.map(([target]) => target)).toEqual([
      110, 130,
    ]);
  });

  it('clears failed requests and permits a later retry', async () => {
    const {options, controller} = setup();
    const error = new Error('decoder unavailable');
    options.apply.mockRejectedValueOnce(error);
    controller.skip(10);
    controller.commit();
    await flush();
    expect(options.onError).toHaveBeenCalledWith(error);
    expect(controller.pending).toBe(false);
    controller.skip(-10);
    controller.commit();
    await flush();
    expect(options.apply.mock.calls[1][0]).toBe(90);
  });
});

describe('seekMedia', () => {
  const setup = () => {
    const listeners = new Map<string, Set<() => void>>();
    const video = {
      currentTime: 10,
      addEventListener: (event: string, listener: () => void) => {
        const set = listeners.get(event) ?? new Set();
        set.add(listener);
        listeners.set(event, set);
      },
      removeEventListener: (event: string, listener: () => void) => {
        listeners.get(event)?.delete(listener);
      },
    };
    return {
      video,
      signal: new AbortController(),
      emit: (event: string) => listeners.get(event)?.forEach((fn) => fn()),
      listenerCount: () =>
        [...listeners.values()].reduce((n, set) => n + set.size, 0),
    };
  };
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('waits for seeked and removes its listeners', async () => {
    const {video, signal, emit, listenerCount} = setup();
    const done = jest.fn();
    const pending = seekMedia(video, 20, signal.signal).then(done);
    await flush();
    expect(video.currentTime).toBe(20);
    expect(done).not.toHaveBeenCalled();
    emit('seeked');
    await pending;
    expect(done).toHaveBeenCalled();
    expect(listenerCount()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('cleans up on cancellation and never seeks an already-aborted player', async () => {
    const {video, signal, listenerCount} = setup();
    const pending = seekMedia(video, 20, signal.signal);
    signal.abort();
    await pending;
    await seekMedia(video, 30, signal.signal);
    expect(video.currentTime).toBe(20);
    expect(listenerCount()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('bounds a missing native completion event', async () => {
    const {video, signal, listenerCount} = setup();
    const result = seekMedia(video, 20, signal.signal).catch((error) => error);
    jest.advanceTimersByTime(15000);
    expect(await result).toEqual(new Error('Video seek timed out'));
    expect(listenerCount()).toBe(0);
  });

  it('does not wait for seeked when already at the target', async () => {
    const {video, signal, listenerCount} = setup();
    await seekMedia(video, 10, signal.signal);
    expect(listenerCount()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('waits for playing rather than the SDK’s immediately resolved play promise', async () => {
    const {video, signal, emit, listenerCount} = setup();
    const done = jest.fn();
    const pending = playMedia(
      {...video, play: async () => {}},
      signal.signal,
    ).then(done);
    await flush();
    expect(done).not.toHaveBeenCalled();
    emit('playing');
    await pending;
    expect(done).toHaveBeenCalled();
    expect(listenerCount()).toBe(0);
  });

  it('cleans up a rejected native play request', async () => {
    const {video, signal, listenerCount} = setup();
    await expect(
      playMedia(
        {
          ...video,
          play: async () => {
            throw new Error('decoder failed');
          },
        },
        signal.signal,
      ),
    ).rejects.toThrow('decoder failed');
    expect(listenerCount()).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});
