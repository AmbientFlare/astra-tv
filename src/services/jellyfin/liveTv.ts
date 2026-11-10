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
import {getLocaleTag} from '../../i18n';
import {mapItem} from './shared';
import type {JellyfinMediaItem} from './types';

export interface LiveTvSession {
  accessToken: string;
  serverUrl: string;
  userId: string;
}

export interface LiveTvProgram {
  id: string;
  name: string;
  episodeTitle?: string;
  overview?: string;
  /** Milliseconds since the epoch. */
  startTime: number;
  endTime: number;
  isSeries?: boolean;
  /** Set when this airing is scheduled to record. */
  timerId?: string;
  /** Set when the series this airing belongs to is set to record. */
  seriesTimerId?: string;
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

const CLOSE_TIMEOUT_MS = 10_000;

interface RawProgram {
  Id?: string;
  ChannelId?: string;
  Name?: string;
  EpisodeTitle?: string;
  Overview?: string;
  StartDate?: string;
  EndDate?: string;
  ChannelName?: string;
  ChannelNumber?: string;
  ImageTags?: {Primary?: string; Thumb?: string};
  IsSeries?: boolean;
  TimerId?: string;
  SeriesTimerId?: string;
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
    overview: raw.Overview || undefined,
    startTime,
    endTime,
    isSeries: raw.IsSeries || undefined,
    timerId: raw.TimerId || undefined,
    seriesTimerId: raw.SeriesTimerId || undefined,
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

/**
 * Every programme on these channels that overlaps the time range, keyed by
 * channel id and in start order. The guide grid asks for a block of channels
 * and hours at a time.
 */
export const getGuidePrograms = async (
  session: LiveTvSession,
  channelIds: string[],
  start: number,
  end: number,
): Promise<Record<string, LiveTvProgram[]>> => {
  const ids = channelIds.filter(Boolean);

  if (!ids.length) {
    return {};
  }

  const raw = await request<RawPage<RawProgram>>(session, '/LiveTv/Programs', {
    ChannelIds: ids.join(','),
    EnableImages: false,
    EnableTotalRecordCount: false,
    EnableUserData: false,
    Fields: 'Overview',
    MaxStartDate: new Date(end).toISOString(),
    MinEndDate: new Date(start).toISOString(),
    SortBy: 'StartDate',
    UserId: session.userId,
  });

  const programs: Record<string, LiveTvProgram[]> = {};

  (raw.Items ?? []).forEach((item) => {
    const program = mapProgram(item);

    if (item.ChannelId && program) {
      (programs[item.ChannelId] ??= []).push(program);
    }
  });

  return programs;
};

/** A programme airing now, with the channel it is on. */
export interface OnNowProgram extends LiveTvProgram {
  channel: LiveTvChannel;
  imageUrl?: string;
}

export const ON_NOW_LIMIT = 24;

const imageUrl = (
  session: LiveTvSession,
  id: string,
  type: 'Primary' | 'Thumb',
  tag: string | undefined,
  size: {fillHeight?: number; fillWidth?: number},
) =>
  buildUrl(session.serverUrl, `/Items/${id}/Images/${type}`, {
    ...size,
    quality: 90,
    tag,
    ...tokenQuery(session.accessToken),
  });

/**
 * What is airing now, as Jellyfin's own home screen picks it: the server's
 * recommended programmes that are on the air. Each comes with its channel so
 * a card can tune straight to it.
 */
export const getOnNowPrograms = async (
  session: LiveTvSession,
  limit = ON_NOW_LIMIT,
): Promise<OnNowProgram[]> => {
  const raw = await request<RawPage<RawProgram>>(
    session,
    '/LiveTv/Programs/Recommended',
    {
      EnableImageTypes: 'Primary,Thumb',
      EnableTotalRecordCount: false,
      Fields: 'ChannelInfo',
      ImageTypeLimit: 1,
      IsAiring: true,
      Limit: limit,
      UserId: session.userId,
    },
  );

  return (raw.Items ?? []).flatMap((item) => {
    const program = mapProgram(item);

    if (!program || !item.Id || !item.ChannelId) {
      return [];
    }

    const thumbType = item.ImageTags?.Thumb ? 'Thumb' : 'Primary';
    const thumbTag = item.ImageTags?.[thumbType];

    return [
      {
        ...program,
        channel: {
          id: item.ChannelId,
          name: item.ChannelName ?? '',
          number: item.ChannelNumber || undefined,
          // The guide's channel image tag is often missing from this
          // endpoint even when the channel has a logo, so ask for it untagged.
          imageUrl: imageUrl(session, item.ChannelId, 'Primary', undefined, {
            fillHeight: 96,
          }),
          isFavorite: false,
          current: program,
        },
        imageUrl: thumbTag
          ? imageUrl(session, item.Id, thumbType, thumbTag, {fillWidth: 400})
          : undefined,
      },
    ];
  });
};

/** 0 to 1: how far through its slot a programme is. */
export const programProgress = (program: LiveTvProgram, now = Date.now()) => {
  const length = program.endTime - program.startTime;

  if (length <= 0) {
    return 0;
  }

  return Math.min(1, Math.max(0, (now - program.startTime) / length));
};

/**
 * What is on a channel now and next, fresh from the guide. The player's info
 * banner uses this instead of the channel list, which may be an hour old.
 */
export const getChannelSchedule = async (
  session: LiveTvSession,
  channelId: string,
  now = Date.now(),
): Promise<{current?: LiveTvProgram; next?: LiveTvProgram}> => {
  const raw = await request<RawPage<RawProgram>>(session, '/LiveTv/Programs', {
    ChannelIds: channelId,
    EnableImages: false,
    EnableTotalRecordCount: false,
    EnableUserData: false,
    Limit: 2,
    MaxStartDate: new Date(now + NEXT_PROGRAM_WINDOW_MS).toISOString(),
    MinEndDate: new Date(now).toISOString(),
    SortBy: 'StartDate',
    UserId: session.userId,
  });
  const [first, second] = (raw.Items ?? [])
    .map(mapProgram)
    .filter((program): program is LiveTvProgram => Boolean(program));

  // A gap in the guide means the first programme has not started yet.
  return first && first.startTime > now
    ? {next: first}
    : {current: first, next: second};
};

/**
 * Lets the server release a live stream, and with it the tuner. Each opening
 * counts once on the server, so this goes out exactly once per opening.
 */
const send = (
  session: LiveTvSession,
  method: 'DELETE' | 'POST',
  path: string,
  body?: unknown,
) =>
  getJson<void>(buildUrl(session.serverUrl, path), {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      ...getAuthHeaders(session.accessToken),
      'Content-Type': 'application/json',
    },
    method,
  });

/**
 * Whether this user may schedule recordings. Without the server's Live TV
 * management permission, every record request is refused.
 */
export const canManageRecordings = async (session: LiveTvSession) => {
  const user = await request<{
    Policy?: {EnableLiveTvManagement?: boolean; IsAdministrator?: boolean};
  }>(session, `/Users/${session.userId}`);

  return Boolean(
    user.Policy?.EnableLiveTvManagement || user.Policy?.IsAdministrator,
  );
};

/** Re-reads one programme, so its recording state is current. */
export const getProgram = async (session: LiveTvSession, programId: string) =>
  mapProgram(
    await request<RawProgram>(session, `/LiveTv/Programs/${programId}`, {
      UserId: session.userId,
    }),
  );

/**
 * Schedules a recording the way Jellyfin's own clients do: the server fills
 * in its default settings (padding, keep rules) for the programme, and those
 * are sent back unchanged.
 */
export const recordProgram = async (
  session: LiveTvSession,
  programId: string,
  series = false,
) => {
  const defaults = await request<Record<string, unknown>>(
    session,
    '/LiveTv/Timers/Defaults',
    {programId},
  );

  await send(
    session,
    'POST',
    series ? '/LiveTv/SeriesTimers' : '/LiveTv/Timers',
    defaults,
  );
};

export const cancelRecording = (session: LiveTvSession, timerId: string) =>
  send(session, 'DELETE', `/LiveTv/Timers/${timerId}`);

export const cancelSeriesRecording = (
  session: LiveTvSession,
  seriesTimerId: string,
) => send(session, 'DELETE', `/LiveTv/SeriesTimers/${seriesTimerId}`);

/** A finished recording, or one still being made. */
export interface LiveTvRecording {
  id: string;
  name: string;
  episodeTitle?: string;
  overview?: string;
  channelName?: string;
  /** When the airing started and ends, if the server says. */
  startTime?: number;
  endTime?: number;
  inProgress: boolean;
  /** The timer making it, while it is in progress. */
  timerId?: string;
  imageUrl?: string;
  /** The recording as a playable item. */
  item: JellyfinMediaItem;
}

/** A single airing set to record. */
export interface ScheduledRecording {
  id: string;
  name: string;
  episodeTitle?: string;
  channelName?: string;
  startTime: number;
  endTime: number;
  imageUrl?: string;
  /** Set when a series recording scheduled it. */
  seriesTimerId?: string;
}

/** A series set to record. */
export interface SeriesRecording {
  id: string;
  name: string;
  channelName?: string;
  recordAnyChannel: boolean;
  recordNewOnly: boolean;
  imageUrl?: string;
}

interface RawRecording extends RawProgram {
  SeriesName?: string;
  Status?: string;
  DateCreated?: string;
  Type?: string;
  MediaType?: string;
  RunTimeTicks?: number;
  UserData?: {PlaybackPositionTicks?: number; Played?: boolean};
  ParentThumbItemId?: string;
  ParentThumbImageTag?: string;
  ParentPrimaryImageItemId?: string;
  ParentPrimaryImageTag?: string;
}

interface RawTimer {
  Id?: string;
  Name?: string;
  Status?: string;
  ChannelName?: string;
  StartDate?: string;
  EndDate?: string;
  SeriesTimerId?: string;
  ProgramInfo?: RawProgram;
}

interface RawSeriesTimer {
  Id?: string;
  Name?: string;
  ChannelName?: string;
  RecordAnyChannel?: boolean;
  RecordNewOnly?: boolean;
  ParentPrimaryImageItemId?: string;
  ParentPrimaryImageTag?: string;
}

const parseTime = (value?: string) => {
  const time = value ? Date.parse(value) : NaN;
  return Number.isNaN(time) ? undefined : time;
};

const CARD_IMAGE = {fillWidth: 400};

const recordingImage = (session: LiveTvSession, raw: RawRecording) => {
  if (raw.Id && raw.ImageTags?.Primary) {
    return imageUrl(
      session,
      raw.Id,
      'Primary',
      raw.ImageTags.Primary,
      CARD_IMAGE,
    );
  }
  if (raw.ParentThumbItemId && raw.ParentThumbImageTag) {
    return imageUrl(
      session,
      raw.ParentThumbItemId,
      'Thumb',
      raw.ParentThumbImageTag,
      CARD_IMAGE,
    );
  }
  if (raw.ParentPrimaryImageItemId && raw.ParentPrimaryImageTag) {
    return imageUrl(
      session,
      raw.ParentPrimaryImageItemId,
      'Primary',
      raw.ParentPrimaryImageTag,
      CARD_IMAGE,
    );
  }
  return undefined;
};

/** How many recordings one request asks for. */
export const RECORDINGS_PAGE_SIZE = 100;

/**
 * One page of the server's recordings, newest first. It ignores its own
 * in-progress filter, so recordings still being made are told apart by their
 * status.
 *
 * Asked for a page at a time: a long-kept DVR holds thousands, and the whole
 * list in one response is a single large parse on a device short of memory.
 * The server sorts by date created, newest first, so the first page holds
 * whatever is recording now.
 */
export const getRecordings = async (
  session: LiveTvSession,
  page: {limit?: number; startIndex?: number} = {},
): Promise<LiveTvRecording[]> => {
  const raw = await request<RawPage<RawRecording>>(
    session,
    '/LiveTv/Recordings',
    {
      EnableImageTypes: 'Primary,Thumb',
      EnableTotalRecordCount: false,
      Fields: 'DateCreated,Overview',
      ImageTypeLimit: 1,
      Limit: page.limit ?? RECORDINGS_PAGE_SIZE,
      StartIndex: page.startIndex ?? 0,
      UserId: session.userId,
    },
  );

  // Once finished, a recording becomes a library episode: the show moves to
  // SeriesName and its name becomes the episode title.
  return (raw.Items ?? [])
    .flatMap((item): LiveTvRecording[] =>
      item.Id
        ? [
            {
              id: item.Id,
              name: item.SeriesName || item.Name || '',
              episodeTitle:
                item.EpisodeTitle ||
                (item.SeriesName && item.Name !== item.SeriesName
                  ? item.Name
                  : undefined),
              overview: item.Overview || undefined,
              channelName: item.ChannelName || undefined,
              startTime:
                parseTime(item.StartDate) ?? parseTime(item.DateCreated),
              endTime: parseTime(item.EndDate),
              inProgress: item.Status === 'InProgress',
              timerId: item.TimerId || undefined,
              imageUrl: recordingImage(session, item),
              item: mapItem(session.serverUrl, session.accessToken, item),
            },
          ]
        : [],
    )
    .sort((a, b) => (b.startTime ?? 0) - (a.startTime ?? 0));
};

/** Airings still to come that are set to record, soonest first. */
export const getScheduledRecordings = async (
  session: LiveTvSession,
): Promise<ScheduledRecording[]> => {
  const raw = await request<RawPage<RawTimer>>(session, '/LiveTv/Timers');

  return (raw.Items ?? [])
    .flatMap((timer): ScheduledRecording[] => {
      const startTime = parseTime(timer.StartDate);
      const endTime = parseTime(timer.EndDate);
      const program = timer.ProgramInfo;

      if (
        !timer.Id ||
        timer.Status !== 'New' ||
        startTime === undefined ||
        endTime === undefined
      ) {
        return [];
      }

      return [
        {
          id: timer.Id,
          name: timer.Name ?? program?.Name ?? '',
          episodeTitle: program?.EpisodeTitle || undefined,
          channelName: timer.ChannelName || undefined,
          startTime,
          endTime,
          imageUrl:
            program?.Id && program.ImageTags?.Primary
              ? imageUrl(
                  session,
                  program.Id,
                  'Primary',
                  program.ImageTags.Primary,
                  CARD_IMAGE,
                )
              : undefined,
          seriesTimerId: timer.SeriesTimerId || undefined,
        },
      ];
    })
    .sort((a, b) => a.startTime - b.startTime);
};

export const getSeriesRecordings = async (
  session: LiveTvSession,
): Promise<SeriesRecording[]> => {
  const raw = await request<RawPage<RawSeriesTimer>>(
    session,
    '/LiveTv/SeriesTimers',
  );

  return (raw.Items ?? []).flatMap((timer): SeriesRecording[] =>
    timer.Id
      ? [
          {
            id: timer.Id,
            name: timer.Name ?? '',
            channelName: timer.ChannelName || undefined,
            recordAnyChannel: Boolean(timer.RecordAnyChannel),
            recordNewOnly: Boolean(timer.RecordNewOnly),
            imageUrl:
              timer.ParentPrimaryImageItemId && timer.ParentPrimaryImageTag
                ? imageUrl(
                    session,
                    timer.ParentPrimaryImageItemId,
                    'Primary',
                    timer.ParentPrimaryImageTag,
                    CARD_IMAGE,
                  )
                : undefined,
          },
        ]
      : [],
  );
};

/** Deletes a finished recording and its file from the server. */
export const deleteRecording = (session: LiveTvSession, recordingId: string) =>
  send(session, 'DELETE', `/Items/${recordingId}`);

export const closeLiveStream = async (
  session: Pick<LiveTvSession, 'accessToken' | 'serverUrl'>,
  liveStreamId: string,
) => {
  await getJson(
    buildUrl(session.serverUrl, '/LiveStreams/Close', {liveStreamId}),
    {method: 'POST', headers: getAuthHeaders(session.accessToken)},
    // A channel change waits on this, so an unreachable server must not
    // hold it for the usual 45 seconds.
    CLOSE_TIMEOUT_MS,
  );
};

/** The channel before or after this one, wrapping round at either end. */
export const neighbourChannel = (
  channels: LiveTvChannel[],
  channelId: string,
  direction: 1 | -1,
): LiveTvChannel | undefined => {
  const index = channels.findIndex((channel) => channel.id === channelId);

  if (index < 0 || channels.length < 2) {
    return undefined;
  }

  return channels[(index + direction + channels.length) % channels.length];
};

/** A programme time as the viewer's locale writes a clock time. */
export const formatClockTime = (time: number) =>
  new Date(time).toLocaleTimeString(getLocaleTag(), {
    hour: 'numeric',
    minute: '2-digit',
  });

/**
 * Whether an item plays as live: a Live TV channel, or a live stream from a
 * channel plugin. Jellyfin marks the second kind only with its tag; to the
 * rest of the API it is an ordinary video with no length.
 */
export const isLiveItem = (item: Pick<JellyfinMediaItem, 'tags' | 'type'>) =>
  item.type === 'TvChannel' ||
  Boolean(item.tags?.some((tag) => tag.toLowerCase() === 'livestream'));

/** A channel as the player's item; its type is what puts the player in live mode. */
/**
 * A live stream from a channel plugin rather than a Live TV channel. Jellyfin
 * never probes it, so its HLS keeps the source's timestamps (no
 * -start_at_zero): segments mode buffers it minutes past the playhead, which
 * Shaka will not seek to. It needs sequence mode, even though sequence mode
 * was turned down for MPEG-TS films over slow A/V drift.
 */
export const isPluginLiveItem = (
  item: Pick<JellyfinMediaItem, 'tags' | 'type'>,
) => item.type !== 'TvChannel' && isLiveItem(item);

export const liveChannelItem = (channel: LiveTvChannel): JellyfinMediaItem => ({
  id: channel.id,
  name: channel.name,
  type: 'TvChannel',
  imageUrl: channel.imageUrl,
});
