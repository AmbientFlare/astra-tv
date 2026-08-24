/**
 * Jellyfin music API.
 *
 * Kept separate from the video surface in ./index.ts, which is already large
 * and whose helpers (device profiles, HLS transcode decisions, playback
 * reporting) mostly do not apply to audio.
 *
 * Three findings from the 2026-07-27 device spike shape this module:
 *
 * 1. HTTPS audio should be direct played. Sending a native container list
 *    makes Jellyfin serve the original file, which is fully seekable.
 * 2. Cleartext HTTP audio must use HLS so Shaka fetches it in JavaScript;
 *    Vega's native AudioPlayer fetch path rejects cleartext media.
 * 3. Libraries are large (11.5k tracks observed), so every list endpoint here
 *    is paginated and returns a total count for infinite scroll.
 */
import {buildUrl, getAuthHeaders, getJson, itemFields} from './index';

export interface MusicSession {
  accessToken: string;
  serverUrl: string;
  userId: string;
}

export interface MusicArtist {
  id: string;
  name: string;
  imageUrl?: string;
  backdropUrl?: string;
  albumCount?: number;
  overview?: string | null;
  isFavorite?: boolean;
}

export interface MusicAlbum {
  id: string;
  name: string;
  albumArtist?: string;
  albumArtistId?: string;
  imageUrl?: string;
  productionYear?: number;
  trackCount?: number;
  runTimeTicks?: number;
  genres?: string[];
  isFavorite?: boolean;
}

export interface MusicTrack {
  id: string;
  name: string;
  albumId?: string;
  albumName?: string;
  artistName?: string;
  artistId?: string;
  imageUrl?: string;
  indexNumber?: number;
  parentIndexNumber?: number;
  runTimeTicks?: number;
  playCount?: number;
  communityRating?: number | null;
  isFavorite?: boolean;
  container?: string;
  bitrate?: number;
}

export interface MusicGenre {
  id: string;
  name: string;
  imageUrl?: string;
}

export interface MusicPlaylist {
  id: string;
  name: string;
  imageUrl?: string;
  trackCount?: number;
  runTimeTicks?: number;
}

/** A page of results plus the server's total, so lists know when to stop. */
export interface Page<Item> {
  items: Item[];
  startIndex: number;
  totalCount: number;
}

export interface PageOptions {
  limit?: number;
  /** Filter to entries whose sort name begins with this, for the A-Z rail. */
  nameStartsWith?: string;
  /** Jellyfin's own bucket for "everything not starting with a letter". */
  nameLessThan?: string;
  sortBy?: string;
  sortDescending?: boolean;
  startIndex?: number;
}

export const DEFAULT_PAGE_SIZE = 60;

/**
 * Containers the Vega AudioPlayer handles natively. Sending this list is what
 * makes Jellyfin hand back the original file instead of transcoding.
 * Library composition observed 2026-07-27: 98.3% mp3, 1.4% m4a, ~0.3% other.
 */
export const NATIVE_AUDIO_CONTAINERS =
  'mp3,m4a,aac,flac,alac,ogg,opus,wav,webma,mp4';

// Same rule as itemFields: enum members only. ProductionYear and UserData
// arrive as ordinary item properties.
export const musicItemFields =
  'Genres,MediaSources,ParentId,PrimaryImageAspectRatio,ChildCount';

interface RawItem {
  Album?: string;
  AlbumArtist?: string;
  AlbumArtists?: Array<{Id?: string; Name?: string}>;
  AlbumId?: string;
  AlbumPrimaryImageTag?: string;
  ArtistItems?: Array<{Id?: string; Name?: string}>;
  Artists?: string[];
  BackdropImageTags?: string[];
  ChildCount?: number;
  CommunityRating?: number;
  Genres?: string[];
  Id?: string;
  ImageTags?: {Primary?: string};
  IndexNumber?: number;
  MediaSources?: Array<{Bitrate?: number; Container?: string}>;
  Name?: string;
  Overview?: string;
  ParentIndexNumber?: number;
  ProductionYear?: number;
  RunTimeTicks?: number;
  UserData?: {IsFavorite?: boolean; PlayCount?: number};
}

interface RawPage {
  Items?: RawItem[];
  TotalRecordCount?: number;
}

