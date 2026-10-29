import React, {useState} from 'react';
import {Text, TextInput} from 'react-native';
import {
  configureManualTelemetry,
  telemetryStatus,
} from '../../services/telemetry';
import {MenuRow, Page} from './widgets';

/**
 * Operator-only. Telemetry is off for everyone until the operator phrase is
 * entered on a test device, and it stays off on a build made without the
 * operator configuration.
 */
export const TelemetryPage = ({onBack}: {onBack: () => void}) => {
  const [telemetryPhrase, setTelemetryPhrase] = useState('');
  const [telemetryMessage, setTelemetryMessage] = useState('');

  return (
    <Page title="Developer telemetry" onBack={onBack}>
      <Text style={{color: 'white', fontSize: 22}}>
        Off by default. Enabling sends viewing diagnostics to the configured
        operator collector. Enter the operator phrase only on your own test
        device. Logs contain private viewing information.
      </Text>
      <TextInput
        testID="telemetry-phrase"
        value={telemetryPhrase}
        onChangeText={setTelemetryPhrase}
        placeholder="Operator phrase"
        placeholderTextColor="#aaaaaa"
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          color: 'white',
          borderColor: '#aaaaaa',
          borderWidth: 1,
          padding: 16,
          fontSize: 24,
        }}
      />
      <MenuRow
        icon="↗"
        title="Enable on this device"
        onPress={() => {
          void configureManualTelemetry(telemetryPhrase).then((enabled) => {
            setTelemetryPhrase('');
            setTelemetryMessage(
              enabled
                ? 'Enabled on this device.'
                : 'Not enabled: check phrase and build configuration.',
            );
          });
        }}
      />
      <MenuRow
        icon="×"
        title="Disable telemetry"
        onPress={() => {
          void configureManualTelemetry('').then(() =>
            setTelemetryMessage('Telemetry stopped.'),
          );
        }}
      />
      <Text style={{color: 'white', fontSize: 22}}>
        {telemetryMessage || telemetryStatus().reason}
      </Text>
    </Page>
  );
};
