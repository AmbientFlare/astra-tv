import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {
  TVFocusGuideView,
  useTVEventHandler,
} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {FocusedBackdrop} from '../../components/FocusedBackdrop';
import {MediaCard} from '../../components/MediaCard';
import {PreferenceRadioGroup} from '../../components/PreferenceRadioGroup';
import {
  getItems,
  JellyfinMediaItem,
  JellyfinSortBy,
} from '../../services/jellyfin';
import {
  DisplayPreferences,
  getDisplayPreferences,
  ServerProfile,
  setDisplayPreferences,
} from '../../services/storage';

interface LibraryScreenProps {
  libraryId: string;
  libraryName: string;
  libraryType?: string;
  menuVisible: boolean;
  onMenuVisibleChange: (visible: boolean) => void;
  onSelectItem?: (item: JellyfinMediaItem) => void;
  serverProfile: ServerProfile;
}

const sortOptions: Array<{label: string; value: JellyfinSortBy}> = [
  {label: 'Name', value: 'name'},
  {label: 'Date Added', value: 'dateAdded'},
  {label: 'Release Date', value: 'releaseDate'},
  {label: 'Rating', value: 'rating'},
];

const sortOrderOptions = [
  {label: 'Ascending', value: false},
  {label: 'Descending', value: true},
];

const filterOptions = [
  {label: 'All', value: false},
  {label: 'Unwatched Only', value: true},
];

const favoriteOptions = [
  {label: 'All', value: false},
  {label: 'Favorites Only', value: true},
];

const imageSizeOptions: Array<{
  label: string;
  value: DisplayPreferences['imageSize'];
}> = [
  {label: 'Small', value: 'small'},
  {label: 'Medium', value: 'medium'},
  {label: 'Large', value: 'large'},
];

const imageTypeOptions: Array<{
  label: string;
  value: DisplayPreferences['imageType'];
}> = [
  {label: 'Poster', value: 'Primary'},
  {label: 'Thumb', value: 'Thumb'},
  {label: 'Banner', value: 'Banner'},
];

const imageSizeScale: Record<DisplayPreferences['imageSize'], number> = {
  large: 1.25,
  medium: 1,
  small: 0.75,
};

