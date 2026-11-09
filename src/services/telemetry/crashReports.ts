/**
 * Crash reports for everyone, on by default with a switch in Settings.
 *
 * Amazon's crash data carries no JavaScript context: a native crash in the
 * media stack arrives as a bare stack, and a system kill as no stack at all.
 * What makes a crash fixable is what Astra was doing just before it, which is
 * the crash tail (crashTail.ts). When the previous run ended without a clean
 * exit, that tail goes to the public endpoint on the next launch.
 *
 * Only the tail is sent: action labels, timings and numbers, plus the
 * playback it happened in (codecs, resolution, buffer; see playbackStats.ts).
 * URLs and IP addresses are replaced before anything leaves the device, and
 * there is no install, account or session id.
 */
import {APP_VERSION, BUILD_NUMBER} from '../../config/app';
import {readDeviceModel} from '../deviceModel';
import {getItem, setItem} from '../storageAdapter';
import {CRASH_REPORT_ENDPOINT, TELEMETRY_REQUEST_TIMEOUT_MS} from './config';
import type {CrashTail} from './crashTail';
import {scrubText} from './envelope';

const ENABLED_KEY = 'astra.crashreports.enabled.v1';

/** On unless the viewer has turned it off. */
export const readCrashReportsEnabled = async (): Promise<boolean> => {
  try {
    return (await getItem(ENABLED_KEY)) !== '0';
  } catch {
    return true;
  }
};

export const storeCrashReportsEnabled = async (
  enabled: boolean,
): Promise<void> => {
  await setItem(ENABLED_KEY, enabled ? '1' : '0');
};

/** The operator scrub, plus anything that would say whose server this is. */
export const scrubForCrashReport = (text: string): string =>
  scrubText(text)
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*/gi, '<url>')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '<ip>')
    .replace(/\[?[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){4,7}\]?/gi, '<ip>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>');

/** Numbers and flags pass; strings are scrubbed and short; one level of nesting. */
const scrubContext = (
  value: unknown,
  depth = 0,
): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 40)) {
    if (typeof item === 'number' && Number.isFinite(item)) {
      result[key] = item;
    } else if (typeof item === 'boolean') {
      result[key] = item;
    } else if (typeof item === 'string') {
      result[key] = scrubForCrashReport(item).slice(0, 160);
    } else if (Array.isArray(item)) {
      result[key] = item
        .slice(0, 8)
        .filter((entry) => typeof entry === 'string')
        .map((entry) => scrubForCrashReport(entry).slice(0, 40));
    } else if (depth === 0) {
      result[key] = scrubContext(item, 1);
    }
  }
  return result;
};

/**
 * `inst` is the same random id the usage stats carry, replaced every calendar
 * month. It tells one stick crashing thirty times from thirty sticks crashing
 * once, and cannot follow anyone past the month.
 */
export const crashReportBody = (
  tail: CrashTail & {cleanExit: boolean},
  inst?: string,
) => ({
  v: 1,
  ts: Date.now(),
  ...(inst ? {inst} : {}),
  app: APP_VERSION,
  build: BUILD_NUMBER,
  ...readDeviceModel(),
  ev: 'app.crashtail',
  d: {
    savedAtMs: tail.savedAtMs,
    cleanExit: tail.cleanExit,
    traces: tail.traces.map(({label, detail, atMs}) => ({
      label: scrubForCrashReport(label),
      detail: scrubForCrashReport(detail),
      atMs,
    })),
    ctx: scrubContext(tail.ctx),
  },
});

/** Resolves true once the endpoint has accepted the report. */
export const sendCrashReport = async (
  tail: CrashTail & {cleanExit: boolean},
  inst?: string,
): Promise<boolean> => {
  if (!CRASH_REPORT_ENDPOINT) {
    return false;
  }
  const abort =
    typeof AbortController === 'function' ? new AbortController() : undefined;
  const timer = setTimeout(() => abort?.abort(), TELEMETRY_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(CRASH_REPORT_ENDPOINT, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(crashReportBody(tail, inst)),
      signal: abort?.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
};
