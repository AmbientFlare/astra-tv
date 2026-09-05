export interface PlaybackFailure {
  source: 'native' | 'shaka' | 'mse' | 'watchdog' | 'early-end';
  code?: number;
  category?: number;
  severity?: number;
  httpStatus?: number;
  requestType?: number;
}

/** Allowlist metadata: never copy request URLs, headers, or response bodies. */
export const shakaFailure = (error: unknown): PlaybackFailure => {
  const detail = error as {
    code?: unknown;
    category?: unknown;
    severity?: unknown;
    data?: unknown[];
  } | null;
  const numeric = (value: unknown): number | undefined =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const failure: PlaybackFailure = {
    source: 'shaka',
    code: numeric(detail?.code),
    category: numeric(detail?.category),
    severity: numeric(detail?.severity),
  };
  const data = detail?.data;
  if (failure.code === 1001 && Array.isArray(data)) {
    const status = numeric(data[1]);
    if (
      status !== undefined &&
      Number.isInteger(status) &&
      status >= 100 &&
      status <= 599
    ) {
      failure.httpStatus = status;
    }
    const type = numeric(data[4]);
    if (
      type !== undefined &&
      Number.isInteger(type) &&
      type >= 0 &&
      type <= 8
    ) {
      failure.requestType = type;
    }
  }
  return failure;
};

export const formatPlaybackFailure = (failure: PlaybackFailure): string =>
  `source=${failure.source} code=${failure.code ?? '?'} category=${
    failure.category ?? '?'
  } severity=${failure.severity ?? '?'}` +
  (failure.httpStatus === undefined ? '' : ` http=${failure.httpStatus}`) +
  (failure.requestType === undefined
    ? ''
    : ` request=${
        failure.requestType === 0
          ? 'manifest'
          : failure.requestType === 1
          ? 'segment'
          : failure.requestType
      }`);

export const formatBufferingTime = (seconds?: number): string =>
  seconds !== undefined && Number.isFinite(seconds) && seconds >= 0
    ? `${seconds.toFixed(1)}s`
    : '—';

/** Only a decoder/media error warrants changing the requested codec policy. */
export const isMediaFailure = (failure: PlaybackFailure) =>
  (failure.source === 'native' && (failure.code === 3 || failure.code === 4)) ||
  (failure.source === 'shaka' && failure.category === 3);

export const shouldForceVideoConversion = (
  decoderRequiresConversion: boolean,
  subtitleBurnIn: boolean,
) => decoderRequiresConversion || subtitleBurnIn;

/**
 * Detect lack of forward progress only during active playback. Starting,
 * paused and intentionally completed sessions never spend the stall budget.
 * Buffer snapshots are logged by the caller to distinguish starvation/gaps.
 */
export class PlaybackHealthMonitor {
  private position = 0;
  private progressAt: number | null = null;
  constructor(private readonly timeoutMs = 30000) {}

  reset() {
    this.progressAt = null;
  }

  observe(now: number, position: number, active: boolean): boolean {
    if (!active || !Number.isFinite(position)) {
      this.reset();
      return false;
    }
    if (this.progressAt === null || Math.abs(position - this.position) > 0.25) {
      this.position = position;
      this.progressAt = now;
      return false;
    }
    if (now - this.progressAt < this.timeoutMs) {
      return false;
    }
    this.reset();
    return true;
  }
}
