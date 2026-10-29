import React, {useState} from 'react';
import {Text} from 'react-native';
import {measureServerBandwidth} from '../../services/jellyfin';
import type {PlaybackPreferences, ServerProfile} from '../../services/storage';
import {t} from '../../i18n';
import {bitrateOptions} from './options';
import {styles} from './styles';
import {MenuRow, Page} from './widgets';

export const ConnectionTestPage = ({
  currentMaxBitrateBps,
  onApplyBitrate,
  onBack,
  serverProfile,
}: {
  currentMaxBitrateBps: number;
  onApplyBitrate: (bitrateBps: PlaybackPreferences['maxBitrateBps']) => void;
  onBack: () => void;
  serverProfile: ServerProfile;
}) => {
  const [phase, setPhase] = useState<'idle' | 'testing' | 'done' | 'error'>(
    'idle',
  );
  const [measuredBps, setMeasuredBps] = useState<number | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const runTest = async () => {
    setPhase('testing');
    setErrorText(null);

    try {
      const bps = await measureServerBandwidth(
        serverProfile.serverUrl,
        serverProfile.accessToken,
      );
      setMeasuredBps(bps);
      setPhase('done');
    } catch (error) {
      setErrorText(
        error instanceof Error
          ? error.message
          : t('settings.connectionTestFailed'),
      );
      setPhase('error');
    }
  };

  // Leave 20% headroom over sustained playback so bursts and container
  // overhead don't cause buffering right at the limit.
  const usableBps = measuredBps === null ? null : measuredBps * 0.8;
  const suggestion =
    usableBps === null
      ? null
      : [...bitrateOptions()]
          .sort((a, b) => b.value - a.value)
          .find((option) => option.value <= usableBps) ?? bitrateOptions()[0];
  const belowLowestOption =
    usableBps !== null && suggestion !== null
      ? usableBps < suggestion.value
      : false;

  return (
    <Page title={t('settings.testConnection')} onBack={onBack}>
      <Text style={styles.description}>
        {t('settings.connectionTestBody', {
          name: serverProfile.name || t('setup.yourServer'),
        })}
      </Text>
      <MenuRow
        icon="⇄"
        preferred={true}
        title={
          phase === 'testing' ? t('settings.testing') : t('settings.runTest')
        }
        subtitle={phase === 'testing' ? t('settings.testingHint') : undefined}
        onPress={phase === 'testing' ? undefined : runTest}
      />
      {phase === 'done' && measuredBps !== null && suggestion ? (
        <>
          <Text style={styles.infoText}>
            {t('settings.measuredSpeed', {
              mbps: (measuredBps / 1000000).toFixed(0),
            })}
          </Text>
          {belowLowestOption ? (
            <Text style={styles.infoText}>
              {t('settings.slowerThanLowest')}
            </Text>
          ) : null}
          <MenuRow
            icon="↯"
            title={t('settings.setMaxBitrate', {value: suggestion.label})}
            subtitle={
              suggestion.value === currentMaxBitrateBps
                ? t('settings.alreadyCurrent')
                : t('settings.currently', {
                    value:
                      bitrateOptions().find(
                        (o) => o.value === currentMaxBitrateBps,
                      )?.label ?? t('settings.unknown'),
                  })
            }
            onPress={() => {
              onApplyBitrate(suggestion.value);
              onBack();
            }}
          />
          <Text style={styles.infoText}>{t('settings.bitrateAdvice')}</Text>
        </>
      ) : null}
      {phase === 'error' && errorText ? (
        <Text style={styles.infoText}>{errorText}</Text>
      ) : null}
    </Page>
  );
};
