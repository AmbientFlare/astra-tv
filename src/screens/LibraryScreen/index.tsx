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
  getItemsPage,
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
 * Items per library request. Asking for a whole library at once meant one
 * multi-megabyte response for a big collection, and parsing it on the JS
 * thread was long enough for the system to kill the app as unresponsive.
 */
const LIBRARY_PAGE_SIZE = 100;

/** Rows of cards left below focus at which the next page is fetched. */
const PAGE_AHEAD_ROWS = 4;

/** Cards per row, and the gap the grid styles put between rows. */
const GRID_COLUMNS = 3;
const GRID_ROW_GAP = 26;

/** Unscaled card height, from MediaCard's own style. */
const CARD_HEIGHT = 412;

/**
 * What a library grid looked like when it was last left. The navigation stack
 * renders only the current route, so opening an item unmounts LibraryScreen
 * and every piece of its state goes with it -- which is why backing out used
 * to land on the first card at the top of the list. Holding the session here,
 * outside the component, lets the remount draw the same grid at the same
 * place with the same card focused, and refresh behind it rather than behind
 * a spinner.
 *
 * Module-level rather than persisted: this is where the user was a moment
 * ago, not a preference, and it should not outlive the app.
 */
interface LibrarySession {
  items: JellyfinMediaItem[];
  /** Size of the whole library; `items` may hold only its first pages. */
  totalCount: number;
  itemDetails: Record<string, JellyfinMediaItem>;
  sortBy: JellyfinSortBy;
  sortDescending: boolean;
  filterUnwatched: boolean;
  filterFavorites: boolean;
  focusedIndex: number;
}

/** Keyed by library id. A handful of libraries at most. */
const librarySessions = new Map<string, LibrarySession>();

/** Enough for every library on a server, and a bound in case it is not. */
const LIBRARY_SESSION_LIMIT = 12;