/**
 * Album/artist art at a size appropriate for a grid. Deliberately small — a
 * windowed list only ever shows ~20 at a time, and there is no filesystem API
 * on Vega to cache larger ones.
 */
const imageUrlFor = (
  session: MusicSession,
  itemId: string | undefined,
  fillWidth: number,
  tag?: string,
) =>
  itemId
    ? buildUrl(session.serverUrl, `/Items/${itemId}/Images/Primary`, {
        fillWidth,
        quality: 90,
        tag,
        api_key: session.accessToken,
      })
    : undefined;

const request = <Body>(session: MusicSession, path: string, params = {}) =>
  getJson<Body>(
    buildUrl(session.serverUrl, path, {
      ...params,
      api_key: session.accessToken,
    }),
    {headers: getAuthHeaders(session.accessToken)},
  );

/**
 * Jellyfin silently ignores a filter with an empty value: `AlbumArtistIds=`
 * returns the whole library rather than nothing — verified against a live
 * server, 821 albums and 11,547 tracks came back. Every id-scoped query must
 * refuse an empty id, otherwise "play everything by this artist" would quietly
 * queue the entire collection.
 */
const requireId = (id: string | undefined, what: string) => {
  if (!id || !id.trim()) {
    throw new Error(`Cannot load music: missing ${what} id.`);
  }

  return id;
};

const pageParams = (options: PageOptions, defaultSortBy: string) => ({
  Limit: options.limit ?? DEFAULT_PAGE_SIZE,
  NameLessThan: options.nameLessThan,
  NameStartsWith: options.nameStartsWith,
  SortBy: options.sortBy ?? defaultSortBy,
  SortOrder: options.sortDescending ? 'Descending' : 'Ascending',
  StartIndex: options.startIndex ?? 0,
});

const toPage = <Item>(
  raw: RawPage,
  options: PageOptions,
  map: (item: RawItem) => Item,
): Page<Item> => ({
  items: (raw.Items ?? []).map(map),
  startIndex: options.startIndex ?? 0,
  totalCount: raw.TotalRecordCount ?? (raw.Items ?? []).length,
});

// ---------------------------------------------------------------- mappers

const mapArtist =
  (session: MusicSession) =>
  (item: RawItem): MusicArtist => ({
    id: item.Id ?? '',
    name: item.Name ?? 'Unknown Artist',
    imageUrl: imageUrlFor(session, item.Id, 400, item.ImageTags?.Primary),
    backdropUrl:
      item.Id && item.BackdropImageTags?.[0]
        ? buildUrl(session.serverUrl, `/Items/${item.Id}/Images/Backdrop/0`, {
            fillWidth: 1280,
            quality: 85,
            api_key: session.accessToken,
          })
        : undefined,
    albumCount: item.ChildCount,
    overview: item.Overview ?? null,
    isFavorite: item.UserData?.IsFavorite,
  });

const mapAlbum =
  (session: MusicSession) =>
  (item: RawItem): MusicAlbum => ({
    id: item.Id ?? '',
    name: item.Name ?? 'Unknown Album',
    albumArtist: item.AlbumArtist ?? item.AlbumArtists?.[0]?.Name,
    albumArtistId: item.AlbumArtists?.[0]?.Id,
    imageUrl: imageUrlFor(session, item.Id, 300, item.ImageTags?.Primary),
    productionYear: item.ProductionYear,
    trackCount: item.ChildCount,
    runTimeTicks: item.RunTimeTicks,
    genres: item.Genres ?? [],
    isFavorite: item.UserData?.IsFavorite,
  });

const mapTrack =
  (session: MusicSession) =>
  (item: RawItem): MusicTrack => ({
    id: item.Id ?? '',
    name: item.Name ?? 'Unknown Track',
    albumId: item.AlbumId,
    albumName: item.Album,
    artistName:
      item.ArtistItems?.[0]?.Name ?? item.Artists?.[0] ?? item.AlbumArtist,
    artistId: item.ArtistItems?.[0]?.Id,
    // Tracks rarely carry their own art; fall back to the album's.
    imageUrl:
      imageUrlFor(session, item.Id, 200, item.ImageTags?.Primary) ??
      imageUrlFor(session, item.AlbumId, 200, item.AlbumPrimaryImageTag),
    indexNumber: item.IndexNumber,
    parentIndexNumber: item.ParentIndexNumber,
    runTimeTicks: item.RunTimeTicks,
    playCount: item.UserData?.PlayCount,
    communityRating: item.CommunityRating ?? null,
    isFavorite: item.UserData?.IsFavorite,
    container: item.MediaSources?.[0]?.Container,
    bitrate: item.MediaSources?.[0]?.Bitrate,
  });

