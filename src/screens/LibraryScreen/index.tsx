import React, {useEffect, useState} from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {MediaCard} from '../../components/MediaCard';
import {getItems, JellyfinMediaItem} from '../../services/jellyfin';
import {ServerProfile} from '../../services/storage';

interface LibraryScreenProps {
  libraryId: string;
  libraryName: string;
  onSelectItem?: (item: JellyfinMediaItem) => void;
  serverProfile: ServerProfile;
}

export const LibraryScreen = ({
  libraryId,
  libraryName,
  onSelectItem,
  serverProfile,
}: LibraryScreenProps) => {
  const [items, setItems] = useState<JellyfinMediaItem[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const loadItems = async () => {
      setLoading(true);
      setErrorText(null);

      try {
        const results = await getItems(
          serverProfile.serverUrl,
          serverProfile.accessToken,
          libraryId,
          serverProfile.userId,
        );

        if (mounted) {
          setItems(results);
        }
      } catch (error) {
        if (mounted) {
          setErrorText(
            error instanceof Error ? error.message : 'Unable to load library.',
          );
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    loadItems();

    return () => {
      mounted = false;
    };
  }, [libraryId, serverProfile]);

  return (
    <View style={styles.screen} testID="library-screen">
      <Text style={styles.title}>{libraryName}</Text>
      {isLoading ? <Text style={styles.status}>Loading items...</Text> : null}
      {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
      {!isLoading && !errorText && items.length === 0 ? (
        <Text style={styles.status}>No playable items found.</Text>
      ) : null}
      <TVFocusGuideView style={styles.gridGuide}>
        <FlatList
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.grid}
          data={items}
          keyExtractor={(item) => item.id}
          numColumns={4}
          renderItem={({index, item}) => (
            <MediaCard
              imageUrl={item.imageUrl}
              onPress={() => onSelectItem?.(item)}
              subtitle={
                item.productionYear
                  ? String(item.productionYear)
                  : item.type.toLowerCase()
              }
              title={item.name}
              hasTVPreferredFocus={index === 0}
            />
          )}
        />
      </TVFocusGuideView>
    </View>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0C1116',
    paddingHorizontal: 84,
    paddingTop: 64,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 58,
    fontWeight: '800',
    marginBottom: 30,
  },
  status: {
    color: '#B8C5CC',
    fontSize: 30,
  },
  error: {
    color: '#FFB4A8',
    fontSize: 28,
  },
  gridGuide: {
    flex: 1,
  },
  grid: {
    gap: 26,
    paddingBottom: 80,
  },
  gridRow: {
    gap: 26,
  },
});
