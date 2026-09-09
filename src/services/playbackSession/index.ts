export class PlaybackCancelledError extends Error {
  constructor(message = 'Playback session was cancelled') {
    super(message);
    this.name = 'PlaybackCancelledError';
  }
}

export const isPlaybackCancelled = (
  error: unknown,
): error is PlaybackCancelledError =>
  error instanceof PlaybackCancelledError ||
  (error instanceof Error && error.name === 'PlaybackCancelledError');

export interface PlaybackSessionContext {
  readonly generation: number;
  readonly signal: AbortController['signal'];
  isCurrent(): boolean;
  assertCurrent(): void;
}

export class PlaybackSessionController {
  // Different PlayerScreen instances must not overlap native transitions.
  // Surface teardown and the next screen's startup run through this barrier.
  private static nativeQueue: Promise<unknown> = Promise.resolve();
  private generationValue = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private cleanupPromise?: Promise<void>;
  private abortController = new AbortController();

  get generation(): number {
    return this.generationValue;
  }

  invalidate(): void {
    this.abortController.abort();
    this.abortController = new AbortController();
    this.generationValue += 1;
  }

  replace<T>(
    operation: (context: PlaybackSessionContext) => Promise<T>,
  ): Promise<T> {
    if (this.disposed)
      return Promise.reject(
        new PlaybackCancelledError('Playback session disposed'),
      );
    this.invalidate();
    const generation = this.generationValue;
    const context: PlaybackSessionContext = {
      generation,
      signal: this.abortController.signal,
      isCurrent: () => !this.disposed && this.generationValue === generation,
      assertCurrent: () => {
        if (!context.isCurrent()) throw new PlaybackCancelledError();
      },
    };
    const run = PlaybackSessionController.nativeQueue.then(() => {
      context.assertCurrent();
      return operation(context);
    });
    this.queue = run.catch(() => undefined);
    PlaybackSessionController.nativeQueue = this.queue;
    return run;
  }

  dispose(cleanup: () => Promise<void>): Promise<void> {
    if (this.cleanupPromise) return this.cleanupPromise;
    this.disposed = true;
    this.invalidate();
    this.cleanupPromise = PlaybackSessionController.nativeQueue.then(() =>
      cleanup(),
    );
    this.queue = this.cleanupPromise.catch(() => undefined);
    PlaybackSessionController.nativeQueue = this.queue;
    return this.cleanupPromise;
  }
}

export type PlaybackReportEvent = 'start' | 'progress' | 'stop';

export class OrderedPlaybackReporter<T> {
  private chain: Promise<void> = Promise.resolve();
  private progressValue?: T;
  private progressQueued = false;
  private stopped = false;
  private started = false;

  constructor(
    private readonly send: (
      event: PlaybackReportEvent,
      value: T,
    ) => Promise<void>,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  start(value: T): Promise<void> {
    if (this.stopped || this.started) return Promise.resolve();
    this.started = true;
    return this.enqueue('start', value);
  }

  progress(value: T): Promise<void> {
    if (this.stopped || !this.started) return Promise.resolve();
    this.progressValue = value;
    if (this.progressQueued) return this.chain;
    this.progressQueued = true;
    this.chain = this.chain.then(async () => {
      const next = this.progressValue;
      this.progressQueued = false;
      this.progressValue = undefined;
      if (next !== undefined && !this.stopped)
        await this.safeSend('progress', next);
    });
    return this.chain;
  }

  stop(value: T): Promise<void> {
    if (this.stopped) return this.chain;
    this.stopped = true;
    this.progressValue = undefined;
    this.progressQueued = false;
    this.chain = this.chain.then(() => this.safeSend('stop', value));
    return this.chain;
  }

  private enqueue(event: PlaybackReportEvent, value: T): Promise<void> {
    this.chain = this.chain.then(() => this.safeSend(event, value));
    return this.chain;
  }

  private async safeSend(event: PlaybackReportEvent, value: T): Promise<void> {
    try {
      await this.send(event, value);
    } catch (error) {
      try {
        this.onError(error);
      } catch {
        /* Reporting cannot fail playback. */
      }
    }
  }
}