const mapGenre =
  (session: MusicSession) =>
  (item: RawItem): MusicGenre => ({
    id: item.Id ?? '',
    name: item.Name ?? 'Unknown Genre',
    imageUrl: imageUrlFor(session, item.Id, 300, item.ImageTags?.Primary),
  });

const mapPlaylist =
  (session: MusicSession) =>
  (item: RawItem): MusicPlaylist => ({
    id: item.Id ?? '',
    name: item.Name ?? 'Untitled Playlist',
    imageUrl: imageUrlFor(session, item.Id, 300, item.ImageTags?.Primary),
    trackCount: item.ChildCount,
    runTimeTicks: item.RunTimeTicks,
  });

// -------------------------------------------------------------- libraries

export interface MusicLibrary {
  id: string;
  name: string;
}

/**
 * Music libraries this user can actually see. Uses /UserViews rather than
 * /Library/MediaFolders because the latter is admin-only — the same bug fixed
 * for video in 1.0.3.
 */
export const getMusicLibraries = async (
  session: MusicSession,
): Promise<MusicLibrary[]> => {
  const response = await request<{
    Items?: Array<{CollectionType?: string; Id?: string; Name?: string}>;
  }>(session, '/UserViews', {userId: session.userId});

  return (response.Items ?? [])
    .filter((view) => view.CollectionType === 'music')
    .map((view) => ({id: view.Id ?? '', name: view.Name ?? 'Music'}));
};

/** Cheap check for nav gating — does this user have any music at all? */
export const hasMusicLibraries = async (session: MusicSession) => {
  try {
    return (await getMusicLibraries(session)).length > 0;
  } catch {
    return false;
  }
};

// ------------------------------------------------------------------ lists

const listItems = async <Item>(
  session: MusicSession,
  includeItemTypes: string,
  options: PageOptions,
  defaultSortBy: string,
  map: (item: RawItem) => Item,
  extraParams: Record<string, string | number | boolean | undefined> = {},
): Promise<Page<Item>> => {
  const raw = await request<RawPage>(
    session,
    `/Users/${session.userId}/Items`,
    {
      ...pageParams(options, defaultSortBy),
      ...extraParams,
      Fields: musicItemFields,
      ImageTypeLimit: 1,
      IncludeItemTypes: includeItemTypes,
      Recursive: true,
    },
  );

  return toPage(raw, options, map);
};

export const getAlbums = (session: MusicSession, options: PageOptions = {}) =>
  listItems(session, 'MusicAlbum', options, 'SortName', mapAlbum(session));

/**
 * Music genres come from the dedicated /MusicGenres endpoint. Verified against
 * a live server: `/Users/{id}/Items?IncludeItemTypes=MusicGenre` and
 * `/Genres?IncludeItemTypes=MusicAlbum` both return TotalRecordCount 0.
 */
export const getGenres = async (
  session: MusicSession,
  options: PageOptions = {},
): Promise<Page<MusicGenre>> => {
  const raw = await request<RawPage>(session, '/MusicGenres', {
    ...pageParams(options, 'SortName'),
    ImageTypeLimit: 1,
    UserId: session.userId,
  });

  return toPage(raw, options, mapGenre(session));
};

export const getPlaylists = (
  session: MusicSession,
  options: PageOptions = {},
) =>
  listItems(session, 'Playlist', options, 'SortName', mapPlaylist(session), {
    MediaTypes: 'Audio',
  });

export const getSongs = (session: MusicSession, options: PageOptions = {}) =>
  listItems(session, 'Audio', options, 'SortName', mapTrack(session));

/**
 * Album artists rather than every credited artist — matching how people
 * actually browse a music library. /Artists/AlbumArtists is a distinct
 * endpoint, so it does not go through listItems.
 */
