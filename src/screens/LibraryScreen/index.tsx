import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {FlatList, StyleSheet, Text, View} from 'react-native';
import {
  TVFocusGuideView,
  useTVEventHandler,
} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {FocusedBackdrop} from '../../components/FocusedBackdrop';
import {LibraryInfoPanel} from '../../components/LibraryInfoPanel';
import {LoadingOrError} from '../../components/LoadingOrError';
import {formatUnplayedBadge, MediaCard} from '../../components/MediaCard';
import {PreferenceRadioGroup} from '../../components/PreferenceRadioGroup';
import {
  getItemDetails,
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

/**
 * How far either side of the focused card to fetch details ahead of focus.
 * Two rows in each direction: enough that walking the grid at D-pad speed
 * lands on something already fetched, and small enough that scrolling the
 * length of a library does not queue hundreds of requests.
 */
const DETAIL_PREFETCH_RADIUS = 6;

/**
 * Upper bound on cached per-item details. Each is roughly 10KB, so this is a
 * couple of megabytes at worst; entries are evicted in insertion order.
 */
const DETAIL_CACHE_LIMIT = 240;

/**
 * Item ids to fill in around a focused card: the card itself first, then its
 * neighbours outward, forward before backward. Whichever way focus moves
 * next, the nearest cards are the ones already fetched, and the panel is
 * complete by the time it is looked at.
 */
export const detailPrefetchIds = (
  items: JellyfinMediaItem[],
  index: number,
) => {
  const ids: string[] = [];
  const add = (at: number) => {
    const item = items[at];
    if (item) {
      ids.push(item.id);
    }
  };

  add(index);
  for (let offset = 1; offset <= DETAIL_PREFETCH_RADIUS; offset += 1) {
    add(index + offset);
    add(index - offset);
  }

  return ids;
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
  const [focusedItem, setFocusedItem] = useState<JellyfinMediaItem | null>(
    null,
  );
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [backdropUrl, setBackdropUrl] = useState<string | null>(null);
  const [displayPreferences, setDisplayPreferenceState] =
    useState<DisplayPreferences>({
      imageSize: 'medium',
      imageType: 'Primary',
    });
  /**
   * The heavy half of an item, keyed by item id, filled in as focus settles.
   * The grid request deliberately does not carry cast, media sources or
   * chapters (see browseItemFields), so the info panel renders what the grid
   * knows first and this fills the rest in a moment later.
   */
  const [itemDetails, setItemDetails] = useState<
    Record<string, JellyfinMediaItem>
  >({});
  /** Ids already fetched or in flight, so a re-focus does not refetch. */
  const detailRequestsRef = useRef(new Set<string>());
  const backdropTimer = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const focusDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const queueBackdrop = useCallback((url?: string) => {
    if (!url) {
      return;
    }

    if (backdropTimer.current) {
      clearTimeout(backdropTimer.current);
    }

    backdropTimer.current = setTimeout(() => {
      backdropTimer.current = null;
      if (!mountedRef.current) {
        return;
      }
      setBackdropUrl(url);
    }, 150);
  }, []);

  /**
   * Fetches the full item for `ids` that have not been asked for yet, in the
   * order given, so the focused card is filled before its neighbours. Runs
   * sequentially: a Fire TV walking a grid should not have a dozen requests
   * in flight, and each one is small enough that serialising them still
   * finishes well inside the time it takes to move focus another two rows.
   *
   * A failure is recorded as attempted rather than retried. The panel keeps
   * showing what the grid already gave it, which is the same thing it shows
   * while the request is still running.
   */
  const ensureDetails = useCallback(
    async (ids: string[]) => {
      for (const id of ids) {
        if (!mountedRef.current) {
          return;
        }
        if (detailRequestsRef.current.has(id)) {
          continue;
        }
        detailRequestsRef.current.add(id);

        try {
          const detail = await getItemDetails(
            serverProfile.serverUrl,
            serverProfile.accessToken,
            serverProfile.userId,
            id,
          );

          if (!mountedRef.current) {
            return;
          }

          setItemDetails((current) => {
            const next = {...current, [id]: detail};
            const keys = Object.keys(next);
            if (keys.length > DETAIL_CACHE_LIMIT) {
              for (const stale of keys.slice(
                0,
                keys.length - DETAIL_CACHE_LIMIT,
              )) {
                delete next[stale];
                detailRequestsRef.current.delete(stale);
              }
            }
            return next;
          });
        } catch (error) {
          // Nothing to show the user: the card and the panel's first pass
          // are already on screen and stay correct without this.
        }
      }
    },
    [serverProfile],
  );

  useEffect(() => {
    let mounted = true;

    getDisplayPreferences().then((preferences) => {
      if (mounted) {
        const legacyPreferences = preferences as DisplayPreferences & {
          displayMode?: string;
        };
        if (legacyPreferences.displayMode === 'horizontal') {
          const nextPreferences = {...legacyPreferences};
          delete nextPreferences.displayMode;
          setDisplayPreferenceState(nextPreferences);
          setDisplayPreferences(nextPreferences).catch(() => undefined);
          return;
        }

        setDisplayPreferenceState(preferences);
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      if (backdropTimer.current) {
        clearTimeout(backdropTimer.current);
        backdropTimer.current = null;
      }
      if (focusDebounceRef.current) {
        clearTimeout(focusDebounceRef.current);
        focusDebounceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!focusedItem && items.length > 0) {
      setFocusedItem(items[0]);
    }
  }, [focusedItem, items]);

  // Details are keyed by item id and stay valid across sort and filter
  // changes, but a different library is a different set of ids: drop them
  // rather than let the cache grow across every library visited.
  useEffect(() => {
    detailRequestsRef.current = new Set();
    setItemDetails({});
  }, [libraryId]);

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
            // A view whose CollectionType we do not recognise is browsed at
            // its top level with no type filter, so whatever the server
            // chose to put there is what the grid shows.
            includeItemTypes:
              libraryType === 'tvshows'
                ? 'Series'
                : libraryType === 'movies'
                ? 'Movie'
                : null,
            recursive: false,
            sortBy,
            sortDescending,
          },
        );

        if (mounted) {
          setItems(results);
          setFocusedIndex(0);
          setFocusedItem(results[0] ?? null);
          ensureDetails(detailPrefetchIds(results, 0));
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
      ensureDetails,
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

  const handleCardFocus = (item: JellyfinMediaItem, index: number) => {
    if (focusDebounceRef.current) {
      clearTimeout(focusDebounceRef.current);
    }
    focusDebounceRef.current = setTimeout(() => {
      focusDebounceRef.current = null;
      if (mountedRef.current) {
        setFocusedItem(item);
        // Deliberately on the settle rather than on every focus change: a
        // fast scroll should queue one window of requests, not one per card
        // it passes through.
        ensureDetails(detailPrefetchIds(items, index));
      }
    }, 150);
  };

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
      <View style={styles.contentRow}>
        <View style={styles.leftPane}>
          <View style={styles.header}>
            <Text style={styles.title}>{libraryName}</Text>
            <Text style={styles.countText}>
              {items.length ? `${focusedIndex + 1} | ${items.length}` : '0 | 0'}
            </Text>
          </View>
          <LoadingOrError
            emptyText="Nothing here yet. The server may still be filling this library."
            errorText={errorText}
            isEmpty={items.length === 0}
            isLoading={isLoading}
            loadingText="Loading items..."
            onRetry={() => loadItems()}
            testID="library-status"
          />
          <TVFocusGuideView style={styles.gridGuide}>
            <FlatList
              columnWrapperStyle={styles.gridRow}
              contentContainerStyle={styles.grid}
              data={items}
              horizontal={false}
              keyExtractor={(item) => item.id}
              key="vertical"
              numColumns={3}
              renderItem={({index, item}) => (
                <MediaCard
                  badgeText={
                    item.type === 'Series'
                      ? formatUnplayedBadge(item.unplayedItemCount)
                      : undefined
                  }
                  hasTVPreferredFocus={index === 0}
                  imageUrl={item.imageUrl}
                  imageScale={cardScale}
                  onFocus={() => {
                    setFocusedIndex(index);
                    handleCardFocus(item, index);
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
        </View>
        <View style={styles.rightPane}>
          <LibraryInfoPanel
            accessToken={serverProfile.accessToken}
            item={
              focusedItem ? itemDetails[focusedItem.id] ?? focusedItem : null
            }
            serverUrl={serverProfile.serverUrl}
          />
        </View>
      </View>
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
      <TVFocusGuideView style={styles.panelActions}>
        {children}
      </TVFocusGuideView>
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
    paddingLeft: 84,
    paddingRight: 64,
    paddingTop: 64,
  },
  contentRow: {
    flex: 1,
    flexDirection: 'row',
  },
  leftPane: {
    flex: 1,
    width: '58%',
  },
  rightPane: {
    width: '42%',
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
