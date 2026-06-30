import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {MediaCard} from '../../components/MediaCard';
import {
  getLibraries,
  getLatestItems,
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
  const [isLoading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const loadLibraries = useCallback(async () => {
    if (!serverProfile) {
      return;
    }

    setLoading(true);
    setErrorText(null);

    try {
      const libraryResults = await getLibraries(
        serverProfile.serverUrl,
        serverProfile.accessToken,
      );
      setLibraries(libraryResults);
    } catch (error) {
      setErrorText(
        error instanceof Error ? error.message : 'Unable to load libraries.',
      );
    } finally {
      setLoading(false);
    }
  }, [serverProfile]);

  useEffect(() => {
    loadLibraries();
  }, [loadLibraries]);

  const makeRowLoader = useCallback(
    (kind: 'resume' | 'nextUp' | 'latestMovies' | 'latestShows') =>
      async () => {
        if (!serverProfile) {
          return [];
        }

        switch (kind) {
          case 'resume':
            return getResumeItems(
              serverProfile.serverUrl,
              serverProfile.accessToken,
              serverProfile.userId,
            );
          case 'nextUp':
            return getNextUp(
              serverProfile.serverUrl,
              serverProfile.accessToken,
              serverProfile.userId,
            );
          case 'latestMovies':
            return getLatestItems(
              serverProfile.serverUrl,
              serverProfile.accessToken,
              serverProfile.userId,
              'Movie',
            );
          case 'latestShows':
            return getLatestItems(
              serverProfile.serverUrl,
              serverProfile.accessToken,
              serverProfile.userId,
              'Episode',
            );
        }
      },
    [serverProfile],
  );
  const rowLoaders = useMemo(
    () => ({
      latestMovies: makeRowLoader('latestMovies'),
      latestShows: makeRowLoader('latestShows'),
      nextUp: makeRowLoader('nextUp'),
      resume: makeRowLoader('resume'),
    }),
    [makeRowLoader],
  );

  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      style={styles.screen}
      testID="home-screen">
      <View style={styles.topBar}>
        <FocusableItem
          focusedStyle={styles.profileFocused}
          onPress={onSettings}
          style={styles.profileButton}
          testID="home-profile-button">
          <Text style={styles.profileIcon}>
            {(serverProfile?.username ?? serverProfile?.name ?? 'A')
              .slice(0, 1)
              .toUpperCase()}
          </Text>
        </FocusableItem>
        <TVFocusGuideView style={styles.actions}>
          <FocusableItem
            focusedStyle={styles.pillFocused}
            style={[styles.pillButton, styles.pillSelected]}
            testID="home-pill-button">
            <Text style={styles.pillText}>Home</Text>
          </FocusableItem>
          <FocusableItem
            focusedStyle={styles.pillFocused}
            onPress={onSearch}
            style={styles.pillButton}
            testID="home-search-button">
            <Text style={styles.pillText}>Search</Text>
          </FocusableItem>
        </TVFocusGuideView>
      </View>
      {isLoading ? (
        <Text style={styles.status}>Loading libraries...</Text>
      ) : null}
      {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
      {errorText ? (
        <FocusableItem
          focusedStyle={styles.actionFocused}
          onPress={loadLibraries}
          style={styles.retryButton}
          testID="home-libraries-retry">
          <Text style={styles.actionText}>Retry</Text>
        </FocusableItem>
      ) : null}
      {!isLoading && !errorText && libraries.length === 0 ? (
        <Text style={styles.status}>No libraries found.</Text>
      ) : null}
      {libraries.length ? (
        <>
          <Text style={styles.featureTitle}>My Media</Text>
          <ScrollView horizontal={true} style={styles.libraryScroller}>
            <TVFocusGuideView style={styles.libraryRow}>
              {libraries.map((library, index) => (
                <LibraryTile
                  hasTVPreferredFocus={index === 0}
                  key={library.id}
                  library={library}
                  onPress={() => onSelectLibrary?.(library)}
                />
              ))}
            </TVFocusGuideView>
          </ScrollView>
        </>
      ) : null}
      <HomeMediaRow
        loadItems={rowLoaders.resume}
        onSelectItem={onSelectItem}
        title="Continue Watching"
      />
      <HomeMediaRow
        loadItems={rowLoaders.nextUp}
        onSelectItem={onSelectItem}
        title="Next Up"
      />
      <HomeMediaRow
        loadItems={rowLoaders.latestMovies}
        onSelectItem={onSelectItem}
        title="Latest Movies"
      />
      <HomeMediaRow
        loadItems={rowLoaders.latestShows}
        onSelectItem={onSelectItem}
        title="Latest Shows"
      />
    </ScrollView>
  );
};

const LibraryTile = ({
  hasTVPreferredFocus,
  library,
  onPress,
}: {
  hasTVPreferredFocus?: boolean;
  library: JellyfinLibrary;
  onPress?: () => void;
}) => (
  <FocusableItem
    focusedStyle={styles.libraryTileFocused}
    hasTVPreferredFocus={hasTVPreferredFocus}
    onPress={onPress}
    style={styles.libraryTile}
    testID={`home-library-${library.id}`}>
    {library.imageUrl ? (
      <Image source={{uri: library.imageUrl}} style={styles.libraryImage} />
    ) : null}
    <View style={styles.libraryShade} />
    <Text numberOfLines={1} style={styles.libraryTitle}>
      {library.name}
    </Text>
  </FocusableItem>
);

const HomeMediaRow = ({
  loadItems,
  onSelectItem,
  title,
}: {
  loadItems: () => Promise<JellyfinMediaItem[]>;
  onSelectItem?: (item: JellyfinMediaItem) => void;
  title: string;
}) => {
  const [items, setItems] = useState<JellyfinMediaItem[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorText(null);

    try {
      setItems(await loadItems());
    } catch (error) {
      setErrorText(
        error instanceof Error ? error.message : `Unable to load ${title}.`,
      );
    } finally {
      setLoading(false);
    }
  }, [loadItems, title]);

  useEffect(() => {
    load();
  }, [load]);

  if (!isLoading && !errorText && items.length === 0) {
    return null;
  }

  return (
    <>
      <Text style={styles.rowTitle}>{title}</Text>
      {isLoading ? (
        <Text style={styles.rowStatus}>Loading {title}...</Text>
      ) : null}
      {errorText ? (
        <View style={styles.rowErrorLine}>
          <Text style={styles.error}>{errorText}</Text>
          <FocusableItem
            focusedStyle={styles.actionFocused}
            onPress={load}
            style={styles.rowRetryButton}
            testID={`home-${title}-retry`}>
            <Text style={styles.actionText}>Retry</Text>
          </FocusableItem>
        </View>
      ) : null}
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
  },
  screenContent: {
    paddingHorizontal: 84,
    paddingTop: 42,
    paddingBottom: 90,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  profileButton: {
    alignItems: 'center',
    backgroundColor: '#1B2832',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    width: 56,
  },
  profileFocused: {
    backgroundColor: '#2E5A72',
  },
  profileIcon: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '800',
  },
  actions: {
    flexDirection: 'row',
    gap: 14,
  },
  actionFocused: {
    backgroundColor: '#315066',
  },
  pillButton: {
    alignItems: 'center',
    backgroundColor: '#1A252E',
    borderRadius: 28,
    height: 54,
    justifyContent: 'center',
    minWidth: 128,
    paddingHorizontal: 26,
  },
  pillSelected: {
    backgroundColor: '#2B4150',
  },
  pillFocused: {
    backgroundColor: '#3D6E88',
  },
  pillText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
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
  retryButton: {
    width: 130,
    height: 50,
    borderRadius: 8,
    backgroundColor: '#24313A',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  libraryScroller: {
    flexGrow: 0,
    marginBottom: 30,
  },
  mediaScroller: {
    flexGrow: 0,
    marginBottom: 30,
  },
  libraryRow: {
    flexDirection: 'row',
    gap: 28,
  },
  featureTitle: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
    marginBottom: 16,
  },
  libraryTile: {
    width: 330,
    height: 186,
    borderRadius: 8,
    backgroundColor: '#182027',
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  libraryTileFocused: {
    borderColor: '#4CC9F0',
    borderWidth: 4,
  },
  libraryImage: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.82,
  },
  libraryShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  libraryTitle: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '800',
    padding: 18,
  },
  rowTitle: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '800',
    marginBottom: 14,
    marginTop: 18,
  },
  rowStatus: {
    color: '#B8C5CC',
    fontSize: 22,
    marginBottom: 10,
  },
  rowErrorLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    marginBottom: 10,
  },
  rowRetryButton: {
    width: 110,
    height: 46,
    borderRadius: 8,
    backgroundColor: '#24313A',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
