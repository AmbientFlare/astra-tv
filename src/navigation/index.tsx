import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {
  TVFocusGuideView,
  useKeplerBackHandler,
} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../components/FocusableItem';
import {HomeScreen} from '../screens/HomeScreen';
import {ItemDetailScreen} from '../screens/ItemDetailScreen';
import {LibraryScreen} from '../screens/LibraryScreen';
import {SetupScreen} from '../screens/SetupScreen';
import {PlayerScreen} from '../screens/PlayerScreen';
import {SearchScreen} from '../screens/SearchScreen';
import {SettingsScreen} from '../screens/SettingsScreen';
import {SupportScreen} from '../screens/SupportScreen';
import {
  authenticate,
  connect,
  JellyfinLibrary,
  JellyfinMediaItem,
} from '../services/jellyfin';
import {checkAstraProReceipt} from '../services/iap';
import {
  DEV_PASSWORD,
  DEV_SERVER_URL,
  DEV_USERNAME,
} from '../config/devCredentials';
import {
  getLastUsedServerProfile,
  incrementLaunchCount,
  readServerProfiles,
  ServerProfile,
  setProStatus,
  upsertServerProfile,
} from '../services/storage';

const EXIT_BACK_PRESS_COUNT = 3;
const EXIT_BACK_PRESS_WINDOW_MS = 2200;
const LEGACY_DEV_SERVER_URLS = ['http://jelly2.ambientflare.art'];

const refreshDevServerProfile = async (
  profile: ServerProfile | null,
): Promise<ServerProfile | null> => {
  const isDevServerProfile =
    profile?.username === DEV_USERNAME &&
    [DEV_SERVER_URL, ...LEGACY_DEV_SERVER_URLS].includes(profile.serverUrl);

  if (!profile || !isDevServerProfile) {
    return profile;
  }

  try {
    const serverInfo = await connect(DEV_SERVER_URL);
    const authResult = await authenticate(
      DEV_SERVER_URL,
      DEV_USERNAME,
      DEV_PASSWORD,
    );
    const refreshedProfile: ServerProfile = {
      ...profile,
      id: serverInfo.id || profile.id,
      name: serverInfo.name || profile.name,
      serverUrl: DEV_SERVER_URL,
      accessToken: authResult.accessToken,
      userId: authResult.userId,
      lastUsed: Date.now(),
    };

    await upsertServerProfile(refreshedProfile);

    return refreshedProfile;
  } catch {
    return profile;
  }
};

type LaunchRoute =
  | 'loading'
  | 'setup'
  | 'support';

type RouteEntry =
  | {route: 'home'}
  | {route: 'library'; library: JellyfinLibrary}
  | {route: 'detail'; item: JellyfinMediaItem}
  | {route: 'episodeDetail'; item: JellyfinMediaItem}
  | {route: 'player'; item: JellyfinMediaItem}
  | {route: 'search'}
  | {route: 'settings'}
  | {route: 'personDetail'; personId: string};

