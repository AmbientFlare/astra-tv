/**
 * Structured playback traces, readable on-device in Stats for Nerds.
 *
 * JS console output does not reach any log artifact that `vega device
 * copy-logs` can retrieve — `main/var_log` carries only system syslog, with no
 * ReactNativeJS or console lines at all. Diagnostics therefore have to be
 * surfaced in the app itself rather than pulled off the device.
 *
 * Traces are deliberately few and cheap: the ANR under investigation is caused
 * by blocking the JS thread, so instrumentation must not add meaningful work.
 */

const TRACE_CAPACITY = 40;

export interface PlaybackTrace {
  label: string;
  detail: string;
  atMs: number;
}

const traces: PlaybackTrace[] = [];
let originMs: number | null = null;

/** Records one trace. Never throws; callers are on the playback hot path. */
export const trace = (label: string, detail: string = ''): void => {
  try {
    const atMs = Date.now();
    if (originMs === null) {
      originMs = atMs;
    }
    traces.push({label, detail, atMs});
    if (traces.length > TRACE_CAPACITY) {
      traces.shift();
    }
  } catch {
    // Diagnostics must never break playback.
  }
};

/** Traces oldest first, with times relative to the first trace recorded. */
export const getTraces = (): Array<PlaybackTrace & {sinceStartMs: number}> =>
  traces.map((entry) => ({
    ...entry,
    sinceStartMs: originMs === null ? 0 : entry.atMs - originMs,
  }));

export const resetTraces = (): void => {
  traces.length = 0;
  originMs = null;
};
