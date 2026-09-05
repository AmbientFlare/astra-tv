import {initializeDeviceIdentity} from '../deviceIdentity';
import {getCapturedLogs} from '../logging';
import {setTraceSink} from '../logging/trace';
import {TELEMETRY_ENABLED, TELEMETRY_ENDPOINT, TELEMETRY_TOKEN} from './config';
import {getTelemetrySession, makeEvent, TelemetryEvent} from './envelope';
import {readManualGate, setManualGate} from './manualGate';
import {TelemetryTransport} from './transport';
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
export const isTelemetryArmed = () => transport !== undefined;
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

export const bootstrapTelemetry = (): Promise<void> => {
  if (bootstrap) {
    return bootstrap;
  }
  const mine = generation;
  bootstrap = (async () => {
    if (!TELEMETRY_ENABLED) {
      reason = 'disabled';
      return;
    }
    if (!TELEMETRY_ENDPOINT || !TELEMETRY_TOKEN) {
      reason = 'not-configured';
      return;
    }
    if (!(await readManualGate())) {
      reason = 'manual-off';
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
    setTraceSink((entry) =>
      emit(entry.label, {detail: entry.detail}, immediate.has(entry.label)),
    );
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
export const telemetryAppState = (active: boolean): void => {
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
