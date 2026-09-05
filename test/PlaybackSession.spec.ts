import {
  OrderedPlaybackReporter,
  PlaybackSessionController,
} from '../src/services/playbackSession';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return {promise, resolve};
};

describe('playback session transactions', () => {
  it('does not let the next screen attach before the previous screen releases', async () => {
    const previous = new PlaybackSessionController();
    const next = new PlaybackSessionController();
    const gate = deferred();
    const cleanup = previous.dispose(() => gate.promise);
    const attach = jest.fn(async () => undefined);
    const startup = next.replace(attach);
    await Promise.resolve();
    expect(attach).not.toHaveBeenCalled();
    gate.resolve();
    await Promise.all([cleanup, startup]);
    expect(attach).toHaveBeenCalledTimes(1);
  });
  it('invalidates pending work, skips obsolete queued work, and orders replacement', async () => {
    const controller = new PlaybackSessionController();
    const gate = deferred();
    const calls: string[] = [];
    const first = controller.replace(async (context) => {
      calls.push('first');
      await gate.promise;
      expect(context.signal.aborted).toBe(true);
      context.assertCurrent();
      calls.push('stale commit');
    });
    const firstResult = first.catch((error) => error.name);
    await Promise.resolve();
    const obsolete = controller.replace(async () => {
      calls.push('obsolete');
    });
    const obsoleteResult = obsolete.catch((error) => error.name);
    const last = controller.replace(async () => {
      calls.push('last');
    });
    expect(calls).toEqual(['first']);
    gate.resolve();
    await last;
    expect(await firstResult).toBe('PlaybackCancelledError');
    expect(await obsoleteResult).toBe('PlaybackCancelledError');
    expect(calls).toEqual(['first', 'last']);
  });
  it('aborts on disposal and shares one cleanup, even after a load failure', async () => {
    const controller = new PlaybackSessionController();
    await controller
      .replace(async () => {
        throw new Error('load');
      })
      .catch(() => undefined);
    const gate = deferred();
    const cleanup = jest.fn(() => gate.promise);
    const a = controller.dispose(cleanup);
    const b = controller.dispose(cleanup);
    expect(a).toBe(b);
    await Promise.resolve();
    expect(cleanup).toHaveBeenCalledTimes(1);
    gate.resolve();
    await a;
    await expect(controller.replace(async () => undefined)).rejects.toThrow(
      'disposed',
    );
  });
});

describe('ordered Jellyfin reports', () => {
  it('orders start before the latest progress and stop; ignores late progress', async () => {
    const gate = deferred();
    const sent: string[] = [];
    const reporter = new OrderedPlaybackReporter<number>(
      async (event, value) => {
        sent.push(event + ':' + value);
        if (event === 'start') await gate.promise;
      },
    );
    await reporter.progress(0);
    void reporter.start(0);
    void reporter.progress(1);
    const latest = reporter.progress(2);
    await Promise.resolve();
    expect(sent).toEqual(['start:0']);
    gate.resolve();
    await latest;
    await reporter.stop(3);
    await reporter.progress(4);
    expect(sent).toEqual(['start:0', 'progress:2', 'stop:3']);
  });
  it('discards queued progress on stop and sends stop after in-flight progress', async () => {
    const gate = deferred();
    const sent: string[] = [];
    const reporter = new OrderedPlaybackReporter<number>(
      async (event, value) => {
        sent.push(event + ':' + value);
        if (event === 'progress') await gate.promise;
      },
    );
    await reporter.start(0);
    void reporter.progress(1);
    await Promise.resolve();
    void reporter.progress(2);
    const stop = reporter.stop(3);
    gate.resolve();
    await stop;
    expect(sent).toEqual(['start:0', 'progress:1', 'stop:3']);
  });
  it('failed telemetry does not reject playback or prevent stop', async () => {
    const send = jest.fn(async () => {
      throw new Error('offline');
    });
    const reporter = new OrderedPlaybackReporter<number>(send);
    await expect(reporter.start(0)).resolves.toBeUndefined();
    await expect(reporter.stop(3)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(2);
  });
});
