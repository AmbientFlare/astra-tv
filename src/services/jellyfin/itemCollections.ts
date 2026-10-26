import {getItemCollection, itemFields, mapItem} from './shared';
import type {JellyfinMediaItem} from './types';
import {normalizeServerUrl, getJson, buildUrl, getAuthHeaders} from './http';

export const getResumeItems = (
  serverUrl: string,
  accessToken: string,
  userId: string,
) =>
  getItemCollection(serverUrl, accessToken, `/Users/${userId}/Items/Resume`, {
    MediaTypes: 'Video',
    IncludeItemTypes: 'Movie,Episode',
    Fields: itemFields,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Backdrop',
    Limit: 24,
  });

/**
 * Next Up, with how many episodes of each season are still unwatched so the
 * viewer can tell whether another episode finishes the season. The counts
 * come from one request for the seasons; if it fails the row still loads.
 */
export const getNextUp = async (
  serverUrl: string,
  accessToken: string,
  userId: string,
): Promise<JellyfinMediaItem[]> => {
  const episodes = await getItemCollection(
    serverUrl,
    accessToken,
    '/Shows/NextUp',
    {
      UserId: userId,
      Fields: itemFields,
      ImageTypeLimit: 1,
      EnableImageTypes: 'Primary,Backdrop',
      Limit: 24,
    },
  );
  const seasonIds = [
    ...new Set(episodes.flatMap((episode) => episode.seasonId ?? [])),
  ];

  // An empty Ids filter is ignored by the server, which then returns the
  // user's root folders instead of nothing.
  if (seasonIds.length === 0) {
    return episodes;
  }

  try {
    const seasons = await getItemCollection(
      serverUrl,
      accessToken,
      `/Users/${userId}/Items`,
      {Ids: seasonIds.join(','), EnableImages: false},
    );
    const unplayedBySeason = new Map(
      seasons.map((season) => [season.id, season.unplayedItemCount]),
    );

    return episodes.map((episode) =>
      episode.seasonId && unplayedBySeason.has(episode.seasonId)
        ? {
            ...episode,
            seasonUnplayedCount: unplayedBySeason.get(episode.seasonId),
          }
        : episode,
    );
  } catch {
    return episodes;
  }
};

/**
 * The item's neighbours in series order: the server returns the previous
 * episode, the episode itself and the next one, across season boundaries.
 * A caller picks the one after `episodeId`.
 */
export const getAdjacentEpisodes = (
  serverUrl: string,
  accessToken: string,
  userId: string,
  seriesId: string,
  episodeId: string,
) =>
  getItemCollection(serverUrl, accessToken, `/Shows/${seriesId}/Episodes`, {
    UserId: userId,
    AdjacentTo: episodeId,
    Fields: itemFields,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Backdrop',
  });

export const getLatestItems = async (
  serverUrl: string,
  accessToken: string,
  userId: string,
  includeItemTypes: string,
): Promise<JellyfinMediaItem[]> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await getJson<Array<Parameters<typeof mapItem>[2]>>(
    buildUrl(baseUrl, `/Users/${userId}/Items/Latest`, {
      IncludeItemTypes: includeItemTypes,
      Fields: itemFields,
      ImageTypeLimit: 1,
      EnableImageTypes: 'Primary,Backdrop',
      Limit: 24,
      api_key: accessToken,
    }),
    {
      headers: getAuthHeaders(accessToken),
    },
  );

  return response.map((item) => mapItem(baseUrl, accessToken, item));
};

export const getSimilarItems = (
  serverUrl: string,
  accessToken: string,
  itemId: string,
  userId: string,
) =>
  getItemCollection(serverUrl, accessToken, `/Items/${itemId}/Similar`, {
    UserId: userId,
    Fields: itemFields,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Backdrop',
    Limit: 24,
  });

export const getSeasons = (
  serverUrl: string,
  accessToken: string,
  userId: string,
  seriesId: string,
) =>
  getItemCollection(serverUrl, accessToken, `/Shows/${seriesId}/Seasons`, {
    UserId: userId,
    Fields: itemFields,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Backdrop',
  });

/**
 * Omitting seasonId asks for every episode in the series, which is the only
 * way to reach the episodes of a series whose season list has not been built.
 */
export const getEpisodes = (
  serverUrl: string,
  accessToken: string,
  userId: string,
  seriesId: string,
  seasonId?: string,
) =>
  getItemCollection(serverUrl, accessToken, `/Shows/${seriesId}/Episodes`, {
    UserId: userId,
    SeasonId: seasonId,
    Fields: itemFields,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Backdrop',
  });

/**
 * The newest items inside one view. Lets the home screen surface a library
 * the server only just started returning, without the app knowing its name.
 */
export const getLatestItemsInLibrary = (
  serverUrl: string,
  accessToken: string,
  userId: string,
  libraryId: string,
) =>
  getItemCollection(serverUrl, accessToken, `/Users/${userId}/Items`, {
    ParentId: libraryId,
    Recursive: true,
    IsFolder: false,
    SortBy: 'DateCreated',
    SortOrder: 'Descending',
    Fields: itemFields,
    ImageTypeLimit: 1,
    EnableImageTypes: 'Primary,Backdrop',
    Limit: 24,
  });
