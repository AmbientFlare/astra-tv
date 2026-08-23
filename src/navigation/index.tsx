import React, {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {
  TVFocusGuideView,
  useKeplerAppStateManager,
  useKeplerBackHandler,
} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../components/FocusableItem';
import {ProfileSwitcher} from '../components/ProfileSwitcher';
import {HomeScreen} from '../screens/HomeScreen';
import {ItemDetailScreen} from '../screens/ItemDetailScreen';
import {EpisodeDetailScreen} from '../screens/EpisodeDetailScreen';
import {LibraryScreen} from '../screens/LibraryScreen';
import {SetupScreen} from '../screens/SetupScreen';
import {PlayerScreen} from '../screens/PlayerScreen';
import {PersonDetailScreen} from '../screens/PersonDetailScreen';
import {SearchScreen} from '../screens/SearchScreen';
import {MusicScreen, MusicTab} from '../screens/MusicScreen';
import {ArtistDetailScreen} from '../screens/ArtistDetailScreen';
import {AlbumDetailScreen} from '../screens/AlbumDetailScreen';
import {
  MusicCollectionKind,
  MusicCollectionScreen,
} from '../screens/MusicCollectionScreen';
import {audioPlayback} from '../services/audioPlayer';
import {NowPlayingBar} from '../components/NowPlayingBar';
import {AudioIdleVisual} from '../components/AudioIdleVisual';
import {NowPlayingScreen} from '../screens/NowPlayingScreen';
import {SettingsScreen} from '../screens/SettingsScreen';
import {JellyfinLibrary, JellyfinMediaItem} from '../services/jellyfin';
import {
  getLastUsedServerProfile,
  getUserPreferences,
  readServerProfiles,
  ServerProfile,
  upsertServerProfile,
} from '../services/storage';

const EXIT_BACK_PRESS_COUNT = 3;
const EXIT_BACK_PRESS_WINDOW_MS = 2200;

type LaunchRoute = 'loading' | 'setup';

type RouteEntry =
  | {route: 'home'}
  | {route: 'library'; library: JellyfinLibrary}
  | {route: 'detail'; item: JellyfinMediaItem}
  | {route: 'episodeDetail'; item: JellyfinMediaItem}
  | {route: 'player'; item: JellyfinMediaItem}
  | {route: 'music'; tab?: MusicTab}
  | {route: 'musicArtist'; artistId: string}
  | {route: 'musicAlbum'; albumId: string}
  | {route: 'nowPlaying'}
  | {
      route: 'musicCollection';
      collectionId: string;
      kind: MusicCollectionKind;
      title: string;
    }
  | {route: 'search'}
  | {route: 'settings'}
  | {route: 'addServer'}
  | {route: 'personDetail'; personId: string; personName?: string};

export const RootNavigator = () => {
  const keplerBackHandler = useKeplerBackHandler();
  const appStateManager = useKeplerAppStateManager();

  // Media control focus must be acquired before the audio player initializes,
  // or the platform refuses to start playback. Registered once here rather
  // than per screen, because playback outlives any individual screen.
  useEffect(() => {
    audioPlayback.setComponentInstance(appStateManager.getComponentInstance());
  }, [appStateManager]);

  const [route, setRoute] = useState<LaunchRoute>('loading');
  const [exitPromptVisible, setExitPromptVisible] = useState(false);
  const [serverProfile, setServerProfile] = useState<ServerProfile | null>(
    null,
  );
  const [stack, setStack] = useState<RouteEntry[]>([{route: 'home'}]);
  const [libraryMenuVisible, setLibraryMenuVisible] = useState(false);
  const [profileSwitcherVisible, setProfileSwitcherVisible] = useState(false);
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

  const replace = useCallback(
    (entry: RouteEntry) =>
      setStack((entries) => [
        ...entries.slice(0, Math.max(0, entries.length - 1)),
        entry,
      ]),
    [],
  );

  const resetStack = useCallback(
    (entry: RouteEntry = {route: 'home'}) => setStack([entry]),
    [],
  );

  const resetExitPresses = useCallback(() => {
    exitBackPressState.current = {count: 0, lastPressedAt: 0};
  }, []);

  const switchProfile = useCallback(
    async (profile: ServerProfile) => {
      setProfileSwitcherVisible(false);

      if (!profile.accessToken) {
        // Signed-out profile: token is gone, so route through sign-in.
        push({route: 'addServer'});
        return;
      }

      const nextProfile = {...profile, lastUsed: Date.now()};
      await upsertServerProfile(nextProfile);
      setServerProfile(nextProfile);
      resetStack();
    },
    [push, resetStack],
  );

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

    if (profileSwitcherVisible) {
      setProfileSwitcherVisible(false);
      resetExitPresses();
      return true;
    }

    if (current.route === 'player') {
      // PlayerScreen owns back while playing: it closes its overlays first
      // and shows its own exit confirm, which calls onBack/pop. Popping
      // here too would yank the user out of the movie on the first press.
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

    if (current.route === 'library' && libraryMenuVisible) {
      resetExitPresses();
      setLibraryMenuVisible(false);
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
    profileSwitcherVisible,
    requestExitConfirmation,
    resetExitPresses,
    route,
    current.route,
    libraryMenuVisible,
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
      const preferences = await getUserPreferences();
      const lastUsedProfile =
        preferences.autoSignIn === 'mostRecent'
          ? await getLastUsedServerProfile()
          : null;
      if (!mounted) {
        return;
      }

      setServerProfile(lastUsedProfile);
      setRoute('setup');
      if (profiles.length > 0) {
        resetStack();
      }
    };

    bootstrap();

    return () => {
      mounted = false;
    };
  }, [resetStack]);

  const profileSwitcher = profileSwitcherVisible ? (
    <ProfileSwitcher
      currentProfileId={serverProfile?.id}
      onAddUser={() => {
        setProfileSwitcherVisible(false);
        push({route: 'addServer'});
      }}
      onClose={() => setProfileSwitcherVisible(false)}
      onSelect={switchProfile}
    />
  ) : null;

  const exitPrompt = exitPromptVisible ? (
    <ExitPrompt
      onCancel={() => setExitPromptVisible(false)}
      onExit={() => keplerBackHandler.exitApp()}
    />
  ) : null;

  // The now-playing bar is mounted globally, below whatever screen is showing,
  // so music keeps its transport visible while browsing — including while
  // browsing video. It renders nothing when there is no queue.
  const withExitPrompt = (screen: React.ReactElement) => (
    <View style={styles.appShell}>
      <View style={styles.appScreen}>{screen}</View>
      <NowPlayingBar
        onOpen={() => {
          if (
            audioPlayback.getStatus().track &&
            current.route !== 'nowPlaying'
          ) {
            push({route: 'nowPlaying'});
          }
        }}
      />
      <AudioIdleVisual />
      {exitPrompt}
    </View>
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

  if (current.route === 'home') {
    return withExitPrompt(
      <>
        <HomeScreen
          onOpenMusic={() => push({route: 'music', tab: 'artists'})}
          onOpenPlaylists={() => push({route: 'music', tab: 'playlists'})}
          onProfiles={() => setProfileSwitcherVisible(true)}
          onSearch={() => push({route: 'search'})}
          onSelectLibrary={(library) => push({route: 'library', library})}
          onSelectItem={(item) => push({route: 'detail', item})}
          onSettings={() => push({route: 'settings'})}
          serverProfile={serverProfile}
        />
        {profileSwitcher}
      </>,
    );
  }

  if (current.route === 'library' && serverProfile) {
    return withExitPrompt(
      <LibraryScreen
        libraryId={current.library.id}
        libraryName={current.library.name}
        libraryType={current.library.type}
        menuVisible={libraryMenuVisible}
        onMenuVisibleChange={setLibraryMenuVisible}
        onSelectItem={(item) => {
          setLibraryMenuVisible(false);
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
        onSelectPerson={(personId, personName) =>
          push({route: 'personDetail', personId, personName})
        }
        serverProfile={serverProfile}
      />,
    );
  }

  if (current.route === 'music' && serverProfile) {
    return withExitPrompt(
      <MusicScreen
        initialTab={current.tab}
        onBack={pop}
        onSelect={(tab, item) => {
          if (tab === 'artists') {
            push({route: 'musicArtist', artistId: item.id});
          } else if (tab === 'albums') {
            push({route: 'musicAlbum', albumId: item.id});
          } else {
            push({
              route: 'musicCollection',
              collectionId: item.id,
              kind: tab === 'genres' ? 'genre' : 'playlist',
              title: item.title,
            });
          }
        }}
        serverProfile={serverProfile}
      />,
    );
  }

  if (current.route === 'musicArtist' && serverProfile) {
    return withExitPrompt(
      <ArtistDetailScreen
        artistId={current.artistId}
        onBack={pop}
        onSelectAlbum={(albumId) => push({route: 'musicAlbum', albumId})}
        serverProfile={serverProfile}
      />,
    );
  }

  if (current.route === 'musicAlbum' && serverProfile) {
    return withExitPrompt(
      <AlbumDetailScreen
        albumId={current.albumId}
        onBack={pop}
        onViewArtist={(artistId) => push({route: 'musicArtist', artistId})}
        serverProfile={serverProfile}
      />,
    );
  }

  if (current.route === 'musicCollection' && serverProfile) {
    return withExitPrompt(
      <MusicCollectionScreen
        collectionId={current.collectionId}
        kind={current.kind}
        onBack={pop}
        onSelectAlbum={(albumId) => push({route: 'musicAlbum', albumId})}
        serverProfile={serverProfile}
        title={current.title}
      />,
    );
  }

  if (current.route === 'nowPlaying') {
    return withExitPrompt(<NowPlayingScreen onBack={pop} />);
  }

  if (current.route === 'player' && serverProfile) {
    return withExitPrompt(
      <PlayerScreen
        accessToken={serverProfile.accessToken}
        item={current.item}
        key={current.item.id}
        onBack={pop}
        onPlayNext={(item) => replace({route: 'player', item})}
        serverUrl={serverProfile.serverUrl}
        userId={serverProfile.userId}
      />,
    );
  }

  if (current.route === 'episodeDetail' && serverProfile) {
    return withExitPrompt(
      <EpisodeDetailScreen
        item={current.item}
        onBack={pop}
        onGoToSeries={(item) => push({route: 'detail', item})}
        onPlay={(item) => push({route: 'player', item})}
        onSelectEpisode={(item) => push({route: 'episodeDetail', item})}
        onSelectPerson={(personId, personName) =>
          push({route: 'personDetail', personId, personName})
        }
        serverProfile={serverProfile}
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

  if (current.route === 'personDetail' && serverProfile) {
    return withExitPrompt(
      <PersonDetailScreen
        onBack={pop}
        onSelectEpisode={(item) => push({route: 'episodeDetail', item})}
        onSelectItem={(item) => push({route: 'detail', item})}
        personId={current.personId}
        personName={current.personName}
        serverProfile={serverProfile}
      />,
    );
  }

  if (current.route === 'settings' && serverProfile) {
    return withExitPrompt(
      <SettingsScreen
        onAddServer={() => push({route: 'addServer'})}
        onBack={pop}
        serverProfile={serverProfile}
      />,
    );
  }

  if (current.route === 'addServer') {
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
    <>
      <HomeScreen
        onOpenMusic={() => push({route: 'music', tab: 'artists'})}
        onOpenPlaylists={() => push({route: 'music', tab: 'playlists'})}
        onProfiles={() => setProfileSwitcherVisible(true)}
        onSearch={() => push({route: 'search'})}
        onSelectLibrary={(library) => push({route: 'library', library})}
        onSelectItem={(item) => push({route: 'detail', item})}
        onSettings={() => push({route: 'settings'})}
        serverProfile={serverProfile}
      />
      {profileSwitcher}
    </>,
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
  appShell: {backgroundColor: '#0b0d10', flex: 1},
  appScreen: {flex: 1},
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