export const LibraryScreen = ({
  libraryId,
  libraryName,
  libraryType,
  menuVisible,
  onMenuVisibleChange,
  onSelectItem,
  serverProfile,
}: LibraryScreenProps) => {
  const [items, setItems] = useState<JellyfinMediaItem[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<JellyfinSortBy>('name');
  const [sortDescending, setSortDescending] = useState(false);
  const [filterUnwatched, setFilterUnwatched] = useState(false);
  const [filterFavorites, setFilterFavorites] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [backdropUrl, setBackdropUrl] = useState<string | null>(null);
  const [displayPreferences, setDisplayPreferenceState] =
    useState<DisplayPreferences>({
      gridDirection: 'vertical',
      imageSize: 'medium',
      imageType: 'Primary',
    });
  const backdropTimer = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  const queueBackdrop = useCallback((url?: string) => {
    if (!url) {
      return;
    }

    if (backdropTimer.current) {
      clearTimeout(backdropTimer.current);
    }

    backdropTimer.current = setTimeout(() => setBackdropUrl(url), 150);
  }, []);

  useEffect(() => {
    let mounted = true;

    getDisplayPreferences().then((preferences) => {
      if (mounted) {
        setDisplayPreferenceState(preferences);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(
    () => () => {
      if (backdropTimer.current) {
        clearTimeout(backdropTimer.current);
      }
    },
    [],
  );

  const filters = useMemo(
    () =>
      [
        filterUnwatched ? 'IsUnplayed' : null,
        filterFavorites ? 'IsFavorite' : null,
      ].filter(Boolean) as Array<'IsFavorite' | 'IsUnplayed'>,
    [filterFavorites, filterUnwatched],
  );

  const loadItems = useCallback(
    async (mounted = true) => {
      setLoading(true);
      setErrorText(null);

      try {
        const results = await getItems(
          serverProfile.serverUrl,
          serverProfile.accessToken,
          libraryId,
          serverProfile.userId,
          {
            filters,
            imageType: displayPreferences.imageType,
            includeItemTypes:
              libraryType === 'tvshows'
                ? 'Series'
                : libraryType === 'movies'
                ? 'Movie'
                : 'Movie,Series,Episode,Video',
            recursive:
              libraryType === 'tvshows' || libraryType === 'movies'
                ? false
                : true,
            sortBy,
            sortDescending,
          },
        );

        if (mounted) {
          setItems(results);
          setFocusedIndex(0);
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
    },
    [
      displayPreferences.imageType,
      filters,
      libraryId,
      libraryType,
      serverProfile,
      sortBy,
      sortDescending,
    ],
  );

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const saveDisplayPreferences = async (
    nextPreferences: DisplayPreferences,
  ) => {
    setDisplayPreferenceState(nextPreferences);
    await setDisplayPreferences(nextPreferences);
  };

  const cardScale = imageSizeScale[displayPreferences.imageSize];

  useTVEventHandler((event) => {
    if (event.eventKeyAction === 1) {
      return;
    }

    switch (event.eventType) {
      case 'menu':
      case 'context_menu':
        onMenuVisibleChange(!menuVisible);
        break;
      case 'back':
        if (menuVisible) {
          onMenuVisibleChange(false);
        }
        break;
    }
  });

  return (
    <View style={styles.screen} testID="library-screen">
      <FocusedBackdrop imageUrl={backdropUrl} />
      <View style={styles.header}>
        <Text style={styles.title}>{libraryName}</Text>
        <Text style={styles.countText}>
          {items.length ? `${focusedIndex + 1} | ${items.length}` : '0 | 0'}
        </Text>
      </View>
      {isLoading ? <Text style={styles.status}>Loading items...</Text> : null}
      {errorText ? <Text style={styles.error}>{errorText}</Text> : null}
      {errorText ? (
        <FocusableItem
          focusedStyle={styles.retryFocused}
          onPress={() => loadItems()}
          style={styles.retryButton}
          testID="library-retry-button">
          <Text style={styles.retryText}>Retry</Text>
        </FocusableItem>
      ) : null}
      {!isLoading && !errorText && items.length === 0 ? (
        <Text style={styles.status}>No playable items found.</Text>
      ) : null}
      <TVFocusGuideView style={styles.gridGuide}>
          <FlatList
            columnWrapperStyle={styles.gridRow}
            contentContainerStyle={styles.grid}
            data={items}
          horizontal={false}
            keyExtractor={(item) => item.id}
            key="vertical"
            numColumns={4}
          renderItem={({index, item}) => (
            <MediaCard
              hasTVPreferredFocus={index === 0}
              imageUrl={item.imageUrl}
              imageScale={cardScale}
              onFocus={() => {
                setFocusedIndex(index);
                queueBackdrop(item.backdropUrl ?? item.imageUrl);
              }}
              onPress={() => onSelectItem?.(item)}
              subtitle={
                item.productionYear
                  ? String(item.productionYear)
                  : item.type.toLowerCase()
              }
              title={item.name}
            />
          )}
        />
      </TVFocusGuideView>
      {menuVisible ? (
        <Panel
          onClose={() => onMenuVisibleChange(false)}
          title="Library options">
          <PreferenceRadioGroup
            options={sortOptions}
            selectedValue={sortBy}
            title="Sort by"
            onSelect={setSortBy}
            preferredFocusValue={sortBy}
          />
          <PreferenceRadioGroup
            options={sortOrderOptions}
            selectedValue={sortDescending}
            title="Sort order"
            onSelect={setSortDescending}
          />
          <PreferenceRadioGroup
            options={filterOptions}
            selectedValue={filterUnwatched}
            title="Filter"
            onSelect={setFilterUnwatched}
          />
          <PreferenceRadioGroup
            options={favoriteOptions}
            selectedValue={filterFavorites}
            title="Favorites"
            onSelect={setFilterFavorites}
          />
          <PreferenceRadioGroup
            options={imageSizeOptions}
            selectedValue={displayPreferences.imageSize}
            title="Display: Image size"
            onSelect={(imageSize) =>
              saveDisplayPreferences({...displayPreferences, imageSize})
            }
          />
          <PreferenceRadioGroup
            options={imageTypeOptions}
            selectedValue={displayPreferences.imageType}
            title="Display: Image type"
            onSelect={(imageType) =>
              saveDisplayPreferences({...displayPreferences, imageType})
            }
          />
        </Panel>
      ) : null}
    </View>
  );
};

const Panel = ({
  children,
  onClose,
  title,
}: React.PropsWithChildren<{onClose: () => void; title: string}>) => (
  <View style={styles.overlay}>
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{title}</Text>
      <TVFocusGuideView style={styles.panelActions}>{children}</TVFocusGuideView>
      <FocusableItem
        focusedStyle={styles.panelButtonFocused}
        onPress={onClose}
        style={styles.panelButton}
        testID="library-panel-close">
        <Text style={styles.panelButtonText}>Close</Text>
      </FocusableItem>
    </View>
  </View>
);

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0C1116',
    paddingHorizontal: 84,
    paddingTop: 64,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 30,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 58,
    fontWeight: '800',
    flex: 1,
  },
  countText: {
    color: '#B8C5CC',
    fontSize: 22,
    fontWeight: '700',
    minWidth: 96,
    textAlign: 'center',
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
    marginTop: 16,
  },
  retryFocused: {
    backgroundColor: '#315066',
  },
  retryText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
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
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.56)',
    paddingRight: 84,
    paddingTop: 122,
  },
  panel: {
    width: 780,
    borderRadius: 8,
    backgroundColor: '#111A21',
    borderColor: '#324555',
    borderWidth: 2,
    padding: 22,
  },
  panelTitle: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 16,
  },
  panelActions: {
    gap: 2,
  },
  panelGroupTitle: {
    color: '#9FB0BA',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
    marginTop: 12,
  },
  panelButton: {
    minHeight: 50,
    borderRadius: 8,
    backgroundColor: '#24313A',
    justifyContent: 'center',
    marginBottom: 10,
    paddingHorizontal: 14,
  },
  panelButtonFocused: {
    backgroundColor: '#2E5A72',
  },
  panelButtonText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
});
