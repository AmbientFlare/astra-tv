/**
 * Jellyfin Live TV API.
 *
 * Channels come from whatever the server has as a tuner: an antenna tuner,
 * an M3U/IPTV list, or a plugin that registers itself as one. All of them
 * reach the client through the same /LiveTv endpoints, so nothing here cares
 * which kind it is.
 *
 * Channel lists can run to hundreds of entries, so they are paged like the
 * music lists. Jellyfin orders channels by number, favourites first when
 * asked; a client cannot re-sort across pages, so the server's order is kept.
 */
import {buildUrl, getAuthHeaders, getJson, tokenQuery} from './http';
import type {Page} from './music';

export interface LiveTvSession {
  accessToken: string;
  serverUrl: string;
  userId: string;
}

export interface LiveTvProgram {
  id: string;
  name: string;
  episodeTitle?: string;
  /** Milliseconds since the epoch. */
  startTime: number;
  endTime: number;
}

export interface LiveTvChannel {
  id: string;
  name: string;
  number?: string;
  imageUrl?: string;
  isFavorite: boolean;
  current?: LiveTvProgram;
  next?: LiveTvProgram;
}

/**
 * The genre filters map to Jellyfin's own channel flags, which come from the
 * guide data's categories. Many guides fill in only some of them.
 */
export type LiveTvFilter =
  | 'all'
  | 'favorites'
  | 'movies'
  | 'series'
  | 'news'
  | 'sports'
  | 'kids';

export const LIVE_TV_FILTERS: LiveTvFilter[] = [
  'all',
  'favorites',
  'movies',
  'series',
  'news',
  'sports',
  'kids',
];

export const LIVE_TV_PAGE_SIZE = 60;

/** How far ahead to look for each channel's next programme. */
const NEXT_PROGRAM_WINDOW_MS = 6 * 60 * 60 * 1000;

interface RawProgram {
  Id?: string;
  ChannelId?: string;
  Name?: string;
  EpisodeTitle?: string;
  StartDate?: string;
  EndDate?: string;
}

interface RawChannel {
  Id?: string;
  Name?: string;
  ChannelNumber?: string;
  Number?: string;
  ImageTags?: {Primary?: string};
  UserData?: {IsFavorite?: boolean};
  CurrentProgram?: RawProgram;
}

interface RawPage<Item> {
  Items?: Item[];
  TotalRecordCount?: number;
}

const request = <Body>(session: LiveTvSession, path: string, params = {}) =>
  getJson<Body>(buildUrl(session.serverUrl, path, params), {
    headers: getAuthHeaders(session.accessToken),
  });

const filterParams = (filter: LiveTvFilter) => {
  switch (filter) {
    case 'favorites':
      return {IsFavorite: true};
    case 'movies':
      return {IsMovie: true};
    case 'series':
      return {IsSeries: true};
    case 'news':
      return {IsNews: true};
    case 'sports':
      return {IsSports: true};
    case 'kids':
      return {IsKids: true};
    default:
      return {};
  }
};

export const mapProgram = (raw?: RawProgram): LiveTvProgram | undefined => {
  const startTime = raw?.StartDate ? Date.parse(raw.StartDate) : NaN;
  const endTime = raw?.EndDate ? Date.parse(raw.EndDate) : NaN;

  if (!raw?.Id || Number.isNaN(startTime) || Number.isNaN(endTime)) {
    return undefined;
  }

  return {
    id: raw.Id,
    name: raw.Name ?? '',
    episodeTitle: raw.EpisodeTitle || undefined,
    startTime,
    endTime,
  };
};

const mapChannel =
  (session: LiveTvSession) =>
  (raw: RawChannel): LiveTvChannel => ({
    id: raw.Id ?? '',
    name: raw.Name ?? '',
    number: raw.ChannelNumber || raw.Number || undefined,
    imageUrl:
      raw.Id && raw.ImageTags?.Primary
        ? buildUrl(session.serverUrl, `/Items/${raw.Id}/Images/Primary`, {
            fillHeight: 96,
            quality: 90,
            tag: raw.ImageTags.Primary,
            ...tokenQuery(session.accessToken),
          })
        : undefined,
    isFavorite: Boolean(raw.UserData?.IsFavorite),
    current: mapProgram(raw.CurrentProgram),
  });

export const getLiveTvChannels = async (
  session: LiveTvSession,
  {
    filter = 'all',
    limit = LIVE_TV_PAGE_SIZE,
    startIndex = 0,
  }: {filter?: LiveTvFilter; limit?: number; startIndex?: number} = {},
): Promise<Page<LiveTvChannel>> => {
  const raw = await request<RawPage<RawChannel>>(session, '/LiveTv/Channels', {
    AddCurrentProgram: true,
    EnableFavoriteSorting: true,
    EnableImageTypes: 'Primary',
    EnableUserData: true,
    ImageTypeLimit: 1,
    Limit: limit,
    StartIndex: startIndex,
    UserId: session.userId,
    ...filterParams(filter),
  });

  return {
    items: (raw.Items ?? []).map(mapChannel(session)),
    startIndex,
    totalCount: raw.TotalRecordCount ?? (raw.Items ?? []).length,
  };
};

/**
 * The first programme starting after each channel's current one, keyed by
 * channel id. One request per page of channels, not one per channel.
 */
export const getNextPrograms = async (
  session: LiveTvSession,
  channelIds: string[],
  now = Date.now(),
): Promise<Record<string, LiveTvProgram>> => {
  const ids = channelIds.filter(Boolean);

  if (!ids.length) {
    return {};
  }

  const raw = await request<RawPage<RawProgram>>(session, '/LiveTv/Programs', {
    ChannelIds: ids.join(','),
    EnableImages: false,
    EnableTotalRecordCount: false,
    EnableUserData: false,
    // A few programmes per channel is plenty to find the next one.
    Limit: ids.length * 4,
    MaxStartDate: new Date(now + NEXT_PROGRAM_WINDOW_MS).toISOString(),
    MinStartDate: new Date(now).toISOString(),
    SortBy: 'StartDate',
    UserId: session.userId,
  });

  const next: Record<string, LiveTvProgram> = {};

  (raw.Items ?? []).forEach((item) => {
    const program = mapProgram(item);

    if (item.ChannelId && program && !next[item.ChannelId]) {
      next[item.ChannelId] = program;
    }
  });

  return next;
};

/**
 * The filters worth offering: All always, the rest only when the server has
 * at least one channel for them. A guide without sports categories should not
 * show a Sports button that always comes up empty.
 */
export const getAvailableLiveTvFilters = async (
  session: LiveTvSession,
): Promise<LiveTvFilter[]> => {
  const counts = await Promise.all(
    LIVE_TV_FILTERS.map(async (filter) => {
      if (filter === 'all') {
        return 1;
      }

      try {
        const page = await getLiveTvChannels(session, {filter, limit: 0});
        return page.totalCount;
      } catch {
        return 0;
      }
    }),
  );

  return LIVE_TV_FILTERS.filter((_, index) => counts[index] > 0);
};

/** 0 to 1: how far through its slot a programme is. */
export const programProgress = (program: LiveTvProgram, now = Date.now()) => {
  const length = program.endTime - program.startTime;

  if (length <= 0) {
    return 0;
  }

  return Math.min(1, Math.max(0, (now - program.startTime) / length));
};
