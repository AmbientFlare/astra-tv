/**
 * Music browse.
 *
 * Section order is deliberate and differs from Jellyfin's own client, which
 * leads with album suggestions: people look for an artist first.
 *
 * Scrolling is infinite rather than paged — the reference library has 821
 * albums and 11,547 tracks, and a "next page" button at 100 items is the main
 * complaint about the existing client. Pages are fetched on approach and the
 * list is windowed, so only a screenful of artwork is ever resident. That, plus
 * requesting small thumbnails, is what keeps this fast; there is no filesystem
 * API on Vega to cache art locally, and 821 covers are never on screen at once.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {
  DEFAULT_PAGE_SIZE,
  getAlbumArtists,
  getAlbums,
  getGenres,
  getPlaylists,
  MusicSession,
  Page,
} from '../../services/jellyfin/music';
import {
  getMusicViewMode,
  MusicViewMode,
  setMusicViewMode,
} from '../../services/storage';
import {ServerProfile} from '../../services/storage';
import {markerLetterFor} from './jumpMarker';

export type MusicTab = 'artists' | 'albums' | 'genres' | 'playlists';

/** User-specified order: artists first, playlists last. */
export const MUSIC_TABS: Array<{key: MusicTab; label: string}> = [
  {key: 'artists', label: 'Artists'},
  {key: 'albums', label: 'Albums'},
  {key: 'genres', label: 'Genres'},
  {key: 'playlists', label: 'Playlists'},
];

/** '#' collects everything that does not sort under a letter. */
export const JUMP_LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];

interface BrowseItem {
  id: string;
  imageUrl?: string;
  subtitle?: string;
  title: string;
}

interface MusicScreenProps {
  initialTab?: MusicTab;
  onBack?: () => void;
  onSelect?: (tab: MusicTab, item: BrowseItem) => void;
  serverProfile: ServerProfile;
}

// Measured on a real panel: 6 across leaves roughly two tiles of dead space.
const POSTER_COLUMNS = 8;
const LIST_COLUMNS = 1;

