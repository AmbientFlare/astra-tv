import React, {useEffect, useState} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {MediaCard} from '../../components/MediaCard';
import {
  getLibraries,
  getNextUp,
  getResumeItems,
  JellyfinLibrary,
  JellyfinMediaItem,
} from '../../services/jellyfin';
import {ServerProfile} from '../../services/storage';

interface HomeScreenProps {
  onSearch?: () => void;
  onSelectLibrary?: (library: JellyfinLibrary) => void;
  onSelectItem?: (item: JellyfinMediaItem) => void;
  onSettings?: () => void;
  serverProfile: ServerProfile | null;
}

export const HomeScreen = ({
  onSearch,
  onSelectLibrary,
  onSelectItem,
  onSettings,
  serverProfile,
}: HomeScreenProps) => {
  const [libraries, setLibraries] = useState<JellyfinLibrary[]>([]);
  const [nextUp, setNextUp] = useState<JellyfinMediaItem[]>([]);
  const [resumeItems, setResumeItems] = useState<JellyfinMediaItem[]>([]);
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
        const [libraryResults, resumeResults, nextUpResults] =
          await Promise.all([
            getLibraries(serverProfile.serverUrl, serverProfile.accessToken),
            getResumeItems(
              serverProfile.serverUrl,
              serverProfile.accessToken,
              serverProfile.userId,
            ),
            getNextUp(
              serverProfile.serverUrl,
              serverProfile.accessToken,
              serverProfile.userId,
            ),
          ]);

        if (mounted) {
          setLibraries(libraryResults);
          setResumeItems(resumeResults);
          setNextUp(nextUpResults);
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
      <View style={styles.actions}>
        <FocusableItem
          focusedStyle={styles.actionFocused}
          onPress={onSearch}
          style={styles.actionButton}
          testID="home-search-button">
          <Text style={styles.actionText}>Search</Text>
        </FocusableItem>
        <FocusableItem
          focusedStyle={styles.actionFocused}
          onPress={onSettings}
          style={styles.actionButton}
          testID="home-settings-button">
          <Text style={styles.actionText}>Settings</Text>
        </FocusableItem>
      </View>
      {isLoading ? (
        <Text style={styles.status}>Loading libraries...</Text>
      ) : null}
      {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
      {!isLoading && !errorText && libraries.length === 0 ? (
        <Text style={styles.status}>No libraries found.</Text>
      ) : null}
      <HomeMediaRow
        items={resumeItems}
        onSelectItem={onSelectItem}
        title="Continue Watching"
      />
      <HomeMediaRow
        items={nextUp}
        onSelectItem={onSelectItem}
        title="Next Up"
      />
      <Text style={styles.rowTitle}>Libraries</Text>
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

const HomeMediaRow = ({
  items,
  onSelectItem,
  title,
}: {
  items: JellyfinMediaItem[];
  onSelectItem?: (item: JellyfinMediaItem) => void;
  title: string;
}) => {
  if (items.length === 0) {
    return null;
  }

  return (
    <>
      <Text style={styles.rowTitle}>{title}</Text>
      <ScrollView horizontal={true} style={styles.mediaScroller}>
        <TVFocusGuideView style={styles.libraryRow}>
          {items.map((item) => (
            <MediaCard
              imageUrl={item.imageUrl}
              key={item.id}
              onPress={() => onSelectItem?.(item)}
              subtitle={
                item.seriesName ??
                (item.productionYear ? String(item.productionYear) : item.type)
              }
              title={item.name}
            />
          ))}
        </TVFocusGuideView>
      </ScrollView>
    </>
  );
};

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0C1116',
    paddingHorizontal: 84,
    paddingTop: 56,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 84,
    fontWeight: '800',
  },
  subtitle: {
    color: '#9FB0BA',
    fontSize: 34,
    marginTop: 8,
  },
  actions: {
    flexDirection: 'row',
    gap: 18,
    marginBottom: 34,
    marginTop: 26,
  },
  actionButton: {
    minWidth: 150,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#24313A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionFocused: {
    backgroundColor: '#315066',
  },
  actionText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
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
  mediaScroller: {
    flexGrow: 0,
    marginBottom: 30,
  },
  libraryRow: {
    flexDirection: 'row',
    gap: 28,
  },
  rowTitle: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '800',
    marginBottom: 14,
    marginTop: 18,
  },
});