export const getAlbumArtists = async (
  session: MusicSession,
  options: PageOptions = {},
): Promise<Page<MusicArtist>> => {
  const raw = await request<RawPage>(session, '/Artists/AlbumArtists', {
    ...pageParams(options, 'SortName'),
    Fields: musicItemFields,
    ImageTypeLimit: 1,
    Recursive: true,
    UserId: session.userId,
  });

  return toPage(raw, options, mapArtist(session));
};

export const getArtists = async (
  session: MusicSession,
  options: PageOptions = {},
): Promise<Page<MusicArtist>> => {
  const raw = await request<RawPage>(session, '/Artists', {
    ...pageParams(options, 'SortName'),
    Fields: musicItemFields,
    ImageTypeLimit: 1,
    Recursive: true,
    UserId: session.userId,
  });

  return toPage(raw, options, mapArtist(session));
};

// ----------------------------------------------------------------- detail

export const getArtist = async (
  session: MusicSession,
  artistId: string,
): Promise<MusicArtist> => {
  const item = await request<RawItem>(
    session,
    `/Users/${session.userId}/Items/${requireId(artistId, 'artist')}`,
    {Fields: itemFields},
  );

  return mapArtist(session)(item);
};

export const getAlbum = async (
  session: MusicSession,
  albumId: string,
): Promise<MusicAlbum> => {
  const item = await request<RawItem>(
    session,
    `/Users/${session.userId}/Items/${requireId(albumId, 'album')}`,
    {Fields: itemFields},
  );

  return mapAlbum(session)(item);
};

export const getArtistAlbums = async (
  session: MusicSession,
  artistId: string,
  options: PageOptions = {},
) =>
  listItems(
    session,
    'MusicAlbum',
    {sortBy: 'ProductionYear,SortName', sortDescending: true, ...options},
    'ProductionYear,SortName',
    mapAlbum(session),
    {AlbumArtistIds: requireId(artistId, 'artist')},
  );

/** Tracks of one album, in disc/track order. */
export const getAlbumTracks = async (session: MusicSession, albumId: string) =>
  listItems(
    session,
    'Audio',
    {limit: 500, sortBy: 'ParentIndexNumber,IndexNumber,SortName'},
    'ParentIndexNumber,IndexNumber,SortName',
    mapTrack(session),
    {ParentId: requireId(albumId, 'album')},
  );

export const getPlaylistTracks = async (
  session: MusicSession,
  playlistId: string,
) =>
  listItems(
    session,
    'Audio',
    {limit: 1000, sortBy: 'IndexNumber'},
    'IndexNumber',
    mapTrack(session),
    {ParentId: requireId(playlistId, 'playlist')},
  );

export const getGenreAlbums = async (
  session: MusicSession,
  genreId: string,
  options: PageOptions = {},
) =>
  listItems(session, 'MusicAlbum', options, 'SortName', mapAlbum(session), {
    GenreIds: requireId(genreId, 'genre'),
  });

/**
 * "Top tracks" for an artist.
 *
 * Jellyfin has no global popularity — only this user's own PlayCount, which is
 * zero for a freshly added library. So fall back through progressively weaker
 * signals rather than rendering an empty section for exactly the people seeing
 * the feature for the first time.
 */
export const getArtistTopTracks = async (
  session: MusicSession,
  artistId: string,
  limit = 10,
): Promise<MusicTrack[]> => {
  const byPlayCount = await listItems(
    session,
    'Audio',
    {limit, sortBy: 'PlayCount', sortDescending: true},
    'PlayCount',
    mapTrack(session),
    {ArtistIds: requireId(artistId, 'artist')},
  );
  const played = byPlayCount.items.filter(
    (track) => (track.playCount ?? 0) > 0,
  );

  if (played.length) {
    return played.slice(0, limit);
  }

  const byRating = await listItems(
    session,
    'Audio',
    {limit, sortBy: 'CommunityRating', sortDescending: true},
    'CommunityRating',
    mapTrack(session),
    {ArtistIds: requireId(artistId, 'artist')},
  );
  const rated = byRating.items.filter(
    (track) => (track.communityRating ?? 0) > 0,
  );

  if (rated.length) {
    return rated.slice(0, limit);
  }

  // Nothing played, nothing rated: show something coherent rather than
  // nothing — the newest album's opening tracks.
  const newest = await listItems(
    session,
    'Audio',
    {limit, sortBy: 'PremiereDate,ParentIndexNumber,IndexNumber'},
    'PremiereDate,ParentIndexNumber,IndexNumber',
    mapTrack(session),
    {ArtistIds: requireId(artistId, 'artist')},
  );

  return newest.items.slice(0, limit);
};

