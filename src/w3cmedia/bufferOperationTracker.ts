type SourceBufferLike = {
  updating?: boolean;
  addEventListener?: (
    event: string,
    listener: (error?: unknown) => void,
  ) => void;
  removeEventListener?: (
    event: string,
    listener: (error?: unknown) => void,
  ) => void;
};

export class BufferOperationTimeoutError extends Error {
  name = 'BufferOperationTimeoutError';
  constructor() {
    super('Timed out waiting for SourceBuffer operation');
  }
}

/**
 * Observes native MSE work without deferring the operation itself.
 *
 * SourceBuffer methods must run synchronously so `updating` changes before
 * returning to Shaka. Deferring them behind a JavaScript queue breaks that
 * contract and makes Shaka over-fetch while the native queue drains.
 */
export class BufferOperationTracker {
  private activeAppendCount = 0;
  private pendingOperations: Set<Promise<void>> = new Set();
  private pendingFailure: unknown;
  constructor(private readonly onFailure?: (error: unknown) => void) {}

  hasPendingOperations(): boolean {
    return this.activeAppendCount > 0 || this.pendingOperations.size > 0;
  }

  track(
    sourceBuffer: SourceBufferLike,
    action: () => void,
    append: boolean,
  ): void {
    if (append) {
      this.activeAppendCount += 1;
    }

    let trackedOperation: Promise<void>;
    try {
      trackedOperation = this.waitForUpdate(sourceBuffer, action);
    } catch (error) {
      if (append)
        this.activeAppendCount = Math.max(0, this.activeAppendCount - 1);
      throw error;
    }
    trackedOperation = trackedOperation
      .catch((error) => {
        this.pendingFailure ??= error;
        try {
          this.onFailure?.(error);
        } catch {
          /* Observers cannot alter native semantics. */
        }
      })
      .finally(() => {
        this.pendingOperations.delete(trackedOperation);
        if (append) {
          this.activeAppendCount = Math.max(0, this.activeAppendCount - 1);
        }
      });
    this.pendingOperations.add(trackedOperation);
  }

  async waitForComplete(): Promise<void> {
    if (this.pendingFailure !== undefined) {
      const failure = this.pendingFailure;
      this.pendingFailure = undefined;
      throw failure;
    }
    while (this.pendingOperations.size > 0) {
      await Promise.all(Array.from(this.pendingOperations));
    }
    if (this.pendingFailure !== undefined) {
      const failure = this.pendingFailure;
      this.pendingFailure = undefined;
      throw failure;
    }
  }

  private waitForUpdate(
    sourceBuffer: SourceBufferLike,
    action: () => void,
  ): Promise<void> {
    let cancelObservation = () => {};
    const observation = new Promise<void>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        sourceBuffer.removeEventListener?.('updateend', onUpdateEnd);
        sourceBuffer.removeEventListener?.('abort', onAbort);
        sourceBuffer.removeEventListener?.('error', onError);
        clearTimeout(timeout);
      };
      cancelObservation = cleanup;
      const finish = (error?: unknown) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const onUpdateEnd = () => finish();
      const onAbort = () => finish();
      const onError = (error?: unknown) =>
        finish(error ?? new Error('SourceBuffer error'));
      const timeout = setTimeout(
        () => finish(new BufferOperationTimeoutError()),
        30000,
      );

      sourceBuffer.addEventListener?.('updateend', onUpdateEnd);
      sourceBuffer.addEventListener?.('abort', onAbort);
      sourceBuffer.addEventListener?.('error', onError);

      Promise.resolve().then(() => {
        if (!sourceBuffer.updating) {
          finish();
        }
      });
    });
    // Invoke outside the Promise executor: native exceptions must remain
    // synchronous exceptions to Shaka.
    try {
      action();
    } catch (error) {
      cancelObservation();
      throw error;
    }
    return observation;
  }
}
