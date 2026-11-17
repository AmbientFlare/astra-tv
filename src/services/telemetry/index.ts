import {initializeDeviceIdentity} from '../deviceIdentity';
import {getCapturedLogs} from '../logging';
import {setTraceSink, trace} from '../logging/trace';
import {TELEMETRY_ENABLED, TELEMETRY_ENDPOINT, TELEMETRY_TOKEN} from './config';
import {getTelemetrySession, makeEvent, TelemetryEvent} from './envelope';
import {readManualGate, setManualGate} from './manualGate';
import {TelemetryTransport} from './transport';
import {
  readCrashReportsEnabled,
  sendCrashReport,
  storeCrashReportsEnabled,
} from './crashReports';
import {installJsErrorCapture} from './jsErrors';
import {
  backgroundStats,
  readMonthlyInstallId,
  startStats,
  stopStats,
} from './playbackStats';
import {
  acknowledgeCrashTail,
  markActive,
  markCleanExit,
  persistCrashTail,
  prepareCrashTail,
  startCrashTailPersistence,
  stopCrashTailPersistence,
} from './crashTail';

export {getTelemetrySession, setTelemetrySession, scrubUrl} from './envelope';
let transport: TelemetryTransport | undefined;
let bootstrap: Promise<void> | undefined;
let reason = 'not-initialized';
let generation = 0;
// Public crash reports: the tail is kept, and sent after an unclean exit, but
// nothing streams. Never on together with operator telemetry.
let crashReports = false;
export const isTelemetryArmed = () => transport !== undefined;
const capturing = () => crashReports || transport !== undefined;
/** The player's heartbeat runs for crash context even when nothing streams. */
export const isPlaybackSampling = capturing;
// Every trace rewrites the stored tail (crashTail coalesces the writes), so a
// native crash right after a seek still has the seek in it. The 30 s timer
// alone would lose the last actions, which are the ones that matter.
const persistNow = (): Promise<void> | undefined =>
  capturing() ? persistCrashTail(getTelemetrySession()) : undefined;
export const telemetryStatus = () => ({
  armed: isTelemetryArmed(),
  reason,
  counters: transport?.counters,
  gate: 'manual',
  interfaceDetail: [] as Array<{status: number}>,
});
const immediate = new Set([
  'playback.error',
  'shaka.load.error',
  'session.failed',
  'playback.stall',
  'report.error',
  'js.fatal',
]);
export const emit = (
  ev: string,
  detail?: Record<string, unknown>,
  urgent = false,
): void => {
  if (!transport) {
    return;
  }
  try {
    transport.enqueue(makeEvent(ev, detail), urgent);
  } catch {
    /* isolated */
  }
};
export const emitError = (
  ev: string,
  detail: Record<string, unknown> = {},
): void => {
  if (!transport) {
    return;
  }
  try {
    emit(ev, {...detail, logs: getCapturedLogs().slice(-30)}, true);
  } catch {
    /* isolated */
  }
};
export const flushTelemetry = (): Promise<void> =>
  transport?.flush() ?? Promise.resolve();

const startCrashReports = async (mine: number): Promise<void> => {
  if (!(await readCrashReportsEnabled()) || mine !== generation) {
    return;
  }
  const prior = await prepareCrashTail();
  if (mine !== generation) {
    return;
  }
  crashReports = true;
  setTraceSink(() => void persistNow());
  startCrashTailPersistence(() => ({sid: getTelemetrySession()}));
  void startStats({cleanExit: prior ? prior.cleanExit : null});
  if (!prior) {
    return;
  }
  // A clean exit is an ordinary close; only an unclean one is a crash.
  const delivered = prior.cleanExit
    ? Promise.resolve(true)
    : readMonthlyInstallId().then(
        (inst) => sendCrashReport(prior, inst),
        () => sendCrashReport(prior),
      );
  void delivered.then((ok) => {
    if (ok) {
      void acknowledgeCrashTail(prior.savedAtMs);
    }
  });
};

export const bootstrapTelemetry = (): Promise<void> => {
  if (bootstrap) {
    return bootstrap;
  }
  installJsErrorCapture(persistNow);
  const mine = generation;
  bootstrap = (async () => {
    if (!TELEMETRY_ENABLED) {
      reason = 'disabled';
      return;
    }
    const operator =
      Boolean(TELEMETRY_ENDPOINT && TELEMETRY_TOKEN) &&
      (await readManualGate());
    if (!operator) {
      reason =
        TELEMETRY_ENDPOINT && TELEMETRY_TOKEN ? 'manual-off' : 'not-configured';
      await startCrashReports(mine);
      return;
    }
    await initializeDeviceIdentity();
    if (mine !== generation) {
      return;
    }
    const prior = await prepareCrashTail();
    if (mine !== generation) {
      return;
    }
    transport = new TelemetryTransport({
      onDelivered: (events: readonly TelemetryEvent[]) => {
        for (const event of events) {
          if (
            event.ev === 'app.crashtail' &&
            typeof event.d?.savedAtMs === 'number'
          ) {
            void acknowledgeCrashTail(event.d.savedAtMs);
          }
        }
      },
    });
    reason = 'manual-gate';
    setTraceSink((entry) => {
      emit(entry.label, {detail: entry.detail}, immediate.has(entry.label));
      void persistNow();
    });
    emit(
      'app.start',
      {
        cleanExit: prior?.cleanExit ?? null,
        gateReason: reason,
        storageBackend: 'kepler-legacy',
      },
      true,
    );
    if (prior) {
      emit('app.crashtail', {...prior}, true);
    }
    startCrashTailPersistence(() => ({sid: getTelemetrySession()}));
  })().catch(() => {
    reason = 'initialization-failed';
  });
  return bootstrap;
};

export const stopTelemetry = (): void => {
  generation += 1;
  crashReports = false;
  stopStats();
  setTraceSink(null);
  stopCrashTailPersistence();
  transport?.stop();
  transport = undefined;
  bootstrap = undefined;
  reason = 'manual-off';
};
// Enable on this installation only. Re-evaluating the gate is explicit, not
// something performed on the playback hot path. Disable takes effect immediately.
export const configureManualTelemetry = async (
  phrase: string,
): Promise<boolean> => {
  stopTelemetry();
  const enabled = await setManualGate(phrase);
  if (enabled) {
    await bootstrapTelemetry();
  }
  return enabled && isTelemetryArmed();
};
/** The Settings switch. Takes effect at once, either way. */
export const configureCrashReports = async (
  enabled: boolean,
): Promise<void> => {
  await storeCrashReportsEnabled(enabled);
  if (transport) {
    return;
  }
  stopTelemetry();
  if (enabled) {
    await bootstrapTelemetry();
  }
};
export {readCrashReportsEnabled} from './crashReports';

export const telemetryAppState = (active: boolean): void => {
  trace('app.state', active ? 'foreground' : 'background');
  if (crashReports) {
    if (active) {
      void markActive();
      startCrashTailPersistence(() => ({sid: getTelemetrySession()}));
    } else {
      stopCrashTailPersistence();
      void persistCrashTail(getTelemetrySession());
      void markCleanExit();
      backgroundStats();
    }
    return;
  }
  if (!transport) {
    return;
  }
  if (active) {
    void markActive();
    startCrashTailPersistence(() => ({sid: getTelemetrySession()}));
    emit('app.foreground');
  } else {
    stopCrashTailPersistence();
    emit('app.background', undefined, true);
    void persistCrashTail(getTelemetrySession());
    void markCleanExit();
    void flushTelemetry();
  }
};
