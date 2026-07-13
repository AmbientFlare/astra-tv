import React, {useCallback, useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {TVTextInput} from '../../components/TVTextInput';
import {
  DEV_PASSWORD,
  DEV_SERVER_URL,
  DEV_USERNAME,
} from '../../config/devCredentials';
import {
  authenticate,
  authenticateWithQuickConnect,
  connect,
  DiscoveredServer,
  discoverServers,
  initiateQuickConnect,
  isQuickConnectEnabled,
  JellyfinAuthResult,
  JellyfinServerInfo,
  pollQuickConnect,
} from '../../services/jellyfin';
import {getLocalSubnetPrefixes} from '../../services/network';
import {
  ServerProfile,
  ServerType,
  upsertServerProfile,
} from '../../services/storage';
import {debugInfo} from '../../utils/logger';

// One lightweight screen per step keeps memory/render cost low on the device.
type WizardStep = 'serverType' | 'server' | 'authMethod' | 'code' | 'password';

const QUICK_CONNECT_POLL_MS = 5000;

interface SetupScreenProps {
  onConnected?: (profile: ServerProfile) => void;
}

export const SetupScreen = ({onConnected}: SetupScreenProps) => {
  const [step, setStep] = useState<WizardStep>('serverType');
  const [serverType, setServerType] = useState<ServerType>('jellyfin');
  const [serverUrl, setServerUrl] = useState(DEV_SERVER_URL);
  const [username, setUsername] = useState(DEV_USERNAME);
  const [password, setPassword] = useState(DEV_PASSWORD);
  const [focusedInput, setFocusedInput] = useState<string | null>(null);
  const [discoveredServers, setDiscoveredServers] = useState<
    DiscoveredServer[]
  >([]);
  const [isScanning, setScanning] = useState(false);
  const [isBusy, setBusy] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [serverInfo, setServerInfo] = useState<JellyfinServerInfo | null>(null);
  const [quickConnectEnabled, setQuickConnectEnabled] = useState(false);
  const [quickConnectCode, setQuickConnectCode] = useState<string | null>(null);
  const quickConnectSecret = useRef<string | null>(null);

  const scanForServers = useCallback(async () => {
    setScanning(true);
    setErrorText(null);
    try {
      const servers = await discoverServers({
        subnetPrefixes: await getLocalSubnetPrefixes(),
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
  }, []);

  useEffect(() => {
    let mounted = true;
    const timeout = setTimeout(() => {
      (async () => {
        try {
          const servers = await discoverServers({
            subnetPrefixes: await getLocalSubnetPrefixes(),
            timeoutMs: 180,
          });
          if (mounted) {
            setDiscoveredServers(servers);
          }
        } catch {
          // Discovery is best-effort; the user can still type a URL.
        }
      })();
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
    debugInfo(`[Astra] Setup focus: ${id}`);
    setFocusedInput(id);
  };

  // Shared by both sign-in paths: build + persist the profile, then hand off.
  const saveProfile = useCallback(
    async (authResult: JellyfinAuthResult, info: JellyfinServerInfo) => {
      const normalizedServerUrl = serverUrl.trim().replace(/\/+$/, '');
      const serverId = info.id || normalizedServerUrl;
      const profile: ServerProfile = {
        id: `${serverId}:${authResult.userId}`,
        name: info.name,
        serverId,
        serverUrl: normalizedServerUrl,
        serverType,
        username: authResult.username ?? username.trim(),
        userId: authResult.userId,
        accessToken: authResult.accessToken,
        lastUsed: Date.now(),
      };
      await upsertServerProfile(profile);
      onConnected?.(profile);
    },
    [onConnected, serverType, serverUrl, username],
  );

  // Reach the server (public info only, no account creds), decide whether the
  // code path is offered, then advance.
  const handleServerConnect = async () => {
    setBusy(true);
    setErrorText(null);
    try {
      const info = await connect(serverUrl);
      setServerInfo(info);
      const enabled = await isQuickConnectEnabled(serverUrl);
      setQuickConnectEnabled(enabled);
      setStep(enabled ? 'authMethod' : 'password');
    } catch (error) {
      setErrorText(
        error instanceof Error ? error.message : 'Unable to reach the server.',
      );
    } finally {
      setBusy(false);
    }
  };

  const startQuickConnect = async () => {
    setBusy(true);
    setErrorText(null);
    try {
      const {code, secret} = await initiateQuickConnect(serverUrl);
      quickConnectSecret.current = secret;
      setQuickConnectCode(code);
      setStep('code');
    } catch (error) {
      setErrorText(
        error instanceof Error
          ? error.message
          : 'Could not start Quick Connect.',
      );
    } finally {
      setBusy(false);
    }
  };

  const cancelQuickConnect = () => {
    quickConnectSecret.current = null;
    setQuickConnectCode(null);
    setErrorText(null);
    setStep('authMethod');
  };

  const handlePasswordSignIn = async () => {
    setBusy(true);
    setErrorText(null);
    try {
      const info = serverInfo ?? (await connect(serverUrl));
      const authResult = await authenticate(serverUrl, username, password);
      await saveProfile(authResult, info);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  // Poll for Quick Connect approval while the code screen is showing.
  useEffect(() => {
    if (step !== 'code' || !quickConnectSecret.current) {
      return;
    }
    let active = true;
    const interval = setInterval(async () => {
      const secret = quickConnectSecret.current;
      if (!secret) {
        return;
      }
      try {
        const approved = await pollQuickConnect(serverUrl, secret);
        if (!approved || !active) {
          return;
        }
        clearInterval(interval);
        const authResult = await authenticateWithQuickConnect(
          serverUrl,
          secret,
        );
        const info = serverInfo ?? (await connect(serverUrl));
        if (active) {
          await saveProfile(authResult, info);
        }
      } catch {
        // Transient poll errors are expected until approval; keep waiting.
      }
    }, QUICK_CONNECT_POLL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [step, serverUrl, serverInfo, saveProfile]);

  const backButton = (label: string, onPress: () => void) => (
    <FocusableItem
      accessibilityLabel={label}
      focusedStyle={styles.backFocused}
      onPress={onPress}
      style={styles.backButton}
      testID="setup-back-button">
      <Text style={styles.backText}>{label}</Text>
    </FocusableItem>
  );

  const renderStep = () => {
    if (step === 'serverType') {
      return (
        <>
          <Text style={styles.stepTitle}>What are you connecting to?</Text>
          <Text style={styles.stepSubtitle}>
            Astra plays movies and shows from your own media server. Pick the
            kind of server you have.
          </Text>
          <View style={styles.segmentedControl}>
            <FocusableItem
              accessibilityLabel="Jellyfin"
              focusedStyle={styles.segmentFocused}
              hasTVPreferredFocus={true}
              onPress={() => {
                setServerType('jellyfin');
                setErrorText(null);
                setStep('server');
              }}
              style={[
                styles.segment,
                styles.segmentBorder,
                styles.segmentSelected,
              ]}
              testID="setup-server-type-jellyfin">
              <Text style={styles.segmentText}>Jellyfin</Text>
              <Text style={styles.segmentHint}>Press Select to continue</Text>
            </FocusableItem>
            <View
              accessibilityLabel="Emby, coming soon"
              style={[
                styles.segment,
                styles.segmentBorder,
                styles.segmentDisabled,
              ]}
              testID="setup-server-type-emby">
              <Text style={styles.segmentTextDisabled}>Emby</Text>
              <Text style={styles.segmentDisabledHint}>Coming soon</Text>
            </View>
          </View>
          <Text style={styles.helperText}>
            Have a Jellyfin server? It's highlighted and ready — just press the
            Select button on your remote.
          </Text>
        </>
      );
    }

    if (step === 'server') {
      return (
        <>
          <Text style={styles.stepTitle}>Find your server</Text>
          <View style={styles.discoveryArea}>
            <Text style={styles.discoveryTitle}>
              {isScanning ? 'Scanning for servers...' : 'Found on your network'}
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
            <Text style={styles.label}>…or enter address</Text>
            <TVTextInput
              autoCapitalize="none"
              autoComplete="url"
              autoCorrect={false}
              auxOptions="title:Server URL"
              focusStrategy="press"
              inputStyle={styles.inputText}
              inputMode="url"
              keyboardType="url"
              onBlur={() => setFocusedInput(null)}
              onChangeText={setServerUrl}
              onFocus={() => handleInputFocus('serverUrl')}
              placeholder="https://jellyfin.example.com"
              placeholderTextColor="#7D8A92"
              textContentType="URL"
              style={inputStyle('serverUrl')}
              testID="setup-server-url-input"
              value={serverUrl}
            />
            <Text style={styles.helperText}>
              Enter IP, domain, or Tailscale address.
            </Text>
          </View>

          <View style={styles.buttonRow}>
            {backButton('Back', () => {
              setErrorText(null);
              setStep('serverType');
            })}
            <FocusableItem
              accessibilityLabel="Connect"
              focusedStyle={styles.connectFocused}
              onPress={handleServerConnect}
              style={styles.connectButton}
              testID="setup-connect-button">
              <Text style={styles.connectText}>
                {isBusy ? 'Connecting' : 'Connect'}
              </Text>
            </FocusableItem>
          </View>
        </>
      );
    }

    if (step === 'authMethod') {
      return (
        <>
          <Text style={styles.stepTitle}>
            Connected to {serverInfo?.name ?? 'your server'}
          </Text>
          <Text style={styles.stepSubtitle}>
            How would you like to sign in? Using a code means you don't have to
            type your password with the remote — you approve it from your phone
            instead. Pick whichever is easier for you.
          </Text>
          <View style={styles.methodRow}>
            <FocusableItem
              accessibilityLabel="Sign in with a code, recommended"
              focusedStyle={styles.methodFocused}
              hasTVPreferredFocus={true}
              onPress={startQuickConnect}
              style={[styles.methodButton, styles.methodRecommended]}
              testID="setup-method-code">
              <Text style={styles.methodBadge}>RECOMMENDED</Text>
              <Text style={styles.methodTitle}>Use a code</Text>
              <Text style={styles.methodHint}>
                No typing. Approve on your phone or computer.
              </Text>
            </FocusableItem>
            <FocusableItem
              accessibilityLabel="Sign in with username and password"
              focusedStyle={styles.methodFocused}
              onPress={() => {
                setErrorText(null);
                setStep('password');
              }}
              style={styles.methodButton}
              testID="setup-method-password">
              <Text style={styles.methodTitle}>Use a password</Text>
              <Text style={styles.methodHint}>
                Type your username and password here.
              </Text>
            </FocusableItem>
          </View>
          {backButton('Back', () => {
            setErrorText(null);
            setStep('server');
          })}
        </>
      );
    }

    if (step === 'code') {
      return (
        <>
          <Text style={styles.stepTitle}>Enter this code to sign in</Text>

          <View style={styles.codeRow}>
            <View style={styles.codeInstructionsCol}>
              <Text style={styles.codeStep}>
                <Text style={styles.codeStepNum}>1. </Text>
                On your phone, tablet, or computer, open Jellyfin and sign in
                (the website or the Jellyfin app).
              </Text>
              <Text style={styles.codeStep}>
                <Text style={styles.codeStepNum}>2. </Text>
                Tap your account icon in the top-right corner, then choose{' '}
                <Text style={styles.codeEmphasis}>Quick Connect</Text>.
              </Text>
              <Text style={styles.codeStep}>
                <Text style={styles.codeStepNum}>3. </Text>
                Type in the code shown here and confirm. You'll be signed in
                automatically.
              </Text>
            </View>

            <View style={styles.codeBox}>
              <Text style={styles.codeBoxLabel}>Your code</Text>
              <Text style={styles.code} testID="setup-quickconnect-code">
                {quickConnectCode ?? '——————'}
              </Text>
              <Text style={styles.waitingText}>Waiting for approval…</Text>
            </View>
          </View>

          {backButton('Cancel', cancelQuickConnect)}
        </>
      );
    }

    // step === 'password'
    return (
      <>
        <Text style={styles.stepTitle}>Sign in</Text>
        <View style={styles.field}>
          <Text style={styles.label}>Username</Text>
          <TVTextInput
            autoCapitalize="none"
            autoComplete="username"
            autoCorrect={false}
            auxOptions="title:Username"
            focusStrategy="press"
            inputStyle={styles.inputText}
            inputMode="email"
            keyboardType="email-address"
            onBlur={() => setFocusedInput(null)}
            onChangeText={setUsername}
            onFocus={() => handleInputFocus('username')}
            placeholder="Media server username"
            placeholderTextColor="#7D8A92"
            textContentType="username"
            style={inputStyle('username')}
            testID="setup-username-input"
            value={username}
          />
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>Password</Text>
          <TVTextInput
            autoComplete="password"
            auxOptions="title:Password;password:true"
            focusStrategy="press"
            inputStyle={styles.inputText}
            inputMode="text"
            keyboardType="default"
            onBlur={() => setFocusedInput(null)}
            onChangeText={setPassword}
            onFocus={() => handleInputFocus('password')}
            placeholder="Password"
            placeholderTextColor="#7D8A92"
            secureTextEntry={true}
            textContentType="password"
            style={inputStyle('password')}
            testID="setup-password-input"
            value={password}
          />
        </View>
        <View style={styles.buttonRow}>
          {backButton('Back', () => {
            setErrorText(null);
            setStep(quickConnectEnabled ? 'authMethod' : 'server');
          })}
          <FocusableItem
            accessibilityLabel="Sign in"
            focusedStyle={styles.connectFocused}
            onPress={handlePasswordSignIn}
            style={styles.connectButton}
            testID="setup-signin-button">
            <Text style={styles.connectText}>
              {isBusy ? 'Signing in' : 'Sign in'}
            </Text>
          </FocusableItem>
        </View>
      </>
    );
  };

  return (
    <View style={styles.screen} testID="setup-screen">
      <View style={styles.header}>
        <Text style={styles.logo}>Astra</Text>
        <Text style={styles.subtitle}>Connect your media server</Text>
      </View>

      <TVFocusGuideView style={styles.form}>
        {renderStep()}
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
  stepTitle: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '700',
    marginBottom: 12,
  },
  stepSubtitle: {
    color: '#AAB7C0',
    fontSize: 26,
    lineHeight: 36,
    maxWidth: 820,
    marginBottom: 26,
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
    paddingHorizontal: 24,
  },
  inputText: {
    color: '#FFFFFF',
    fontSize: 28,
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
    width: 220,
    height: 96,
    borderRadius: 8,
    backgroundColor: '#172129',
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBorder: {
    borderColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
  },
  segmentSelected: {
    backgroundColor: '#1B2630',
    borderColor: '#7B5EA7',
    borderWidth: 2,
  },
  segmentDisabled: {
    backgroundColor: '#0F171C',
    borderColor: 'rgba(255,255,255,0.08)',
    opacity: 0.5,
  },
  segmentFocused: {
    backgroundColor: '#285168',
  },
  segmentText: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '700',
  },
  segmentTextDisabled: {
    color: '#AAB7C0',
    fontSize: 26,
    fontWeight: '700',
  },
  segmentHint: {
    color: '#8CA1AA',
    fontSize: 18,
    marginTop: 4,
  },
  segmentDisabledHint: {
    color: '#6B7A82',
    fontSize: 18,
    fontStyle: 'italic',
    marginTop: 4,
  },
  methodRow: {
    flexDirection: 'row',
    gap: 22,
    marginBottom: 26,
  },
  methodButton: {
    width: 360,
    minHeight: 190,
    borderRadius: 12,
    backgroundColor: '#172129',
    borderColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20,
  },
  methodRecommended: {
    borderColor: '#4CC9F0',
    borderWidth: 2,
  },
  methodFocused: {
    backgroundColor: '#285168',
  },
  methodBadge: {
    color: '#4CC9F0',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  methodTitle: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '800',
  },
  methodHint: {
    color: '#9FB0B8',
    fontSize: 22,
    lineHeight: 30,
    marginTop: 10,
    textAlign: 'center',
  },
  codeRow: {
    marginBottom: 8,
  },
  codeInstructionsCol: {
    maxWidth: 900,
    marginBottom: 28,
  },
  codeStep: {
    color: '#D3DDE3',
    fontSize: 26,
    lineHeight: 38,
    marginBottom: 14,
  },
  codeStepNum: {
    color: '#4CC9F0',
    fontWeight: '800',
  },
  codeEmphasis: {
    color: '#FFFFFF',
    fontWeight: '800',
  },
  codeBox: {
    alignSelf: 'flex-start',
    backgroundColor: '#111C23',
    borderColor: '#4CC9F0',
    borderWidth: 2,
    borderRadius: 14,
    paddingHorizontal: 44,
    paddingVertical: 24,
    alignItems: 'center',
  },
  codeBoxLabel: {
    color: '#8CA1AA',
    fontSize: 22,
    letterSpacing: 1,
    marginBottom: 6,
  },
  code: {
    color: '#FFFFFF',
    fontSize: 92,
    fontWeight: '800',
    letterSpacing: 16,
    marginBottom: 8,
  },
  waitingText: {
    color: '#4CC9F0',
    fontSize: 24,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    marginTop: 8,
  },
  connectButton: {
    width: 280,
    height: 68,
    borderRadius: 8,
    backgroundColor: '#2F9C7C',
    alignItems: 'center',
    justifyContent: 'center',
  },
  connectFocused: {
    backgroundColor: '#36B28E',
  },
  connectText: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
  },
  backButton: {
    minWidth: 140,
    height: 68,
    borderRadius: 8,
    backgroundColor: '#24313A',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    marginTop: 8,
  },
  backFocused: {
    backgroundColor: '#33454F',
  },
  backText: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '700',
  },
  errorText: {
    color: '#FFB4A8',
    fontSize: 24,
    marginTop: 18,
  },
});
