export const SEEK_DELAY_MS = 800;

interface SeekOptions {
  position(): number;
  duration(): number;
  apply(target: number, signal: AbortController['signal']): Promise<void>;
  preview(target: number | null): void;
  onSeeking(active: boolean): void;
  onError(error: unknown): void;
}

/** Accumulate intent independently of the media clock; only one seek may run. */
export class VideoSeekController {
  private target: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private operation: AbortController | null = null;
  private ready = false;

  constructor(private readonly options: SeekOptions) {}

  get pending(): boolean {
    return this.target !== null;
  }

  get seeking(): boolean {
    return this.operation !== null;
  }

  skip(seconds: number): void {
    if (!Number.isFinite(seconds)) {
      return;
    }
    this.request((this.target ?? this.options.position()) + seconds);
  }

  request(seconds: number): void {
    if (!Number.isFinite(seconds)) {
      return;
    }
    const duration = this.options.duration();
    this.target = Math.max(
      0,
      duration > 0 ? Math.min(Math.max(0, duration - 1), seconds) : seconds,
    );
    this.ready = false;
    this.options.preview(this.target);
    this.clearTimer();
    this.timer = setTimeout(() => this.commit(), SEEK_DELAY_MS);
  }

  commit(): void {
    this.clearTimer();
    this.ready = true;
    this.run().catch(this.options.onError);
  }

  /** Dismiss intent without interrupting a native seek already issued. */
  cancelPreview(): void {
    this.clearTimer();
    this.ready = false;
    this.target = null;
    this.options.preview(null);
  }

  cancel(): void {
    this.clearTimer();
    this.operation?.abort();
    this.operation = null;
    this.options.onSeeking(false);
    this.ready = false;
    this.target = null;
    this.options.preview(null);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
    }
    this.timer = null;
  }

  private async run(): Promise<void> {
    if (this.operation || !this.ready || this.target === null) {
      return;
    }
    const target = this.target;
    const operation = new AbortController();
    this.operation = operation;
    this.options.onSeeking(true);
    this.ready = false;
    try {
      await this.options.apply(target, operation.signal);
    } catch (error) {
      if (operation.signal.aborted) {
        return;
      }
      this.cancel();
      this.options.onError(error);
      return;
    } finally {
      if (this.operation === operation) {
        this.operation = null;
        this.options.onSeeking(false);
      }
    }
    if (operation.signal.aborted) {
      return;
    }
    if (this.target === target) {
      this.clearTimer();
      this.target = null;
      this.options.preview(null);
    } else {
      // A newer request either has its own timer or is ready to run now.
      this.run().catch(this.options.onError);
    }
  }
}

interface SeekableMedia {
  currentTime: number;
  addEventListener(event: string, listener: () => void): void;
  removeEventListener(event: string, listener: () => void): void;
}

/** Observe completion before dispatch, including synchronous native events. */
const observeMediaOperation = (
  video: SeekableMedia,
  event: 'seeked' | 'playing',
  signal: AbortController['signal'],
  apply: () => void | Promise<void>,
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const operation = event === 'seeked' ? 'seek' : 'start';
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      video.removeEventListener(event, onComplete);
      video.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const onComplete = () => finish();
    const onError = () => finish(new Error(`Video ${operation} failed`));
    const onAbort = () => finish();
    const timer = setTimeout(
      () => finish(new Error(`Video ${operation} timed out`)),
      event === 'seeked' ? 15000 : 30000,
    );
    video.addEventListener(event, onComplete);
    video.addEventListener('error', onError);
    signal.addEventListener('abort', onAbort, {once: true});
    try {
      Promise.resolve(apply()).catch((error) =>
        finish(
          error instanceof Error
            ? error
            : new Error(`Video ${operation} failed`),
        ),
      );
    } catch (error) {
      finish(
        error instanceof Error ? error : new Error(`Video ${operation} failed`),
      );
    }
  });

export const seekMedia = (
  video: SeekableMedia,
  target: number,
  signal: AbortController['signal'],
): Promise<void> => {
  if (signal.aborted || Math.abs(video.currentTime - target) < 0.01) {
    return Promise.resolve();
  }
  return observeMediaOperation(video, 'seeked', signal, () => {
    video.currentTime = target;
  });
};

/** Vega's play() promise only acknowledges dispatch; wait for real playback. */
export const playMedia = (
  video: SeekableMedia & {play(): void | Promise<void>},
  signal: AbortController['signal'],
): Promise<void> =>
  observeMediaOperation(video, 'playing', signal, () => video.play());
