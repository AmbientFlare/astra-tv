import {
  TELEMETRY_ENDPOINT,
  TELEMETRY_TOKEN,
  TELEMETRY_MAX_BATCH,
  TELEMETRY_QUEUE_CAPACITY,
  TELEMETRY_FLUSH_INTERVAL_MS,
  TELEMETRY_REQUEST_TIMEOUT_MS,
  TELEMETRY_BACKOFF_START_MS,
  TELEMETRY_BACKOFF_MAX_MS,
} from './config';
import type {TelemetryEvent} from './envelope';

const MAX_EVENT_BYTES = 32 * 1024;
const MAX_BATCH_BYTES = 256 * 1024;

export interface TelemetryTransportOptions {
  onDelivered?: (events: readonly TelemetryEvent[]) => void;
}

type SendResult = {accepted: number; complete: boolean};

/** A bounded, fail-safe, ordered telemetry sender. */
export class TelemetryTransport {
  private queue: TelemetryEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<void> | undefined;
  private flushAgain = false;
  private backoffMs = 0;
  private nextAttemptAt = 0;
  private stopped = false;
  private generation = 0;
  private activeAbort?: AbortController;
  private readonly onDelivered?: (events: readonly TelemetryEvent[]) => void;

  readonly counters = {queued: 0, sent: 0, dropped: 0, failed: 0};

  constructor(options: TelemetryTransportOptions = {}) {
    this.onDelivered = options.onDelivered;
  }

  enqueue(event: TelemetryEvent, immediate = false): void {
    if (this.stopped) {
      return;
    }
    if (this.bytes(event) > MAX_EVENT_BYTES) {
      this.counters.dropped += 1;
      return;
    }
    this.queue.push(event);
    this.counters.queued += 1;
    if (this.queue.length > TELEMETRY_QUEUE_CAPACITY) {
      const count = this.queue.length - TELEMETRY_QUEUE_CAPACITY;
      this.queue.splice(0, count);
      this.counters.dropped += count;
    }
    if (immediate) {
      void this.flush();
    } else {
      this.schedule(TELEMETRY_FLUSH_INTERVAL_MS);
    }
  }

  flush(): Promise<void> {
    if (this.stopped) {
      return Promise.resolve();
    }
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.inFlight) {
      this.flushAgain = true;
      return this.inFlight;
    }
    this.inFlight = this.drain()
      .catch(() => undefined)
      .finally(() => {
        this.inFlight = undefined;
        if (this.flushAgain && !this.stopped) {
          this.flushAgain = false;
          void this.flush();
        }
      });
    return this.inFlight;
  }

  private schedule(delay: number): void {
    if (this.timer !== undefined || this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, delay);
  }

  private async drain(): Promise<void> {
    if (this.stopped || this.queue.length === 0) {
      return;
    }
    const now = Date.now();
    if (now < this.nextAttemptAt) {
      this.schedule(this.nextAttemptAt - now);
      return;
    }
    const batch: TelemetryEvent[] = [];
    let bytes = this.bytes({batch});
    while (batch.length < TELEMETRY_MAX_BATCH && this.queue.length > 0) {
      const candidate = this.queue[0];
      const next = bytes + this.bytes(candidate) + (batch.length ? 1 : 0);
      if (batch.length > 0 && next > MAX_BATCH_BYTES) {
        break;
      }
      batch.push(this.queue.shift()!);
      bytes = next;
    }
    const generation = this.generation;
    const result = await this.post(batch);
    if (this.stopped || generation !== this.generation) {
      return;
    }
    if (result.accepted > 0) {
      const delivered = batch.slice(0, result.accepted);
      this.counters.sent += delivered.length;
      try {
        this.onDelivered?.(delivered);
      } catch {
        /* callback is non-critical */
      }
    }
    if (result.complete) {
      this.backoffMs = 0;
      this.nextAttemptAt = 0;
      if (this.queue.length > 0) {
        this.schedule(TELEMETRY_FLUSH_INTERVAL_MS);
      }
    } else {
      this.counters.failed += 1;
      const unaccepted = batch.slice(result.accepted);
      const room = Math.max(0, TELEMETRY_QUEUE_CAPACITY - this.queue.length);
      if (unaccepted.length > room) {
        this.counters.dropped += unaccepted.length - room;
      }
      this.queue = unaccepted.slice(0, room).concat(this.queue);
      this.backoffMs =
        this.backoffMs === 0
          ? TELEMETRY_BACKOFF_START_MS
          : Math.min(this.backoffMs * 2, TELEMETRY_BACKOFF_MAX_MS);
      this.nextAttemptAt = Date.now() + this.backoffMs;
      if (this.timer !== undefined) {
        clearTimeout(this.timer);
        this.timer = undefined;
      }
      this.schedule(this.backoffMs);
    }
  }

  private async post(batch: TelemetryEvent[]): Promise<SendResult> {
    const controller =
      typeof AbortController === 'function' ? new AbortController() : undefined;
    this.activeAbort = controller;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const request = (async () => {
      try {
        const response = await fetch(TELEMETRY_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Astra-Token': TELEMETRY_TOKEN,
          },
          body: JSON.stringify({batch}),
          signal: controller?.signal,
        });
        if (!response.ok) {
          return {accepted: 0, complete: false};
        }
        let accepted = batch.length;
        try {
          const body = (await response.json()) as {accepted?: unknown};
          if (typeof body?.accepted === 'number') {
            accepted = Math.max(
              0,
              Math.min(batch.length, Math.floor(body.accepted)),
            );
          }
        } catch {
          /* an empty response means all accepted */
        }
        return {accepted, complete: accepted === batch.length};
      } catch {
        return {accepted: 0, complete: false};
      }
    })();
    const deadline = new Promise<SendResult>((resolve) => {
      timeout = setTimeout(() => {
        controller?.abort();
        resolve({accepted: 0, complete: false});
      }, TELEMETRY_REQUEST_TIMEOUT_MS);
    });
    try {
      return await Promise.race([request, deadline]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      if (this.activeAbort === controller) {
        this.activeAbort = undefined;
      }
    }
  }

  private bytes(value: unknown): number {
    try {
      const text = JSON.stringify(value);
      let bytes = 0;
      for (let i = 0; i < text.length; i += 1) {
        const code = text.charCodeAt(i);
        if (code < 0x80) {
          bytes += 1;
        } else if (code < 0x800) {
          bytes += 2;
        } else if (
          code >= 0xd800 &&
          code <= 0xdbff &&
          i + 1 < text.length &&
          text.charCodeAt(i + 1) >= 0xdc00
        ) {
          bytes += 4;
          i += 1;
        } else {
          bytes += 3;
        }
      }
      return bytes;
    } catch {
      return MAX_EVENT_BYTES + 1;
    }
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    this.activeAbort?.abort();
    this.activeAbort = undefined;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }
    this.timer = undefined;
    this.queue = [];
    this.flushAgain = false;
  }
}
