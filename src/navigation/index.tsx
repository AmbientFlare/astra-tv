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
import {JellyfinLibrary, JellyfinMediaItem} from '../services/jellyfin';
import {checkAstraProReceipt} from '../services/iap';
import {
  getLastUsedServerProfile,
  incrementLaunchCount,
  readServerProfiles,
  ServerProfile,
  setProStatus,
} from '../services/storage';

const EXIT_BACK_PRESS_COUNT = 3;
const EXIT_BACK_PRESS_WINDOW_MS = 2200;

type LaunchRoute =
  | 'loading'
  | 'setup'
  | 'home'
  | 'library'
  | 'detail'
  | 'player'
  | 'search'
  | 'settings'
  | 'support';

export const RootNavigator = () => {
  const keplerBackHandler = useKeplerBackHandler();
  const [route, setRoute] = useState<LaunchRoute>('loading');
  const [exitPromptVisible, setExitPromptVisible] = useState(false);
  const [serverProfile, setServerProfile] = useState<ServerProfile | null>(
    null,
  );
  const [selectedLibrary, setSelectedLibrary] =
    useState<JellyfinLibrary | null>(null);
  const [selectedItem, setSelectedItem] = useState<JellyfinMediaItem | null>(
    null,
  );
  const exitBackPressState = useRef({count: 0, lastPressedAt: 0});

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

    switch (route) {
      case 'setup':
        if (serverProfile) {
          resetExitPresses();
          setRoute('home');
        } else {
          requestExitConfirmation();
        }
        break;
      case 'library':
      case 'search':
      case 'settings':
      case 'support':
        resetExitPresses();
        setRoute('home');
        break;
      case 'detail':
        resetExitPresses();
        setRoute(selectedLibrary ? 'library' : 'home');
        break;
      case 'player':
        resetExitPresses();
        break;
      case 'home':
      case 'loading':
        requestExitConfirmation();
        break;
    }

    return true;
  }, [
    exitPromptVisible,
    requestExitConfirmation,
    resetExitPresses,
    route,
    selectedLibrary,
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
      const launchCount = await incrementLaunchCount();
      const isPro = await checkAstraProReceipt();

      if (!mounted) {
        return;
      }

      setServerProfile(lastUsedProfile);
      if (!isPro && launchCount > 0 && launchCount % 10 === 0) {
        setRoute('support');
      } else {
        setRoute(profiles.length > 0 ? 'home' : 'setup');
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

  if (route === 'home') {
    return withExitPrompt(
      <HomeScreen
        onSearch={() => setRoute('search')}
        onSelectLibrary={(library) => {
          setSelectedLibrary(library);
          setRoute('library');
        }}
        onSelectItem={(item) => {
          setSelectedItem(item);
          setRoute('detail');
        }}
        onSettings={() => setRoute('settings')}
        serverProfile={serverProfile}
      />,
    );
  }

  if (route === 'library' && selectedLibrary && serverProfile) {
    return withExitPrompt(
      <LibraryScreen
        libraryId={selectedLibrary.id}
        libraryName={selectedLibrary.name}
        onSelectItem={(item) => {
          setSelectedItem(item);
          setRoute('detail');
        }}
        serverProfile={serverProfile}
      />,
    );
  }

  if (route === 'detail' && selectedItem && serverProfile) {
    return withExitPrompt(
      <ItemDetailScreen
        item={selectedItem}
        onBack={() => setRoute(selectedLibrary ? 'library' : 'home')}
        onPlay={(item) => {
          setSelectedItem(item);
          setRoute('player');
        }}
        serverProfile={serverProfile}
      />,
    );
  }

  if (route === 'player' && selectedItem && serverProfile) {
    return withExitPrompt(
      <PlayerScreen
        accessToken={serverProfile.accessToken}
        item={selectedItem}
        onBack={() => setRoute('detail')}
        serverUrl={serverProfile.serverUrl}
        userId={serverProfile.userId}
      />,
    );
  }

  if (route === 'search' && serverProfile) {
    return withExitPrompt(
      <SearchScreen
        onBack={() => setRoute('home')}
        onSelectItem={(item) => {
          setSelectedItem(item);
          setRoute('detail');
        }}
        serverProfile={serverProfile}
      />,
    );
  }

  if (route === 'settings' && serverProfile) {
    return withExitPrompt(
      <SettingsScreen
        onBack={() => setRoute('home')}
        serverProfile={serverProfile}
      />,
    );
  }

  if (route === 'support') {
    return withExitPrompt(
      <SupportScreen
        onDismiss={() => setRoute(serverProfile ? 'home' : 'setup')}
        onProPurchased={() => {
          setProStatus(true).finally(() =>
            setRoute(serverProfile ? 'home' : 'setup'),
          );
        }}
      />,
    );
  }

  if (!serverProfile) {
    return withExitPrompt(
      <SetupScreen
        onConnected={(profile) => {
          setServerProfile(profile);
          setRoute('home');
        }}
      />,
    );
  }

  return withExitPrompt(
    <HomeScreen
      onSearch={() => setRoute('search')}
      onSelectLibrary={(library) => {
        setSelectedLibrary(library);
        setRoute('library');
      }}
      onSelectItem={(item) => {
        setSelectedItem(item);
        setRoute('detail');
      }}
      onSettings={() => setRoute('settings')}
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
