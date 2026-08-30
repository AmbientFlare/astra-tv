/**
 * Release console shim.
 *
 * On Vega OS 1.2 the native logging bridge blocks the JS thread. A
 * symbolicated ANR from build 20260829.2 showed the thread parked inside
 * `@react-native/js-polyfills/console.js`, reached from Amazon's
 * `keplermediadescriptor` by way of `react-native-w3cmedia` during a Shaka
 * segment append. The Fire TV thread monitor then killed the app, which is why
 * resume, audio switching and burn-in subtitle changes all failed: they are the
 * chattiest paths.
 *
 * Every caller — Astra, Shaka, w3cmedia and Amazon's own libraries — funnels
 * through the one global console, so replacing it here cuts the blocking path
 * for all of them. Messages are kept in a small ring buffer so Release builds
 * still have something to show for diagnosis.
 *
 * `console.error` is deliberately left alone: genuine errors are rare, and
 * losing them would cost more than the residual risk of a blocking write.
 */

const RING_CAPACITY = 200;
const MAX_MESSAGE_LENGTH = 300;

export interface CapturedLog {
  level: 'log' | 'info' | 'warn';
  message: string;
  atMs: number;
}

const ring: CapturedLog[] = [];
let installed = false;

/** Cheap, allocation-light rendering; never throws on exotic arguments. */
const renderArguments = (args: unknown[]): string => {
  let rendered = '';
  for (let index = 0; index < args.length; index += 1) {
    if (rendered.length >= MAX_MESSAGE_LENGTH) {
      break;
    }
    const value = args[index];
    let piece: string;
    try {
      piece = typeof value === 'string' ? value : String(value);
    } catch {
      piece = '[unrenderable]';
    }
    rendered = rendered ? `${rendered} ${piece}` : piece;
  }
  return rendered.length > MAX_MESSAGE_LENGTH
    ? `${rendered.slice(0, MAX_MESSAGE_LENGTH)}…`
    : rendered;
};

const record = (level: CapturedLog['level'], args: unknown[]): void => {
  ring.push({level, message: renderArguments(args), atMs: Date.now()});
  if (ring.length > RING_CAPACITY) {
    ring.shift();
  }
};

/** Most recent captured entries, oldest first. */
export const getCapturedLogs = (): CapturedLog[] => ring.slice();

/** Test seam. */
export const resetCapturedLogs = (): void => {
  ring.length = 0;
  installed = false;
};

/**
 * Replaces console.log/info/warn with ring-buffer writers.
 *
 * `force` exists for tests; production callers pass nothing and the shim is
 * skipped in development so Metro logging keeps working.
 */
export const installReleaseConsole = (force = false): boolean => {
  const isDevelopment =
    typeof __DEV__ !== 'undefined' && (__DEV__ as boolean) === true;
  if (installed || (isDevelopment && !force)) {
    return false;
  }
  installed = true;

  console.log = (...args: unknown[]) => record('log', args);
  console.info = (...args: unknown[]) => record('info', args);
  console.warn = (...args: unknown[]) => record('warn', args);

  return true;
};