/**
 * Artists frequently have no image. Rather than a coloured box, borrow the
 * cover of their earliest album.
 */
export const getArtistFallbackImage = async (
  session: MusicSession,
  artistId: string,
): Promise<string | undefined> => {
  const albums = await listItems(
    session,
    'MusicAlbum',
    {limit: 1, sortBy: 'ProductionYear,SortName'},
    'ProductionYear,SortName',
    mapAlbum(session),
    {AlbumArtistIds: requireId(artistId, 'artist')},
  );

  return albums.items[0]?.imageUrl;
};

export const searchMusic = async (
  session: MusicSession,
  searchTerm: string,
): Promise<{
  albums: MusicAlbum[];
  artists: MusicArtist[];
  tracks: MusicTrack[];
}> => {
  const [albums, artists, tracks] = await Promise.all([
    listItems(
      session,
      'MusicAlbum',
      {limit: 24},
      'SortName',
      mapAlbum(session),
      {SearchTerm: searchTerm},
    ),
    listItems(
      session,
      'MusicArtist',
      {limit: 24},
      'SortName',
      mapArtist(session),
      {SearchTerm: searchTerm},
    ),
    listItems(session, 'Audio', {limit: 40}, 'SortName', mapTrack(session), {
      SearchTerm: searchTerm,
    }),
  ]);

  return {albums: albums.items, artists: artists.items, tracks: tracks.items};
};

// -------------------------------------------------------------- streaming

/**
 * Direct-play URL for a track.
 *
 * Sends only the native container list. No TranscodingContainer,
 * TranscodingProtocol, AudioCodec or MaxStreamingBitrate — spike v3 showed
 * those force a transcode whose stream the Vega player reports as unseekable.
 * With direct play the whole file is seekable (`seekable: [0, duration]`).
 */
export const getAudioStreamUrl = (
  session: MusicSession,
  trackId: string,
  deviceId = 'astra-audio',
) =>
  buildUrl(
    session.serverUrl,
    `/Audio/${requireId(trackId, 'track')}/universal`,
    {
      Container: NATIVE_AUDIO_CONTAINERS,
      DeviceId: deviceId,
      UserId: session.userId,
      api_key: session.accessToken,
    },
  );

/**
 * HLS-transcoded URL for cleartext servers.
 *
 * Deliberately advertises only AAC as an acceptable output container. If the
 * source container (usually MP3) appears in `Container`, Jellyfin chooses
 * direct play and silently ignores the HLS parameters, returning the raw file
 * instead of a manifest. Shaka performs the manifest and segment requests in
 * JavaScript, avoiding Vega's native cleartext-media restriction.
 */
export const getAudioHlsStreamUrl = (
  session: MusicSession,
  trackId: string,
  deviceId = 'astra-audio',
) =>
  buildUrl(
    session.serverUrl,
    `/Audio/${requireId(trackId, 'track')}/universal`,
    {
      AudioCodec: 'aac',
      Container: 'aac',
      DeviceId: deviceId,
      TranscodingContainer: 'ts',
      TranscodingProtocol: 'hls',
      UserId: session.userId,
      api_key: session.accessToken,
    },
  );

// ------------------------------------------------------------ user state

export const setTrackFavorite = (
  session: MusicSession,
  trackId: string,
  isFavorite: boolean,
) =>
  getJson(
    buildUrl(
      session.serverUrl,
      `/Users/${session.userId}/FavoriteItems/${requireId(trackId, 'track')}`,
      {api_key: session.accessToken},
    ),
    {
      method: isFavorite ? 'POST' : 'DELETE',
      headers: getAuthHeaders(session.accessToken),
    },
  );
