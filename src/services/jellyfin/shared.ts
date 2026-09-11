import type {JellyfinMediaItem} from './types';
import {buildUrl, normalizeServerUrl, getJson, getAuthHeaders} from './http';

/**
 * Extra data to ask for alongside an item.
 *
 * Every entry must be a member of the server's ItemFields enum: the parameter
 * is bound as an enum array, so one unrecognised name rejects the whole
 * request rather than being ignored. Ratings, production year and user data
 * are plain item properties that come back on their own and must NOT be
 * listed here — asking for them by name is what breaks the request.
 */
export const itemFields =
  'Overview,Genres,People,MediaSources,ProviderIds,RecursiveItemCount,ChildCount,MediaStreams,Chapters,PrimaryImageAspectRatio,RemoteTrailers';

export const mapItem = (
  baseUrl: string,
  accessToken: string,
  item: {
    Id?: string;
    Name?: string;
    Type?: string;
    MediaType?: string;
    MediaSources?: Array<{
      MediaStreams?: Array<{
        BitRate?: number;
        Channels?: number;
        Codec?: string;
        DisplayTitle?: string;
        Height?: number;
        Index?: number;
        IsDefault?: boolean;
        Language?: string;
        Type?: string;
        VideoRangeType?: string;
        Width?: number;
      }>;
    }>;
    ProductionYear?: number;
    PremiereDate?: string;
    ImageTags?: {Banner?: string; Primary?: string; Thumb?: string};
    BackdropImageTags?: string[];
    ChildCount?: number;
    Chapters?: Array<{Name?: string; StartPositionTicks?: number}>;
    IsFolder?: boolean;
    LocationType?: string;
    RunTimeTicks?: number;
    UserData?: {
      IsFavorite?: boolean;
      Played?: boolean;
      PlayCount?: number;
      PlaybackPositionTicks?: number;
      UnplayedItemCount?: number;
    };
    Overview?: string;
    Genres?: string[];
    People?: Array<{Id?: string; Name?: string; Role?: string; Type?: string}>;
    CommunityRating?: number;
    CriticRating?: number;
    OfficialRating?: string;
    ParentId?: string;
    IndexNumber?: number;
    ParentIndexNumber?: number;
    RecursiveItemCount?: number;
    RemoteTrailers?: Array<{Name?: string; Url?: string}>;
    SeriesId?: string;
    SeriesName?: string;
  },
  imageType: 'Primary' | 'Thumb' | 'Banner' = 'Primary',
): JellyfinMediaItem => ({
  id: item.Id ?? item.Name ?? '',
  name: item.Name ?? 'Untitled',
  type: item.Type ?? 'Media',
  backdropImageTags: item.BackdropImageTags ?? [],
  childCount: item.ChildCount ?? null,
  isFolder: item.IsFolder,
  locationType: item.LocationType,
  mediaSources: item.MediaSources ?? [],
  mediaType: item.MediaType,
  mediaStreams: item.MediaSources?.[0]?.MediaStreams?.map((stream) => ({
    // bitRate and videoRangeType feed the decoder-risk classifier, which runs
    // before PlaybackInfo is requested and so cannot use the stream info.
    bitRate: stream.BitRate,
    channels: stream.Channels,
    codec: stream.Codec,
    displayTitle: stream.DisplayTitle,
    height: stream.Height,
    index: stream.Index,
    isDefault: stream.IsDefault,
    language: stream.Language,
    type: stream.Type,
    videoRangeType: stream.VideoRangeType,
    width: stream.Width,
  })),
  productionYear: item.ProductionYear,
  premiereDate: item.PremiereDate,
  chapters: item.Chapters?.map((chapter, index) => ({
    name: chapter.Name ?? `Chapter ${index + 1}`,
    startPositionTicks: chapter.StartPositionTicks ?? 0,
  })),
  imageUrl: item.Id
    ? buildUrl(baseUrl, `/Items/${item.Id}/Images/${imageType}`, {
        fillWidth: 360,
        quality: 90,
        tag: item.ImageTags?.[imageType],
        ApiKey: accessToken,
      })
    : undefined,
  backdropUrl:
    item.Id && item.BackdropImageTags?.[0]
      ? buildUrl(baseUrl, `/Items/${item.Id}/Images/Backdrop/0`, {
          fillWidth: 1280,
          quality: 85,
          tag: item.BackdropImageTags[0],
          ApiKey: accessToken,
        })
      : undefined,
  runTimeTicks: item.RunTimeTicks,
  resumePositionTicks: item.UserData?.PlaybackPositionTicks,
  isFavorite: item.UserData?.IsFavorite,
  isPlayed: item.UserData?.Played,
  unplayedItemCount: item.UserData?.UnplayedItemCount,
  overview: item.Overview ?? null,
  genres: item.Genres ?? [],
  people: (item.People ?? []).map((person) => ({
    Id: person.Id,
    Name: person.Name ?? 'Unknown',
    Role: person.Role,
    Type: person.Type,
    id: person.Id,
    imageUrl: person.Id
      ? buildUrl(baseUrl, `/Items/${person.Id}/Images/Primary`, {
          fillWidth: 260,
          quality: 85,
          ApiKey: accessToken,
        })
      : undefined,
    name: person.Name ?? 'Unknown',
    role: person.Role,
    type: person.Type,
  })),
  remoteTrailers: item.RemoteTrailers?.flatMap((trailer) =>
    trailer.Url ? [{name: trailer.Name, url: trailer.Url}] : [],
  ),
  communityRating: item.CommunityRating ?? null,
  criticsRating: item.CriticRating,
  officialRating: item.OfficialRating ?? null,
  parentId: item.ParentId,
  indexNumber: item.IndexNumber,
  parentIndexNumber: item.ParentIndexNumber,
  recursiveItemCount: item.RecursiveItemCount ?? null,
  seriesId: item.SeriesId,
  seriesName: item.SeriesName,
});

export const getItemCollection = async (
  serverUrl: string,
  accessToken: string,
  path: string,
  params: Record<string, string | number | boolean | undefined>,
): Promise<JellyfinMediaItem[]> => {
  const baseUrl = normalizeServerUrl(serverUrl);
  const response = await getJson<{
    Items?: Array<Parameters<typeof mapItem>[2]>;
  }>(buildUrl(baseUrl, path, {...params, ApiKey: accessToken}), {
    headers: getAuthHeaders(accessToken),
  });

  return (response.Items ?? []).map((item) =>
    mapItem(baseUrl, accessToken, item),
  );
};
