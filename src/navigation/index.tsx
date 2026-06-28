import React, {useEffect, useState} from 'react';
import {ActivityIndicator, StyleSheet, Text, View} from 'react-native';
import {HomeScreen} from '../screens/HomeScreen';
import {LibraryScreen} from '../screens/LibraryScreen';
import {SetupScreen} from '../screens/SetupScreen';
import {PlayerScreen} from '../screens/PlayerScreen';
import {JellyfinLibrary, JellyfinMediaItem} from '../services/jellyfin';
import {
  getLastUsedServerProfile,
  readServerProfiles,
  ServerProfile,
} from '../services/storage';

type LaunchRoute = 'loading' | 'setup' | 'home' | 'library' | 'player';

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
        onSelectLibrary={(library) => {
          setSelectedLibrary(library);
          setRoute('library');
        }}
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