/** Test seam: drops every remembered grid. */
export const resetLibrarySessions = () => {
  librarySessions.clear();
};

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
  // Populated when this library has been browsed already in this run of the
  // app; the screen then opens on the grid the user left instead of a
  // spinner. `key={libraryId}` in the navigator guarantees a remount per
  // library, so this is read once and stays the right session for this mount.
  const restored = useRef(librarySessions.get(libraryId)).current;

  const [items, setItems] = useState<JellyfinMediaItem[]>(
    restored?.items ?? [],
  );
  const [totalCount, setTotalCount] = useState(
    restored?.totalCount ?? restored?.items.length ?? 0,
  );
  const [isLoading, setLoading] = useState(!restored);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<JellyfinSortBy>(
    restored?.sortBy ?? 'name',
  );
  const [sortDescending, setSortDescending] = useState(
    restored?.sortDescending ?? false,
  );
  const [filterUnwatched, setFilterUnwatched] = useState(
    restored?.filterUnwatched ?? false,
  );
  const [filterFavorites, setFilterFavorites] = useState(
    restored?.filterFavorites ?? false,
  );
  const [focusedItem, setFocusedItem] = useState<JellyfinMediaItem | null>(
    restored ? restored.items[restored.focusedIndex] ?? null : null,
  );
  const [focusedIndex, setFocusedIndex] = useState(restored?.focusedIndex ?? 0);
  /**
   * The card to hand focus to when the grid first draws. Fixed for the life of
   * the mount: `hasTVPreferredFocus` is only read as a card appears, and the
   * background refresh must not move focus out from under the user.
   */
  const initialFocusIndex = useRef(restored?.focusedIndex ?? 0).current;
  /**
   * Cleared by the first load. While set, that load is a refresh of something
   * already on screen: no spinner, no reset to the top, and a failure leaves
   * the remembered grid up rather than replacing it with an error.
   */
  const refreshingRestoredRef = useRef(Boolean(restored));
  /**
   * Bumped by every full load, so a page that arrives after the sort or
   * filter changed is recognised as belonging to the old list and dropped.
   */
  const loadGenerationRef = useRef(0);
  const pageInFlightRef = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
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
  >(restored?.itemDetails ?? {});
  /** Ids already fetched or in flight, so a re-focus does not refetch. */
  const detailRequestsRef = useRef(
    new Set<string>(Object.keys(restored?.itemDetails ?? {})),
  );
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

  // Remember where this library was left, so the next mount can pick it up.
  // Written on every change rather than on unmount: the navigation stack
  // unmounts this screen without warning, and a cleanup that read stale
  // closure state would remember the wrong card.
  useEffect(() => {
    if (items.length === 0) {
      return;
    }

    librarySessions.set(libraryId, {
      filterFavorites,
      filterUnwatched,
      focusedIndex,
      itemDetails,
      items,
      sortBy,
      sortDescending,
      totalCount,
    });

    if (librarySessions.size > LIBRARY_SESSION_LIMIT) {
      const oldest = librarySessions.keys().next();
      if (!oldest.done) {
        librarySessions.delete(oldest.value);
      }
    }
  }, [
    filterFavorites,
    filterUnwatched,
    focusedIndex,
    itemDetails,
    items,
    libraryId,
    sortBy,
    sortDescending,
    totalCount,
  ]);

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
      // True only for the first load after a restore: the grid is already on
      // screen and this call is refreshing it in place.
      const refreshingRestored = refreshingRestoredRef.current;
      refreshingRestoredRef.current = false;
      loadGenerationRef.current += 1;
      const generation = loadGenerationRef.current;

      if (!refreshingRestored) {
        setLoading(true);
      }
      setErrorText(null);

      try {
        const page = await getItemsPage(
          serverProfile.serverUrl,
          serverProfile.accessToken,
          libraryId,
          serverProfile.userId,
          {
            filters,
            // A refresh re-fetches as far as the user had already scrolled, so
            // the remembered card is still in the list it comes back with.
            limit: refreshingRestored
              ? Math.max(LIBRARY_PAGE_SIZE, initialFocusIndex + 1)
              : LIBRARY_PAGE_SIZE,
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
            startIndex: 0,
          },
        );
        const results = page.items;

        if (mounted && generation === loadGenerationRef.current) {
          // A refresh keeps the user where they were, clamped in case the
          // library shrank while they were away. Any other load -- a sort or
          // filter change -- is a new list, and starts at the top.
          const index = refreshingRestored
            ? Math.min(initialFocusIndex, Math.max(results.length - 1, 0))
            : 0;

          setItems(results);
          setTotalCount(page.totalRecordCount);
          setFocusedIndex(index);
          setFocusedItem(results[index] ?? null);
          ensureDetails(detailPrefetchIds(results, index));
        }
      } catch (error) {
        // A failed refresh of a restored grid is silent: what is on screen is
        // a moment old and still true, and replacing it with an error message
        // would be a worse answer than the one already there.
        if (mounted && !refreshingRestored) {
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
      initialFocusIndex,
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

  /**
   * Appends the next page. One at a time, and only while the list it extends
   * is still the current one.
   */
  const loadNextPage = useCallback(async () => {
    const loaded = itemsRef.current.length;
    if (pageInFlightRef.current || isLoading || loaded >= totalCount) {
      return;
    }

    pageInFlightRef.current = true;
    const generation = loadGenerationRef.current;
    try {
      const page = await getItemsPage(
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
              : null,
          limit: LIBRARY_PAGE_SIZE,
          recursive: false,
          sortBy,
          sortDescending,
          startIndex: loaded,
        },
      );

      if (!mountedRef.current || generation !== loadGenerationRef.current) {
        return;
      }

      setItems((current) => {
        // Only extend the list this page was asked for. Ids already present
        // are skipped: an item added on the server between pages shifts the
        // next page by one, and a duplicate key would confuse the grid.
        if (current.length !== loaded) {
          return current;
        }
        const seen = new Set(current.map((item) => item.id));
        return current.concat(page.items.filter((item) => !seen.has(item.id)));
      });
      // A short page means the library ended early; trust what came back.
      setTotalCount(
        page.items.length < LIBRARY_PAGE_SIZE
          ? loaded + page.items.length
          : page.totalRecordCount,
      );
    } catch {
      // Left for the next focus move near the end to try again.
    } finally {
      pageInFlightRef.current = false;
    }
  }, [
    displayPreferences.imageType,
    filters,
    isLoading,
    libraryId,
    libraryType,
    serverProfile,
    sortBy,
    sortDescending,
    totalCount,
  ]);

  const saveDisplayPreferences = async (
    nextPreferences: DisplayPreferences,
  ) => {
    setDisplayPreferenceState(nextPreferences);
    await setDisplayPreferences(nextPreferences);
  };

  const cardScale = imageSizeScale[displayPreferences.imageSize];

  /**
   * Both of these are in ROWS, not items. FlatList hands `getItemLayout` and
   * `initialScrollIndex` straight to VirtualizedList, which -- once
   * numColumns is set -- counts one entry per row of cards. Measuring in
   * items instead lands the list at a fraction of the intended offset.
   *
   * Without them the list cannot scroll to a card it has not rendered yet,
   * which is exactly the case on a restore: the remembered card is usually
   * far below the first window.
   */
  const rowHeight = Math.round(CARD_HEIGHT * cardScale) + GRID_ROW_GAP;
  const getItemLayout = useCallback(
    (
      _data: ArrayLike<JellyfinMediaItem> | null | undefined,
      rowIndex: number,
    ) => ({
      index: rowIndex,
      length: rowHeight,
      offset: rowHeight * rowIndex,
    }),
    [rowHeight],
  );
  /**
   * Clamped so a library that lost items while the user was away still hands
   * focus to a card that exists rather than to none of them.
   */
  const preferredFocusIndex = Math.max(
    Math.min(initialFocusIndex, items.length - 1),
    0,
  );
  const initialScrollRow = Math.floor(preferredFocusIndex / GRID_COLUMNS);

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
              {items.length
                ? `${focusedIndex + 1} | ${Math.max(totalCount, items.length)}`
                : '0 | 0'}
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
              getItemLayout={getItemLayout}
              horizontal={false}
              initialScrollIndex={initialScrollRow || undefined}
              keyExtractor={(item) => item.id}
              key="vertical"
              numColumns={GRID_COLUMNS}
              onEndReached={() => loadNextPage()}
              onEndReachedThreshold={1}
              renderItem={({index, item}) => (
                <MediaCard
                  badgeText={
                    item.type === 'Series'
                      ? formatUnplayedBadge(item.unplayedItemCount)
                      : undefined
                  }
                  hasTVPreferredFocus={index === preferredFocusIndex}
                  imageUrl={item.imageUrl}
                  imageScale={cardScale}
                  onFocus={() => {
                    setFocusedIndex(index);
                    if (
                      index >=
                      items.length - GRID_COLUMNS * PAGE_AHEAD_ROWS
                    ) {
                      loadNextPage();
                    }
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
