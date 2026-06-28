import React, {useEffect, useState} from 'react';
import {StyleSheet, Text, TextInput, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {
  authenticate,
  connect,
  DiscoveredServer,
  discoverServers,
} from '../../services/jellyfin';
import {
  ServerProfile,
  ServerType,
  upsertServerProfile,
} from '../../services/storage';

const serverTypes: ServerType[] = ['jellyfin', 'kodi', 'emby'];

interface SetupScreenProps {
  onConnected?: (profile: ServerProfile) => void;
}

export const SetupScreen = ({onConnected}: SetupScreenProps) => {
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [serverType, setServerType] = useState<ServerType>('jellyfin');
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const [discoveredServers, setDiscoveredServers] = useState<
    DiscoveredServer[]
  >([]);
  const [isScanning, setScanning] = useState(false);
  const [isConnecting, setConnecting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const scanForServers = async () => {
    setScanning(true);
    setErrorText(null);

    try {
      const servers = await discoverServers({
        subnetPrefixes: ['192.168.1'],
        timeoutMs: 180,
      });
      setDiscoveredServers(servers);
    } catch (error) {
      setErrorText(
        error instanceof Error ? error.message : 'Server discovery failed.',
      );
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    let mounted = true;

    const scan = async () => {
      const servers = await discoverServers({
        subnetPrefixes: ['192.168.1'],
        timeoutMs: 180,
      });

      if (mounted) {
        setDiscoveredServers(servers);
      }
    };

    const timeout = setTimeout(() => {
      scan().catch(() => undefined);
    }, 1500);

    return () => {
      mounted = false;
      clearTimeout(timeout);
    };
  }, []);

  const inputStyle = (id: string) => [
    styles.input,
    focusedInput === id && styles.inputFocused,
  ];

  const handleInputFocus = (id: string) => {
    console.info(`[Astra] Setup focus: ${id}`);
    setFocusedInput(id);
  };

  const handleConnect = async () => {
    if (serverType !== 'jellyfin') {
      setErrorText('Only Jellyfin connections are available right now.');
      return;
    }

    setConnecting(true);
    setErrorText(null);

    try {
      const serverInfo = await connect(serverUrl);
      const authResult = await authenticate(serverUrl, username, password);
      const profile: ServerProfile = {
        id: serverInfo.id || serverUrl,
        name: serverInfo.name,
        serverUrl: serverUrl.trim().replace(/\/+$/, ''),
        serverType,
        userId: authResult.userId,
        accessToken: authResult.accessToken,
        lastUsed: Date.now(),
      };

      await upsertServerProfile(profile);
      onConnected?.(profile);
    } catch (error) {
      setErrorText(
        error instanceof Error
          ? error.message
          : 'Unable to connect to the server.',
      );
    } finally {
      setConnecting(false);
    }
  };

  return (
    <View style={styles.screen} testID="setup-screen">
      <View style={styles.header}>
        <Text style={styles.logo}>Astra</Text>
        <Text style={styles.subtitle}>Connect your media server</Text>
      </View>

      <TVFocusGuideView style={styles.form}>
        <View style={styles.discoveryArea}>
          <Text style={styles.discoveryTitle}>
            {isScanning ? 'Scanning for servers...' : 'Found servers'}
          </Text>
          {!isScanning && discoveredServers.length === 0 ? (
            <Text style={styles.helperText}>No local servers found.</Text>
          ) : null}
          {discoveredServers.map((server) => (
            <FocusableItem
              accessibilityLabel={server.name}
              focusedStyle={styles.discoveredFocused}
              key={server.address}
              onPress={() => setServerUrl(server.address)}
              style={styles.discoveredServer}
              testID={`setup-discovered-server-${server.id}`}>
              <Text style={styles.discoveredName}>{server.name}</Text>
              <Text style={styles.discoveredAddress}>{server.address}</Text>
            </FocusableItem>
          ))}
          <FocusableItem
            focusedStyle={styles.discoveredFocused}
            onPress={scanForServers}
            style={styles.scanButton}
            testID="setup-scan-button">
            <Text style={styles.scanText}>
              {isScanning ? 'Scanning' : 'Scan again'}
            </Text>
          </FocusableItem>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Server URL</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            hasTVPreferredFocus={true}
            onBlur={() => setFocusedInput(null)}
            onChangeText={setServerUrl}
            onFocus={() => handleInputFocus('serverUrl')}
            placeholder="https://jellyfin.example.com"
            placeholderTextColor="#7D8A92"
            style={inputStyle('serverUrl')}
            testID="setup-server-url-input"
            value={serverUrl}
          />
          <Text style={styles.helperText}>
            Enter IP, domain, or Tailscale address.
          </Text>
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Username</Text>
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onBlur={() => setFocusedInput(null)}
            onChangeText={setUsername}
            onFocus={() => handleInputFocus('username')}
            placeholder="Media server username"
            placeholderTextColor="#7D8A92"
            style={inputStyle('username')}
            testID="setup-username-input"
            value={username}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <TextInput
            onBlur={() => setFocusedInput(null)}
            onChangeText={setPassword}
            onFocus={() => handleInputFocus('password')}
            placeholder="Password"
            placeholderTextColor="#7D8A92"
            secureTextEntry={true}
            style={inputStyle('password')}
            testID="setup-password-input"
            value={password}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>Server Type</Text>
          <View style={styles.segmentedControl}>
            {serverTypes.map((type) => (
              <FocusableItem
                accessibilityLabel={type}
                focusedStyle={styles.segmentFocused}
                key={type}
                onPress={() => setServerType(type)}
                style={[
                  styles.segment,
                  serverType === type && styles.segmentSelected,
                ]}
                testID={`setup-server-type-${type}`}>
                <Text style={styles.segmentText}>{type}</Text>
              </FocusableItem>
            ))}
          </View>
        </View>

        <FocusableItem
          accessibilityLabel="Connect"
          focusedStyle={styles.connectFocused}
          onPress={handleConnect}
          style={styles.connectButton}
          testID="setup-connect-button">
          <Text style={styles.connectText}>
            {isConnecting ? 'Connecting' : 'Connect'}
          </Text>
        </FocusableItem>
        {errorText ? <Text style={styles.errorText}>{errorText}</Text> : null}
      </TVFocusGuideView>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0C1116',
    paddingHorizontal: 144,
    paddingVertical: 76,
  },
  header: {
    marginBottom: 36,
  },
  logo: {
    color: '#FFFFFF',
    fontSize: 82,
    fontWeight: '800',
    letterSpacing: 0,
  },
  subtitle: {
    color: '#AAB7C0',
    fontSize: 30,
    marginTop: 8,
  },
  form: {
    width: 840,
  },
  discoveryArea: {
    marginBottom: 22,
  },
  discoveryTitle: {
    color: '#E6EDF2',
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 10,
  },
  discoveredServer: {
    width: 840,
    minHeight: 72,
    borderRadius: 8,
    backgroundColor: '#14202A',
    justifyContent: 'center',
    marginBottom: 10,
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  discoveredFocused: {
    backgroundColor: '#244654',
  },
  scanButton: {
    width: 180,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#24313A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  discoveredName: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '700',
  },
  discoveredAddress: {
    color: '#AAB7C0',
    fontSize: 22,
    marginTop: 4,
  },
  field: {
    marginBottom: 22,
  },
  label: {
    color: '#E6EDF2',
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 8,
  },
  input: {
    width: 840,
    height: 68,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: '#2F3D46',
    backgroundColor: '#162027',
    color: '#FFFFFF',
    fontSize: 28,
    paddingHorizontal: 24,
  },
  inputFocused: {
    borderColor: '#4CC9F0',
    backgroundColor: '#1D303A',
  },
  helperText: {
    color: '#91A2AD',
    fontSize: 22,
    marginTop: 8,
  },
  segmentedControl: {
    flexDirection: 'row',
    gap: 16,
  },
  segment: {
    width: 180,
    height: 62,
    borderRadius: 8,
    backgroundColor: '#172129',
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentSelected: {
    backgroundColor: '#1F6F5A',
  },
  segmentFocused: {
    backgroundColor: '#285168',
  },
  segmentText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  connectButton: {
    width: 280,
    height: 68,
    borderRadius: 8,
    backgroundColor: '#2F9C7C',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  connectFocused: {
    backgroundColor: '#36B28E',
  },
  connectText: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
  },
  errorText: {
    color: '#FFB4A8',
    fontSize: 24,
    marginTop: 18,
  },
});
