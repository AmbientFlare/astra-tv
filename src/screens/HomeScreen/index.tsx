import React, {useEffect, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {MediaCard} from '../../components/MediaCard';
import {getLibraries, JellyfinLibrary} from '../../services/jellyfin';
import {ServerProfile} from '../../services/storage';

interface HomeScreenProps {
  onSelectLibrary?: (library: JellyfinLibrary) => void;
  serverProfile: ServerProfile | null;
}

export const HomeScreen = ({
  onSelectLibrary,
  serverProfile,
}: HomeScreenProps) => {
  const [libraries, setLibraries] = useState<JellyfinLibrary[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadLibraries = async () => {
      if (!serverProfile) {
        return;
      }

      setLoading(true);
      setErrorText(null);

      try {
        const results = await getLibraries(
          serverProfile.serverUrl,
          serverProfile.accessToken,
        );

        if (mounted) {
          setLibraries(results);
        }
      } catch (error) {
        if (mounted) {
          setErrorText(
            error instanceof Error
              ? error.message
              : 'Unable to load libraries.',
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadLibraries();

    return () => {
      mounted = false;
    };
  }, [serverProfile]);

  return (
    <View style={styles.screen} testID="home-screen">
      <Text style={styles.title}>Astra</Text>
      <Text style={styles.subtitle}>
        {serverProfile ? serverProfile.name : 'Home'}
      </Text>
      {isLoading ? (
        <Text style={styles.status}>Loading libraries...</Text>
      ) : null}
      {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
      {!isLoading && !errorText && libraries.length === 0 ? (
        <Text style={styles.status}>No libraries found.</Text>
      ) : null}
      <ScrollView horizontal={true} style={styles.libraryScroller}>
        <TVFocusGuideView style={styles.libraryRow}>
          {libraries.map((library) => (
            <MediaCard
              key={library.id}
              onPress={() => onSelectLibrary?.(library)}
              subtitle={library.type ?? 'media'}
              title={library.name}
            />
          ))}
        </TVFocusGuideView>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0C1116',
    padding: 100,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 84,
    fontWeight: '800',
  },
  subtitle: {
    color: '#9FB0BA',
    fontSize: 34,
    marginBottom: 48,
    marginTop: 8,
  },
  status: {
    color: '#B8C5CC',
    fontSize: 30,
  },
  error: {
    color: '#FFB4A8',
    fontSize: 28,
  },
  libraryScroller: {
    flexGrow: 0,
  },
  libraryRow: {
    flexDirection: 'row',
    gap: 28,
  },
});
