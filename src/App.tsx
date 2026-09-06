import React, {useEffect} from 'react';
import {AppState} from 'react-native';
import {
  bootstrapTelemetry,
  emit,
  telemetryAppState,
} from './services/telemetry';
import {getContainerSupport} from './services/mediaCapabilities';
import {getNativeParsingSupport} from './services/mediaCapabilities/nativeParsing';
import {RootNavigator} from './navigation';

// ==== SPIKE (2026-07-27) — DELETE THIS BLOCK AND src/spike WHEN FINISHED ====
// Set to false to get the normal app back without deleting the spike files.
// Uses require() so the gitignored spike directory is only resolved when the
// flag is on — with it off, the app builds fine on a clone that lacks it.
const RUN_AUDIO_SPIKE = false;
// ===========================================================================

export const App = () => {
  useEffect(() => {
    void bootstrapTelemetry()
      .then(async () => {
        // Observational only -- nothing branches on this. It answers whether
        // Vega's MSE takes MPEG-TS natively or whether Shaka is transmuxing
        // every segment in JS on the path HEVC currently takes. Emitted after
        // bootstrap so the gate has been decided; a probe failure is reported
        // in the event rather than thrown, so this cannot affect startup.
        const support = await getContainerSupport();
        emit('media.containers', {
          ...support.results,
          probeSucceeded: support.probeSucceeded,
          controlsFailed: support.controlsFailed,
          alwaysTrue: support.alwaysTrue,
        });
        const nativeParsing = await getNativeParsingSupport();
        emit('media.nativeParsing', {...nativeParsing});
      })
      .catch(() => {
        // Diagnostics must never reject into application startup.
      });
    const subscription = AppState.addEventListener('change', (state) =>
      telemetryAppState(state === 'active'),
    );
    return () => subscription.remove();
  }, []);
  if (RUN_AUDIO_SPIKE) {
    const {AudioSpike} = require('./spike/AudioSpike');
    return <AudioSpike />;
  }

  return <RootNavigator />;
};