export const RootNavigator = () => {
  const keplerBackHandler = useKeplerBackHandler();
  const [route, setRoute] = useState<LaunchRoute>('loading');
  const [exitPromptVisible, setExitPromptVisible] = useState(false);
  const [serverProfile, setServerProfile] = useState<ServerProfile | null>(
    null,
  );
  const [stack, setStack] = useState<RouteEntry[]>([{route: 'home'}]);
  const exitBackPressState = useRef({count: 0, lastPressedAt: 0});
  const current = stack[stack.length - 1] ?? {route: 'home'};

  const push = useCallback(
    (entry: RouteEntry) => setStack((entries) => [...entries, entry]),
    [],
  );

  const pop = useCallback(
    () =>
      setStack((entries) =>
        entries.length > 1 ? entries.slice(0, -1) : entries,
      ),
    [],
  );

  const resetStack = useCallback(
    (entry: RouteEntry = {route: 'home'}) => setStack([entry]),
    [],
  );

  const resetExitPresses = useCallback(() => {
    exitBackPressState.current = {count: 0, lastPressedAt: 0};
  }, []);

  const requestExitConfirmation = useCallback(() => {
    const now = Date.now();
    const lastPressedAt = exitBackPressState.current.lastPressedAt;
    const count =
      now - lastPressedAt <= EXIT_BACK_PRESS_WINDOW_MS
        ? exitBackPressState.current.count + 1
        : 1;

    exitBackPressState.current = {count, lastPressedAt: now};

    if (count >= EXIT_BACK_PRESS_COUNT) {
      setExitPromptVisible(true);
      resetExitPresses();
    }
  }, [resetExitPresses]);

  const handleBackPress = useCallback(() => {
    if (exitPromptVisible) {
      setExitPromptVisible(false);
      resetExitPresses();
      return true;
    }

    if (route === 'loading') {
      requestExitConfirmation();
      return true;
    }

    if (route === 'setup' && !serverProfile) {
      requestExitConfirmation();
      return true;
    }

    if (route === 'support') {
      resetExitPresses();
      resetStack();
      setRoute('setup');
      return true;
    }

    if (current.route === 'home') {
      requestExitConfirmation();
    } else {
      resetExitPresses();
      pop();
    }

    return true;
  }, [
    exitPromptVisible,
    requestExitConfirmation,
    resetExitPresses,
    resetStack,
    route,
    current.route,
    pop,
    serverProfile,
  ]);

  useEffect(() => {
    const subscription = keplerBackHandler.addEventListener(
      'hardwareBackPress',
      handleBackPress,
    );

    return () => {
      subscription.remove();
    };
  }, [handleBackPress, keplerBackHandler]);

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      const profiles = await readServerProfiles();
      const lastUsedProfile = await getLastUsedServerProfile();
      const refreshedProfile = await refreshDevServerProfile(lastUsedProfile);
      const launchCount = await incrementLaunchCount();
      const isPro = await checkAstraProReceipt();

      if (!mounted) {
        return;
      }

      setServerProfile(refreshedProfile);
      if (!isPro && launchCount > 0 && launchCount % 10 === 0) {
        setRoute('support');
      } else {
        setRoute(profiles.length > 0 ? 'setup' : 'setup');
        if (profiles.length > 0) {
          resetStack();
        }
      }
    };

    bootstrap();

    return () => {
      mounted = false;
    };
  }, []);

  const exitPrompt = exitPromptVisible ? (
    <ExitPrompt
      onCancel={() => setExitPromptVisible(false)}
      onExit={() => keplerBackHandler.exitApp()}
    />
  ) : null;

  const withExitPrompt = (screen: React.ReactElement) => (
    <>
      {screen}
      {exitPrompt}
    </>
  );

  if (route === 'loading') {
    return withExitPrompt(
      <View style={styles.loading} testID="navigation-loading">
        <ActivityIndicator color="#4CC9F0" size="large" />
        <Text style={styles.loadingText}>Loading Astra</Text>
      </View>,
    );
  }

  if (route === 'setup' && !serverProfile) {
    return withExitPrompt(
      <SetupScreen
        onConnected={(profile) => {
          setServerProfile(profile);
          resetStack();
          setRoute('setup');
        }}
      />,
    );
  }

  if (route === 'support') {
    return withExitPrompt(
      <SupportScreen
        onDismiss={() => {
          resetStack();
          setRoute('setup');
        }}
        onProPurchased={() => {
          setProStatus(true).finally(() => {
            resetStack();
            setRoute('setup');
          });
        }}
      />,
    );
  }

  if (current.route === 'home') {
    return withExitPrompt(
      <HomeScreen
        onSearch={() => push({route: 'search'})}
        onSelectLibrary={(library) => push({route: 'library', library})}
        onSelectItem={(item) => push({route: 'detail', item})}
        onSettings={() => push({route: 'settings'})}
        serverProfile={serverProfile}
      />,
    );
  }

  if (current.route === 'library' && serverProfile) {
    return withExitPrompt(
      <LibraryScreen
        libraryId={current.library.id}
        libraryName={current.library.name}
        onSelectItem={(item) => {
          push({route: 'detail', item});
        }}
        serverProfile={serverProfile}
      />,
    );
  }

  if (current.route === 'detail' && serverProfile) {
    return withExitPrompt(
      <ItemDetailScreen
        item={current.item}
        onBack={pop}
        onPlay={(item) => push({route: 'player', item})}
        onSelectEpisode={(item) => push({route: 'episodeDetail', item})}
        onSelectItem={(item) => push({route: 'detail', item})}
        onSelectPerson={(personId) => push({route: 'personDetail', personId})}
        serverProfile={serverProfile}
      />,
    );
  }

  if (current.route === 'player' && serverProfile) {
    return withExitPrompt(
      <PlayerScreen
        accessToken={serverProfile.accessToken}
        item={current.item}
        onBack={pop}
        serverUrl={serverProfile.serverUrl}
        userId={serverProfile.userId}
      />,
    );
  }

  if (current.route === 'search' && serverProfile) {
    return withExitPrompt(
      <SearchScreen
        onBack={pop}
        onSelectItem={(item) => push({route: 'detail', item})}
        serverProfile={serverProfile}
      />,
    );
  }

  if (current.route === 'settings' && serverProfile) {
    return withExitPrompt(
      <SettingsScreen
        onBack={pop}
        serverProfile={serverProfile}
      />,
    );
  }

  if (!serverProfile) {
    return withExitPrompt(
      <SetupScreen
        onConnected={(profile) => {
          setServerProfile(profile);
          resetStack();
          setRoute('setup');
        }}
      />,
    );
  }

  return withExitPrompt(
    <HomeScreen
      onSearch={() => push({route: 'search'})}
      onSelectLibrary={(library) => push({route: 'library', library})}
      onSelectItem={(item) => push({route: 'detail', item})}
      onSettings={() => push({route: 'settings'})}
      serverProfile={serverProfile}
    />,
  );
};

