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

const serverTypes: ServerType[] = ['jellyfin', 'emby'];
type WizardStep = 'serverType' | 'server' | 'authMethod' | 'code' | 'password';

const QUICK_CONNECT_POLL_MS = 3000;

interface SetupScreenProps {
  onConnected?: (profile: ServerProfile) => void;
}

export const SetupScreen = ({onConnected}: SetupScreenProps) => {
  const [step, setStep] = useState<WizardStep>('serverType');
  const [serverUrl, setServerUrl] = useState(DEV_SERVER_URL);
  const [username, setUsername] = useState(DEV_USERNAME);
  const [password, setPassword] = useState(DEV_PASSWORD);
  const [serverType, setServerType] = useState<ServerType>('jellyfin');
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

    const scan = async () => {
      const servers = await discoverServers({
        subnetPrefixes: await getLocalSubnetPrefixes(),
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

  const saveProfile = useCallback(
    async (authResult: JellyfinAuthResult, info: JellyfinServerInfo) => {
      const normalizedServerUrl = serverUrl.trim().replace(/\/+$/, '');
      const profile: ServerProfile = {
        // Server id + user id, so each user on a server is its own profile
        // and adding a second user doesn't overwrite the first.
        id: `${info.id || normalizedServerUrl}:${authResult.userId}`,
        name: info.name,
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

  const handleServerConnect = async () => {
    if (isBusy) {
      return;
    }

    setBusy(true);
    setErrorText(null);

    try {
      const info = await connect(serverUrl);
      setServerInfo(info);
      const enabled =
        serverType === 'jellyfin' && (await isQuickConnectEnabled(serverUrl));
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

  const handlePasswordSignIn = async () => {
    if (isBusy) {
      return;
    }

    setBusy(true);
    setErrorText(null);

    try {
      const info = serverInfo ?? (await connect(serverUrl));
      const authResult = await authenticate(serverUrl, username, password);
      await saveProfile(authResult, info);
    } catch (error) {
      setErrorText(
        error instanceof Error ? error.message : 'Unable to sign in.',
      );
    } finally {
      setBusy(false);
    }
  };

  const startQuickConnect = async () => {
    if (isBusy) {
      return;
    }

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

  useEffect(() => {
    if (step !== 'code' || !quickConnectSecret.current) {
      return;
    }

    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let consecutivePollErrors = 0;

    const scheduleNextCheck = (check: () => Promise<void>) => {
      if (active) {
        timeout = setTimeout(check, QUICK_CONNECT_POLL_MS);
      }
    };

    const checkApproval = async () => {
      const secret = quickConnectSecret.current;
      if (!active || !secret) {
        return;
      }

      let approved = false;
      try {
        approved = await pollQuickConnect(serverUrl, secret);
        consecutivePollErrors = 0;
      } catch {
        consecutivePollErrors += 1;
        if (consecutivePollErrors < 3) {
          scheduleNextCheck(checkApproval);
          return;
        }

        if (active) {
          quickConnectSecret.current = null;
          setErrorText(
            'Quick Connect expired or lost contact with the server.',
          );
          setStep('authMethod');
        }
        return;
      }

      if (!approved || !active) {
        scheduleNextCheck(checkApproval);
        return;
      }

      setBusy(true);
      try {
        const authResult = await authenticateWithQuickConnect(
          serverUrl,
          secret,
        );
        const info = serverInfo ?? (await connect(serverUrl));
        quickConnectSecret.current = null;
        await saveProfile(authResult, info);
      } catch (error) {
        if (active) {
          quickConnectSecret.current = null;
          setBusy(false);
          setErrorText(
            error instanceof Error
              ? error.message
              : 'Quick Connect sign-in failed.',
          );
          setStep('authMethod');
        }
      }
    };

    timeout = setTimeout(checkApproval, QUICK_CONNECT_POLL_MS);

    return () => {
      active = false;
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [saveProfile, serverInfo, serverUrl, step]);

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
            Choose the media server Astra should connect to.
          </Text>
          <View style={styles.segmentedControl}>
            {serverTypes.map((type, index) => {
              const isComingSoon = type === 'emby';

              return (
                <FocusableItem
                  accessibilityLabel={
                    isComingSoon ? 'Emby, coming soon' : 'Jellyfin'
                  }
                  disabled={isComingSoon}
                  focusedStyle={styles.segmentFocused}
                  hasTVPreferredFocus={index === 0}
                  key={type}
                  onPress={
                    isComingSoon
                      ? undefined
                      : () => {
                          setServerType(type);
                          setErrorText(null);
                          setStep('server');
                        }
                  }
                  style={[
                    styles.segment,
                    styles.segmentBorder,
                    serverType === type && styles.segmentSelected,
                    isComingSoon && styles.segmentDisabled,
                  ]}
                  testID={`setup-server-type-${type}`}>
                  <Text
                    style={[
                      styles.segmentText,
                      isComingSoon && styles.segmentTextDisabled,
                    ]}>
                    {type === 'jellyfin' ? 'Jellyfin' : 'Emby'}
                  </Text>
                  <Text
                    style={[
                      styles.segmentHint,
                      isComingSoon && styles.segmentHintDisabled,
                    ]}>
                    {isComingSoon ? 'Coming soon' : 'Press Select'}
                  </Text>
                </FocusableItem>
              );
            })}
          </View>
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
              disabled={isScanning}
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
            <Text style={styles.label}>Server address</Text>
            <TVTextInput
              autoCapitalize="none"
              autoComplete="url"
              autoCorrect={false}
              auxOptions="title:Server URL"
              focusStrategy="native"
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
              Enter an IP address, domain, or Tailscale address.
            </Text>
          </View>

          <View style={styles.buttonRow}>
            {backButton('Back', () => {
              setErrorText(null);
              setStep('serverType');
            })}
            <FocusableItem
              accessibilityLabel="Connect"
              disabled={isBusy}
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
            Choose how you want to sign in.
          </Text>
          <View style={styles.methodRow}>
            <FocusableItem
              accessibilityLabel="Sign in with a Quick Connect code"
              disabled={isBusy}
              focusedStyle={styles.methodFocused}
              hasTVPreferredFocus={true}
              onPress={startQuickConnect}
              style={[styles.methodButton, styles.methodRecommended]}
              testID="setup-method-code">
              <Text style={styles.methodBadge}>RECOMMENDED</Text>
              <Text style={styles.methodTitle}>Quick Connect</Text>
              <Text style={styles.methodHint}>
                Approve a short code from another signed-in device.
              </Text>
            </FocusableItem>
            <FocusableItem
              accessibilityLabel="Sign in with username and password"
              disabled={isBusy}
              focusedStyle={styles.methodFocused}
              onPress={() => {
                setErrorText(null);
                setStep('password');
              }}
              style={styles.methodButton}
              testID="setup-method-password">
              <Text style={styles.methodTitle}>Username &amp; password</Text>
              <Text style={styles.methodHint}>
                Enter your account credentials with the remote.
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
          <Text style={styles.stepTitle}>Enter this Quick Connect code</Text>
          <View style={styles.codeInstructions}>
            <Text style={styles.codeStep}>
              1. Open Jellyfin on a signed-in phone, tablet, or computer.
            </Text>
            <Text style={styles.codeStep}>
              2. Open the user menu and choose Quick Connect.
            </Text>
            <Text style={styles.codeStep}>
              3. Enter this code and approve the connection.
            </Text>
          </View>
          <View style={styles.codeBox}>
            <Text style={styles.codeBoxLabel}>Your code</Text>
            <Text style={styles.code} testID="setup-quickconnect-code">
              {quickConnectCode ?? '------'}
            </Text>
            <Text style={styles.waitingText}>
              {isBusy ? 'Signing in...' : 'Waiting for approval...'}
            </Text>
          </View>
          {backButton('Cancel', cancelQuickConnect)}
        </>
      );
    }

    return (
      <>
        <Text style={styles.stepTitle}>Sign in</Text>
        <Text style={styles.stepSubtitle}>
          Enter your account on {serverInfo?.name ?? 'the server'}.
        </Text>
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
            disabled={isBusy}
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
    marginBottom: 26,
    maxWidth: 840,
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
    width: 250,
    height: 100,
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
    backgroundColor: '#11181E',
    borderColor: 'rgba(255,255,255,0.08)',
    opacity: 0.55,
  },
  segmentFocused: {
    backgroundColor: '#285168',
  },
  segmentText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
  },
  segmentTextDisabled: {
    color: '#7C8991',
  },
  segmentHint: {
    color: '#9FB0B8',
    fontSize: 18,
    marginTop: 6,
  },
  segmentHintDisabled: {
    color: '#69757D',
  },
  buttonRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 18,
  },
  backButton: {
    alignItems: 'center',
    backgroundColor: '#24313A',
    borderRadius: 8,
    height: 68,
    justifyContent: 'center',
    marginTop: 8,
    width: 180,
  },
  backFocused: {
    backgroundColor: '#334550',
  },
  backText: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '700',
  },
  methodRow: {
    flexDirection: 'row',
    gap: 22,
    marginBottom: 26,
  },
  methodButton: {
    alignItems: 'center',
    backgroundColor: '#172129',
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 190,
    paddingHorizontal: 20,
    paddingVertical: 20,
    width: 390,
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
    fontSize: 30,
    fontWeight: '800',
    textAlign: 'center',
  },
  methodHint: {
    color: '#9FB0B8',
    fontSize: 21,
    lineHeight: 28,
    marginTop: 10,
    textAlign: 'center',
  },
  codeInstructions: {
    marginBottom: 20,
  },
  codeStep: {
    color: '#D3DDE3',
    fontSize: 24,
    lineHeight: 34,
    marginBottom: 10,
  },
  codeBox: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#14202A',
    borderColor: '#4CC9F0',
    borderRadius: 12,
    borderWidth: 2,
    marginBottom: 22,
    minWidth: 460,
    paddingHorizontal: 48,
    paddingVertical: 24,
  },
  codeBoxLabel: {
    color: '#AAB7C0',
    fontSize: 22,
    fontWeight: '700',
  },
  code: {
    color: '#FFFFFF',
    fontSize: 64,
    fontWeight: '800',
    letterSpacing: 10,
    marginVertical: 8,
  },
  waitingText: {
    color: '#7DE2C4',
    fontSize: 22,
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
