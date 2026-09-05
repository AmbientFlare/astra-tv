import {getTraces} from '../logging/trace';
import {getItem, setItem, removeItem} from '../storageAdapter';
import {scrubText} from './envelope';

const KEY = 'astra.telemetry.crashtail.v1';
const PENDING_KEY = 'astra.telemetry.crashtail.pending.v1';
const CLEAN_KEY = 'astra.telemetry.cleanexit.v1';
const INTERVAL = 30000;
const MAX_AGE = 14 * 24 * 60 * 60 * 1000;

export interface CrashTail {
  traces: Array<{label: string; detail: string; atMs: number}>;
  savedAtMs: number;
  sid?: string;
  cleanExit?: boolean;
}

let timer: ReturnType<typeof setInterval> | undefined;
let preparePromise:
  | Promise<(CrashTail & {cleanExit: boolean}) | undefined>
  | undefined;
let original: (CrashTail & {cleanExit: boolean}) | undefined;
const pendingWrites = new Map<string, () => Promise<void>>();
let writer: Promise<void> | undefined;
// At most one native write and one latest request per storage key. A stalled
// native store cannot accumulate an unbounded chain of timer callbacks.
const write = (key: string, action: () => Promise<void>): Promise<void> => {
  pendingWrites.set(key, action);
  if (!writer) {
    writer = Promise.resolve()
      .then(async () => {
        while (pendingWrites.size) {
          const [nextKey, nextAction] = pendingWrites.entries().next().value!;
          pendingWrites.delete(nextKey);
          try {
            await nextAction();
          } catch {
            /* best effort */
          }
        }
      })
      .finally(() => {
        writer = undefined;
      });
  }
  return writer;
};

const valid = (value: unknown): value is CrashTail => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as CrashTail;
  return (
    Number.isFinite(item.savedAtMs) &&
    item.savedAtMs <= Date.now() &&
    Date.now() - item.savedAtMs <= MAX_AGE &&
    (item.sid === undefined ||
      (typeof item.sid === 'string' && item.sid.length <= 128)) &&
    Array.isArray(item.traces) &&
    item.traces.length <= 40 &&
    item.traces.every(
      (t) =>
        t &&
        typeof t.label === 'string' &&
        t.label.length <= 128 &&
        typeof t.detail === 'string' &&
        t.detail.length <= 2000 &&
        Number.isFinite(t.atMs),
    )
  );
};

const safeRead = async (key: string): Promise<CrashTail | undefined> => {
  try {
    const raw = await getItem(key);
    if (!raw || raw.length > 65536) {
      return undefined;
    }
    const parsed = JSON.parse(raw);
    return valid(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

export const prepareCrashTail = async (): Promise<
  (CrashTail & {cleanExit: boolean}) | undefined
> => {
  if (preparePromise) {
    return preparePromise;
  }
  preparePromise = (async () => {
    try {
      const pending = await safeRead(PENDING_KEY);
      const prior = pending ?? (await safeRead(KEY));
      const cleanExit =
        pending?.cleanExit ?? (await getItem(CLEAN_KEY)) === '1';
      if (!pending && prior) {
        await setItem(PENDING_KEY, JSON.stringify({...prior, cleanExit}));
      }
      original = prior ? {...prior, cleanExit} : undefined;
      await markActive();
      return original;
    } catch {
      return original;
    }
  })();
  return preparePromise;
};

export const persistCrashTail = async (sid?: string): Promise<void> => {
  await write(KEY, async () => {
    try {
      const traces = getTraces()
        .slice(-40)
        .map(({label, detail, atMs}) => ({
          label: scrubText(label).slice(0, 128),
          detail: scrubText(detail).slice(0, 300),
          atMs,
        }));
      if (!traces.length) {
        return;
      }
      await setItem(KEY, JSON.stringify({traces, savedAtMs: Date.now(), sid}));
    } catch {
      /* telemetry must never affect playback */
    }
  });
};

export const acknowledgeCrashTail = async (
  savedAtMs: number,
): Promise<void> => {
  await write(PENDING_KEY, async () => {
    const pending = await safeRead(PENDING_KEY);
    if (pending?.savedAtMs === savedAtMs) {
      await removeItem(PENDING_KEY);
    }
  });
};
export const markActive = (): Promise<void> =>
  write(CLEAN_KEY, () => setItem(CLEAN_KEY, '0'));
export const markCleanExit = (): Promise<void> =>
  write(CLEAN_KEY, () => setItem(CLEAN_KEY, '1'));
export const startCrashTailPersistence = (
  sessionProvider?: () => {sid?: string},
): void => {
  if (timer !== undefined) {
    return;
  }
  timer = setInterval(() => {
    void persistCrashTail(sessionProvider?.()?.sid);
  }, INTERVAL);
};
export const stopCrashTailPersistence = (): void => {
  if (timer !== undefined) {
    clearInterval(timer);
  }
  timer = undefined;
};