interface ExitPromptProps {
  onCancel: () => void;
  onExit: () => void;
}

const ExitPrompt = ({onCancel, onExit}: ExitPromptProps) => (
  <View style={styles.exitOverlay} testID="exit-confirmation">
    <View style={styles.exitDialog}>
      <Text style={styles.exitTitle}>Exit Astra?</Text>
      <Text style={styles.exitCopy}>
        Press Back to stay, or choose Exit to close the app.
      </Text>
      <TVFocusGuideView style={styles.exitActions}>
        <FocusableItem
          focusedStyle={styles.exitButtonFocused}
          hasTVPreferredFocus={true}
          onPress={onCancel}
          style={styles.exitButton}
          testID="exit-cancel-button">
          <Text style={styles.exitButtonText}>Stay</Text>
        </FocusableItem>
        <FocusableItem
          focusedStyle={styles.exitDangerFocused}
          onPress={onExit}
          style={[styles.exitButton, styles.exitDangerButton]}
          testID="exit-confirm-button">
          <Text style={styles.exitButtonText}>Exit</Text>
        </FocusableItem>
      </TVFocusGuideView>
    </View>
  </View>
);

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: '#0C1116',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    color: '#B8C5CC',
    fontSize: 30,
    marginTop: 24,
  },
  exitOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.74)',
    justifyContent: 'center',
    padding: 64,
  },
  exitDialog: {
    width: 620,
    borderRadius: 8,
    backgroundColor: '#101820',
    borderColor: '#324555',
    borderWidth: 2,
    padding: 36,
  },
  exitTitle: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '700',
  },
  exitCopy: {
    color: '#B8C5CC',
    fontSize: 22,
    lineHeight: 30,
    marginTop: 14,
  },
  exitActions: {
    flexDirection: 'row',
    gap: 18,
    marginTop: 30,
  },
  exitButton: {
    alignItems: 'center',
    backgroundColor: '#25313A',
    borderRadius: 6,
    minWidth: 170,
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  exitDangerButton: {
    backgroundColor: '#5A2D36',
  },
  exitButtonFocused: {
    backgroundColor: '#315066',
  },
  exitDangerFocused: {
    backgroundColor: '#7A3843',
  },
  exitButtonText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
  },
});