export const MusicScreen = ({
  initialTab = 'artists',
  onBack,
  onSelect,
  serverProfile,
}: MusicScreenProps) => {
  const [tab, setTab] = useState<MusicTab>(initialTab);
  const [viewMode, setViewMode] = useState<MusicViewMode>('poster');
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [letter, setLetter] = useState<string | null>(null);
  // Where the user currently is in the alphabet, derived from what is on
  // screen rather than from the filter.
  const [markerLetter, setMarkerLetter] = useState<string | null>(null);

  // Guards against overlapping page requests and against a late response from
  // a tab the user has already navigated away from.
  const requestToken = useRef(0);
  const loadingMore = useRef(false);
  const columnsRef = useRef(1);
  // FlatList requires this to be referentially stable across renders.
  const onViewableItemsChanged = useRef(
    ({viewableItems}: {viewableItems: Array<{item?: BrowseItem}>}) => {
      const titles = viewableItems
        .map((entry) => entry.item?.title)
        .filter((title): title is string => Boolean(title));

      setMarkerLetter(markerLetterFor(titles, columnsRef.current));
    },
  ).current;

  const session: MusicSession = useMemo(
    () => ({
      accessToken: serverProfile.accessToken,
      serverUrl: serverProfile.serverUrl,
      userId: serverProfile.userId,
    }),
    [serverProfile],
  );

  const fetchPage = useCallback(
    async (
      activeTab: MusicTab,
      startIndex: number,
      activeLetter: string | null,
    ) => {
      const options = {
        limit: DEFAULT_PAGE_SIZE,
        startIndex,
        // '#' maps to Jellyfin's "sorts before A" bucket.
        ...(activeLetter === '#'
          ? {nameLessThan: 'A'}
          : activeLetter
          ? {nameStartsWith: activeLetter}
          : {}),
      };

      switch (activeTab) {
        case 'albums': {
          const page = await getAlbums(session, options);
          return mapPage(page, (album) => ({
            id: album.id,
            imageUrl: album.imageUrl,
            subtitle: album.albumArtist,
            title: album.name,
          }));
        }
        case 'genres': {
          const page = await getGenres(session, options);
          return mapPage(page, (genre) => ({
            id: genre.id,
            imageUrl: genre.imageUrl,
            title: genre.name,
          }));
        }
        case 'playlists': {
          const page = await getPlaylists(session, options);
          return mapPage(page, (playlist) => ({
            id: playlist.id,
            imageUrl: playlist.imageUrl,
            subtitle: playlist.trackCount
              ? `${playlist.trackCount} tracks`
              : undefined,
            title: playlist.name,
          }));
        }
        default: {
          const page = await getAlbumArtists(session, options);
          return mapPage(page, (artist) => ({
            id: artist.id,
            imageUrl: artist.imageUrl,
            subtitle: artist.albumCount
              ? `${artist.albumCount} albums`
              : undefined,
            title: artist.name,
          }));
        }
      }
    },
    [session],
  );

  // Reload from the top whenever the tab or the A-Z filter changes.
  useEffect(() => {
    let active = true;
    const token = (requestToken.current += 1);

    const load = async () => {
      setLoading(true);
      setErrorText(null);
      setItems([]);

      try {
        const [page, savedMode] = await Promise.all([
          fetchPage(tab, 0, letter),
          getMusicViewMode(tab),
        ]);

        if (!active || token !== requestToken.current) {
          return;
        }

        setItems(page.items);
        setTotalCount(page.totalCount);
        setViewMode(savedMode);
      } catch (error) {
        if (active && token === requestToken.current) {
          setErrorText(
            error instanceof Error ? error.message : 'Unable to load music.',
          );
        }
      } finally {
        if (active && token === requestToken.current) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      active = false;
    };
  }, [fetchPage, letter, tab]);

  const loadMore = useCallback(async () => {
    if (loadingMore.current || items.length >= totalCount || isLoading) {
      return;
    }

    loadingMore.current = true;
    const token = requestToken.current;

    try {
      const page = await fetchPage(tab, items.length, letter);

      // Drop the result if the tab or filter changed while it was in flight.
      if (token !== requestToken.current) {
        return;
      }

      setItems((existing) => {
        const seen = new Set(existing.map((item) => item.id));
        return [
          ...existing,
          ...page.items.filter((item) => !seen.has(item.id)),
        ];
      });
      setTotalCount(page.totalCount);
    } catch {
      // A failed page is not fatal; the user can scroll again to retry.
    } finally {
      loadingMore.current = false;
    }
  }, [fetchPage, isLoading, items.length, letter, tab, totalCount]);

  const toggleViewMode = useCallback(async () => {
    const nextMode: MusicViewMode = viewMode === 'poster' ? 'list' : 'poster';

    setViewMode(nextMode);
    // Remembered per section, so albums can be posters while artists are a list.
    await setMusicViewMode(tab, nextMode);
  }, [tab, viewMode]);

  const columns = viewMode === 'poster' ? POSTER_COLUMNS : LIST_COLUMNS;
  columnsRef.current = columns;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <FocusableItem
          focusedStyle={styles.pillFocused}
          onPress={onBack}
          style={styles.pill}
          testID="music-back">
          <Text style={styles.pillText}>Back</Text>
        </FocusableItem>
        <TVFocusGuideView style={styles.tabs}>
          {MUSIC_TABS.map((entry) => (
            <FocusableItem
              focusedStyle={styles.tabFocused}
              hasTVPreferredFocus={entry.key === initialTab}
              key={entry.key}
              onPress={() => {
                setTab(entry.key);
                setLetter(null);
              }}
              style={[styles.tab, tab === entry.key && styles.tabActive]}
              testID={`music-tab-${entry.key}`}>
              <Text style={styles.tabText}>{entry.label}</Text>
            </FocusableItem>
          ))}
        </TVFocusGuideView>
        <FocusableItem
          focusedStyle={styles.pillFocused}
          onPress={toggleViewMode}
          style={styles.pill}
          testID="music-view-mode">
          <Text style={styles.pillText}>
            {viewMode === 'poster' ? 'Poster' : 'List'}
          </Text>
        </FocusableItem>
      </View>

      <Text style={styles.count}>
        {totalCount ? `${totalCount} ${tab}` : ''}
        {letter ? `  ·  ${letter}` : ''}
      </Text>

      <View style={styles.body}>
        <FlatList
          contentContainerStyle={styles.listContent}
          data={items}
          extraData={viewMode}
          initialNumToRender={columns * 3}
          key={`${tab}-${viewMode}`}
          keyExtractor={(item) => item.id}
          maxToRenderPerBatch={columns * 2}
          numColumns={columns}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          onViewableItemsChanged={onViewableItemsChanged}
          removeClippedSubviews={true}
          renderItem={({item}) => (
            <BrowseTile
              item={item}
              mode={viewMode}
              onPress={() => onSelect?.(tab, item)}
            />
          )}
          windowSize={7}
        />

        <TVFocusGuideView style={styles.jumpRail}>
          {JUMP_LETTERS.map((entry) => (
            <FocusableItem
              focusedStyle={styles.jumpFocused}
              key={entry}
              onPress={() => setLetter(letter === entry ? null : entry)}
              style={styles.jumpItem}
              testID={`music-jump-${entry}`}>
              <Text
                style={[
                  styles.jumpText,
                  markerLetter === entry && styles.jumpTextHere,
                  letter === entry && styles.jumpTextActive,
                ]}>
                {markerLetter === entry && letter !== entry
                  ? `\u25CF ${entry}`
                  : entry}
              </Text>
            </FocusableItem>
          ))}
        </TVFocusGuideView>
      </View>

      {isLoading ? <ActivityIndicator style={styles.spinner} /> : null}
      {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
      {!isLoading && !errorText && !items.length ? (
        <Text style={styles.status}>Nothing here.</Text>
      ) : null}
    </View>
  );
};

const mapPage = <Source, Target>(
  page: Page<Source>,
  map: (item: Source) => Target,
): Page<Target> => ({
  items: page.items.map(map),
  startIndex: page.startIndex,
  totalCount: page.totalCount,
});

const BrowseTile = ({
  item,
  mode,
  onPress,
}: {
  item: BrowseItem;
  mode: MusicViewMode;
  onPress: () => void;
}) => (
  <FocusableItem
    focusedStyle={styles.tileFocused}
    onPress={onPress}
    style={mode === 'poster' ? styles.posterTile : styles.listTile}
    testID={`music-item-${item.id}`}>
    {item.imageUrl ? (
      <Image
        source={{uri: item.imageUrl}}
        style={mode === 'poster' ? styles.posterImage : styles.listImage}
      />
    ) : (
      <View
        style={[
          mode === 'poster' ? styles.posterImage : styles.listImage,
          styles.placeholder,
        ]}>
        <Text style={styles.placeholderText}>
          {item.title.slice(0, 1).toUpperCase()}
        </Text>
      </View>
    )}
    <View style={styles.tileText}>
      <Text numberOfLines={1} style={styles.tileTitle}>
        {item.title}
      </Text>
      {item.subtitle ? (
        <Text numberOfLines={1} style={styles.tileSubtitle}>
          {item.subtitle}
        </Text>
      ) : null}
    </View>
  </FocusableItem>
);

const styles = StyleSheet.create({
  root: {backgroundColor: '#0b0d10', flex: 1, padding: 28},
  header: {alignItems: 'center', flexDirection: 'row', marginBottom: 10},
  tabs: {flex: 1, flexDirection: 'row', marginHorizontal: 16},
  tab: {
    borderRadius: 8,
    marginRight: 10,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  tabActive: {backgroundColor: '#1d2530'},
  tabFocused: {backgroundColor: '#54d38a'},
  tabText: {color: '#f4f6f8', fontSize: 20, fontWeight: '600'},
  pill: {borderRadius: 8, paddingHorizontal: 18, paddingVertical: 8},
  pillFocused: {backgroundColor: '#54d38a'},
  pillText: {color: '#c8d2dc', fontSize: 18},
  count: {color: '#6f7d8c', fontSize: 15, marginBottom: 10},
  body: {flexDirection: 'row', flex: 1},
  listContent: {paddingRight: 12},
  posterTile: {margin: 6, width: 140},
  listTile: {alignItems: 'center', flexDirection: 'row', margin: 6},
  tileFocused: {opacity: 1, transform: [{scale: 1.05}]},
  posterImage: {
    backgroundColor: '#161b22',
    borderRadius: 8,
    height: 140,
    width: 140,
  },
  listImage: {
    backgroundColor: '#161b22',
    borderRadius: 6,
    height: 64,
    width: 64,
  },
  placeholder: {alignItems: 'center', justifyContent: 'center'},
  placeholderText: {color: '#54d38a', fontSize: 30, fontWeight: '700'},
  tileText: {marginLeft: 10, marginTop: 6},
  tileTitle: {color: '#f4f6f8', fontSize: 17},
  tileSubtitle: {color: '#8b97a5', fontSize: 14},
  jumpRail: {paddingLeft: 8, width: 62},
  jumpItem: {alignItems: 'center', paddingVertical: 1},
  jumpFocused: {backgroundColor: '#54d38a', borderRadius: 4},
  jumpText: {color: '#6f7d8c', fontSize: 15},
  jumpTextActive: {color: '#54d38a', fontWeight: '700'},
  jumpTextHere: {color: '#c8d2dc', fontWeight: '600'},
  spinner: {marginTop: 12},
  status: {color: '#8b97a5', fontSize: 18, marginTop: 12},
  error: {color: '#ff8a80', fontSize: 17, marginTop: 12},
});
