import React, {useCallback, useEffect, useState} from 'react';
import {AppState} from 'react-native';
import {
  bootstrapTelemetry,
  emit,
  telemetryAppState,
} from './services/telemetry';
import {getContainerSupport} from './services/mediaCapabilities';
import {getNativeParsingSupport} from './services/mediaCapabilities/nativeParsing';
import {
  flattenHdrSupport,
  getHdrSupport,
} from './services/mediaCapabilities/hdr';
import {
  flattenDeliveryRouteSupport,
  getDeliveryRouteSupport,
} from './services/mediaCapabilities/deliveryRoute';
import {RootNavigator} from './navigation';
import {LanguageContext, Locale, setActiveLocale, storeLocale} from './i18n';

export const App = () => {
  // The navigator is keyed on this, so a language change remounts every
  // screen and they re-read their text. This returns the user to Home.
  const [generation, setGeneration] = useState(0);
  const changeLanguage = useCallback((next: Locale) => {
    setActiveLocale(next);
    storeLocale(next)
      .catch(() => undefined)
      .then(() => setGeneration((value) => value + 1));
  }, []);

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
        // Asks whether the platform accepts an HDR10 decode configuration at
        // all. Astra tone-maps every HDR source to SDR on the server on the
        // strength of a sink rejection observed on the direct-play path,
        // which is disabled; this asks about the MSE path actually in use.
        // Read `hdrFieldsIgnored` before anything else -- if the platform
        // ignores transferFunction, the HDR results carry no information.
        emit('media.hdr', flattenHdrSupport(await getHdrSupport()));
        // Crosses container x resolution x level, because a 4K HEVC stream
        // over MPEG-TS differs from a working 1080p one in all three at once
        // and each implies a different fix. Read `controlsFailed`,
        // `levelFieldIgnored` and `mp2tUnanswerable` before any cell: a
        // platform that will not describe mp2t is not the same as one that
        // rejects it.
        emit(
          'media.deliveryRoute',
          flattenDeliveryRouteSupport(await getDeliveryRouteSupport()),
        );
      })
      .catch(() => {
        // Diagnostics must never reject into application startup.
      });
    const subscription = AppState.addEventListener('change', (state) =>
      telemetryAppState(state === 'active'),
    );
    return () => subscription.remove();
  }, []);
  return (
    <LanguageContext.Provider value={changeLanguage}>
      <RootNavigator key={generation} />
    </LanguageContext.Provider>
  );
};
