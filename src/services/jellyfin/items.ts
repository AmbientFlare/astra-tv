import type {
  JellyfinLibrary,
  JellyfinSortBy,
  GetItemsOptions,
  JellyfinMediaItem,
  JellyfinMediaSource,
  JellyfinMediaSegment,
  JellyfinPerson,
} from './types';
import {
  normalizeServerUrl,
  getJson,
  buildUrl,
  getAuthHeaders,
  ServerResponseError,
} from './http';
import {mapItem, getItemCollection, itemFields} from './shared';

export const CHILD_ITEMS_RETRY_MS = 1200;

/** Maximum automatic re-requests before a screen offers a manual Retry. */
export const CHILD_ITEMS_MAX_RETRIES = 2;

/**
 * True when a series' season list looks like the server has not finished
 * building it. Some servers materialise a season/episode tree during the
 * first browse, so the honest answer to "no seasons yet" is to ask again
 * rather than to show a dead end.
 */
export const isIncompleteSeasonList = (
  seasons: Array<{childCount?: number | null}>,
) =>
  seasons.length === 0 ||
  (seasons.length === 1 &&
    (seasons[0].childCount === 0 || seasons[0].childCount === null));

/**
 * What a library grid needs to draw its cards and fill the first pass of the
 * info panel. The fields left out are the ones that make a whole-library
 * request expensive:
 *
 *   People        the server joins cast and crew per item; measured at 2.5s
 *                 of a 2.7s 90-movie request, and 93% of the wait
 *   MediaSources  cheap on the server, but 0.8MB of the 2MB the device then
 *   MediaStreams  has to pull over wifi and parse -- another 0.7MB
 *   Chapters      0.2MB, and a grid card never shows one
 *
 * None of them are per-card data: they belong to whichever single item has
 * focus, so `getItemDetails` fetches them one at a time instead. The same
 * split exists in jellyfin-androidtv (ItemRepository.browseFields) and
 * jellyfin-web, whose grid requests carry little more than the aspect ratio.
 */
export const browseItemFields =
  'Overview,Genres,RecursiveItemCount,ChildCount,PrimaryImageAspectRatio';

export const getLibraries = async (
  serverUrl: string,
  accessToken: string,
  userId: string,
): Promise<JellyfinLibrary[]> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  // /Library/MediaFolders requires admin; per-user views honor library access.
  const response = await getJson<{
    Items?: Array<{
      Id?: string;
      Name?: string;
      CollectionType?: string;
      Type?: string;
    }>;
  }>(buildUrl(baseUrl, '/UserViews', {userId}), {
    headers: getAuthHeaders(accessToken),
  });

  return (response.Items ?? [])
    .filter((library) => library.CollectionType !== 'playlists')
    .map((library) => ({
      id: library.Id ?? library.Name ?? '',
      imageUrl: library.Id
        ? buildUrl(baseUrl, `/Items/${library.Id}/Images/Primary`, {
            fillWidth: 520,
            quality: 90,
            api_key: accessToken,
          })
        : undefined,
      name: library.Name ?? 'Library',
      type: library.CollectionType ?? library.Type,
    }));
};

const sortByMap: Record<JellyfinSortBy, string> = {
  dateAdded: 'DateCreated',
  name: 'SortName',
  rating: 'CommunityRating',
  releaseDate: 'PremiereDate',
};

export const getItems = async (
  serverUrl: string,
  accessToken: string,
  libraryId: string,
  userId?: string,
  options: GetItemsOptions = {},
): Promise<JellyfinMediaItem[]> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const itemsPath = userId ? `/Users/${userId}/Items` : '/Items';
  const response = await getJson<{
    Items?: Array<{
      Id?: string;
      Name?: string;
      Type?: string;
      MediaType?: string;
      ProductionYear?: number;
      ImageTags?: {Banner?: string; Primary?: string; Thumb?: string};
      BackdropImageTags?: string[];
      ChildCount?: number;
      IsFolder?: boolean;
      LocationType?: string;
      MediaSources?: JellyfinMediaSource[];
      RunTimeTicks?: number;
      UserData?: {PlaybackPositionTicks?: number};
      Overview?: string;
      Genres?: string[];
      People?: Array<{
        Id?: string;
        Name?: string;
        Role?: string;
        Type?: string;
      }>;
      CommunityRating?: number;
      CriticRating?: number;
      OfficialRating?: string;
      ParentId?: string;
      IndexNumber?: number;
      ParentIndexNumber?: number;
      RecursiveItemCount?: number;
      SeriesId?: string;
      SeriesName?: string;
    }>;
  }>(
    buildUrl(baseUrl, itemsPath, {
      ParentId: libraryId,
      Recursive: options.recursive ?? true,
      IncludeItemTypes:
        options.includeItemTypes === null
          ? undefined
          : options.includeItemTypes ?? 'Movie,Series,Episode,Video',
      Fields: browseItemFields,
      ImageTypeLimit: 1,
      EnableImageTypes: `${options.imageType ?? 'Primary'},Backdrop`,
      Filters: options.filters?.join(','),
      SortBy: sortByMap[options.sortBy ?? 'name'],
      SortOrder: options.sortDescending ? 'Descending' : 'Ascending',
      api_key: accessToken,
    }),
    {
      headers: getAuthHeaders(accessToken),
    },
  );

  return (response.Items ?? []).map((item) =>
    mapItem(baseUrl, accessToken, item, options.imageType ?? 'Primary'),
  );
};

