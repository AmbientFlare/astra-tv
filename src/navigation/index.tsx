import React, {useEffect, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {HomeScreen} from '../screens/HomeScreen';
import {ItemDetailScreen} from '../screens/ItemDetailScreen';
import {LibraryScreen} from '../screens/LibraryScreen';
import {SetupScreen} from '../screens/SetupScreen';
import {PlayerScreen} from '../screens/PlayerScreen';
import {SearchScreen} from '../screens/SearchScreen';
import {SettingsScreen} from '../screens/SettingsScreen';
import {JellyfinLibrary, JellyfinMediaItem} from '../services/jellyfin';
import {
  getLastUsedServerProfile,
  readServerProfiles,
  ServerProfile,
} from '../services/storage';

type LaunchRoute =
  | 'loading'
  | 'setup'
  | 'home'
  | 'library'
  | 'detail'
  | 'player'
  | 'search'
  | 'settings';

export const RootNavigator = () => {
  const [route, setRoute] = useState<LaunchRoute>('loading');
  const [serverProfile, setServerProfile] = useState<ServerProfile | null>(
    null,
  );
  const [selectedLibrary, setSelectedLibrary] =
    useState<JellyfinLibrary | null>(null);
  const [selectedItem, setSelectedItem] = useState<JellyfinMediaItem | null>(
    null,
  );

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      const profiles = await readServerProfiles();
      const lastUsedProfile = await getLastUsedServerProfile();

      if (!mounted) {
        return;
      }

      setServerProfile(lastUsedProfile);
      setRoute(profiles.length > 0 ? 'home' : 'setup');
    };

    bootstrap();

    return () => {
      mounted = false;
    };
  }, []);

  if (route === 'loading') {
    return (
      <View style={styles.loading} testID="navigation-loading">
        <ActivityIndicator color="#4CC9F0" size="large" />
        <Text style={styles.loadingText}>Loading Astra</Text>
      </View>
    );
  }

  if (route === 'home') {
    return (
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
      />
    );
  }

  if (route === 'library' && selectedLibrary && serverProfile) {
    return (
      <LibraryScreen
        libraryId={selectedLibrary.id}
        libraryName={selectedLibrary.name}
        onSelectItem={(item) => {
          setSelectedItem(item);
          setRoute('detail');
        }}
        serverProfile={serverProfile}
      />
    );
  }

  if (route === 'detail' && selectedItem && serverProfile) {
    return (
      <ItemDetailScreen
        item={selectedItem}
        onBack={() => setRoute(selectedLibrary ? 'library' : 'home')}
        onPlay={(item) => {
          setSelectedItem(item);
          setRoute('player');
        }}
        serverProfile={serverProfile}
      />
    );
  }

  if (route === 'player' && selectedItem && serverProfile) {
    return (
      <PlayerScreen
        accessToken={serverProfile.accessToken}
        item={selectedItem}
        onBack={() => setRoute('library')}
        serverUrl={serverProfile.serverUrl}
        userId={serverProfile.userId}
      />
    );
  }

  if (route === 'search' && serverProfile) {
    return (
      <SearchScreen
        onBack={() => setRoute('home')}
        onSelectItem={(item) => {
          setSelectedItem(item);
          setRoute('detail');
        }}
        serverProfile={serverProfile}
      />
    );
  }

  if (route === 'settings' && serverProfile) {
    return (
      <SettingsScreen
        onBack={() => setRoute('home')}
        serverProfile={serverProfile}
      />
    );
  }

  return (
    <SetupScreen
      onConnected={(profile) => {
        setServerProfile(profile);
        setRoute('home');
      }}
    />
  );
};

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
});
