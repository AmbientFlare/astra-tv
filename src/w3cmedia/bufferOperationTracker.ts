type SourceBufferLike = {
  updating?: boolean;
  addEventListener?: (event: string, listener: (error?: unknown) => void) => void;
  removeEventListener?: (
    event: string,
    listener: (error?: unknown) => void,
  ) => void;
};

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
    trackedOperation = this.waitForUpdate(sourceBuffer, action)
      .catch((error) => {
        // The player also receives the SourceBuffer error event. Do not let a
        // failed native operation permanently block seek or teardown.
        console.warn('[Astra] Tracked MSE operation failed:', error);
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
    while (this.pendingOperations.size > 0) {
      await Promise.all(Array.from(this.pendingOperations));
    }
  }

  private waitForUpdate(
    sourceBuffer: SourceBufferLike,
    action: () => void,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        sourceBuffer.removeEventListener?.('updateend', onUpdateEnd);
        sourceBuffer.removeEventListener?.('abort', onAbort);
        sourceBuffer.removeEventListener?.('error', onError);
      };
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

      sourceBuffer.addEventListener?.('updateend', onUpdateEnd);
      sourceBuffer.addEventListener?.('abort', onAbort);
      sourceBuffer.addEventListener?.('error', onError);

      try {
        action();
      } catch (error) {
        finish(error);
        return;
      }

      Promise.resolve().then(() => {
        if (!sourceBuffer.updating) {
          finish();
        }
      });
    });
  }
}