/**
 * The item's credits segments. Servers before 10.10 have no such endpoint
 * and answer 404, which simply means the server knows of no credits.
 */
export const getMediaSegments = async (
  serverUrl: string,
  accessToken: string,
  itemId: string,
): Promise<JellyfinMediaSegment[]> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  let response: {
    Items?: Array<{
      EndTicks?: number;
      Id?: string;
      StartTicks?: number;
      Type?: string;
    }>;
  };

  try {
    response = await getJson(
      buildUrl(baseUrl, `/MediaSegments/${itemId}`, {
        IncludeSegmentTypes: 'Outro',
        api_key: accessToken,
      }),
      {headers: getAuthHeaders(accessToken)},
    );
  } catch (error) {
    if (error instanceof ServerResponseError && error.status === 404) {
      return [];
    }
    throw error;
  }

  return (response?.Items ?? []).flatMap((segment) =>
    typeof segment.StartTicks === 'number' &&
    typeof segment.EndTicks === 'number' &&
    segment.EndTicks > segment.StartTicks
      ? [
          {
            endTicks: segment.EndTicks,
            id: segment.Id,
            startTicks: segment.StartTicks,
            type: segment.Type ?? '',
          },
        ]
      : [],
  );
};

export const getPerson = async (
  serverUrl: string,
  accessToken: string,
  personId: string,
  personName?: string,
): Promise<JellyfinPerson> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const personKey = personName || personId;
  const person = await getJson<{
    DateCreated?: string;
    Id?: string;
    Name?: string;
    Overview?: string;
    PremiereDate?: string;
    UserData?: {IsFavorite?: boolean};
  }>(buildUrl(baseUrl, `/Persons/${personKey}`, {api_key: accessToken}), {
    headers: getAuthHeaders(accessToken),
  });
  const resolvedId = person.Id ?? personId;

  return {
    birthDate: person.PremiereDate ?? person.DateCreated,
    id: resolvedId,
    imageUrl: buildUrl(baseUrl, `/Items/${resolvedId}/Images/Primary`, {
      fillWidth: 420,
      quality: 90,
      api_key: accessToken,
    }),
    isFavorite: person.UserData?.IsFavorite,
    name: person.Name ?? personName ?? 'Unknown',
    overview: person.Overview,
  };
};

export const getItemsByPerson = (
  serverUrl: string,
  accessToken: string,
  userId: string,
  personId: string,
) =>
  getItemCollection(serverUrl, accessToken, `/Users/${userId}/Items`, {
    PersonIds: personId,
    Recursive: true,
    IncludeItemTypes: 'Movie,Series,Episode',
    Fields: itemFields,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Backdrop',
    Limit: 80,
  });

export const searchItems = (
  serverUrl: string,
  accessToken: string,
  userId: string,
  searchTerm: string,
) =>
  getItemCollection(serverUrl, accessToken, `/Users/${userId}/Items`, {
    SearchTerm: searchTerm,
    Recursive: true,
    IncludeItemTypes: 'Movie,Series,Episode',
    Fields: itemFields,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Backdrop',
    Limit: 60,
  });

export const getItemDetails = async (
  serverUrl: string,
  accessToken: string,
  userId: string,
  itemId: string,
) => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const item = await getJson<Parameters<typeof mapItem>[2]>(
    buildUrl(baseUrl, `/Users/${userId}/Items/${itemId}`, {
      Fields: itemFields,
      api_key: accessToken,
    }),
    {
      headers: getAuthHeaders(accessToken),
    },
  );

  return mapItem(baseUrl, accessToken, item);
};
