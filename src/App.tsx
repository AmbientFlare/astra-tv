import React, {useEffect} from 'react';
import {AppState} from 'react-native';
import {bootstrapTelemetry, telemetryAppState} from './services/telemetry';
import {RootNavigator} from './navigation';

// ==== SPIKE (2026-07-27) — DELETE THIS BLOCK AND src/spike WHEN FINISHED ====
// Set to false to get the normal app back without deleting the spike files.
// Uses require() so the gitignored spike directory is only resolved when the
// flag is on — with it off, the app builds fine on a clone that lacks it.
const RUN_AUDIO_SPIKE = false;
// ===========================================================================

export const App = () => {
  useEffect(() => {
    void bootstrapTelemetry();
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
