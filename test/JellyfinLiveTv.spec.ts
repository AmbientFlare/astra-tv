jest.mock('../src/services/deviceIdentity', () => ({
  initializeDeviceIdentity: jest.fn(async () => 'test-installation'),
  getDeviceId: () => 'test-installation',
}));

import {
  cancelRecording,
  cancelSeriesRecording,
  canManageRecordings,
  closeLiveStream,
  deleteRecording,
  getAvailableLiveTvFilters,
  getChannelSchedule,
  getGuidePrograms,
  isLiveItem,
  isPluginLiveItem,
  liveChannelItem,
  LiveTvChannel,
  neighbourChannel,
  getLiveTvChannels,
  getNextPrograms,
  getOnNowPrograms,
  getRecordings,
  getScheduledRecordings,
  getSeriesRecordings,
  LiveTvSession,
  mapProgram,
  programProgress,
  recordProgram,
} from '../src/services/jellyfin/liveTv';
import {getLatestItemsInLibrary} from '../src/services/jellyfin/itemCollections';

const session: LiveTvSession = {
  accessToken: 'token-123',
  serverUrl: 'https://media.example.com',
  userId: 'user-1',
};

const mockFetch = (handler: (url: URL) => unknown) => {
  const calls: URL[] = [];

  global.fetch = jest.fn(async (url: string) => {
    const parsed = new URL(url);
    calls.push(parsed);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(handler(parsed)),
    };
  }) as unknown as typeof fetch;

  return calls;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('getLiveTvChannels', () => {
  it('asks for now-playing and favourites first, and maps the channel', async () => {
    const calls = mockFetch(() => ({
      Items: [
        {
          Id: 'ch-1',
          Name: 'Family Ties',
          ChannelNumber: '315',
          ImageTags: {Primary: 'tag-1'},
          UserData: {IsFavorite: true},
          CurrentProgram: {
            Id: 'p-1',
            Name: 'Family Ties',
            EpisodeTitle: 'Pilot',
            StartDate: '2026-10-31T18:00:00.0000000Z',
            EndDate: '2026-10-31T18:30:00.0000000Z',
          },
        },
        {Id: 'ch-2', Name: 'No Guide'},
      ],
      TotalRecordCount: 440,
    }));

    const page = await getLiveTvChannels(session, {startIndex: 60});

    const params = calls[0].searchParams;
    expect(calls[0].pathname).toBe('/LiveTv/Channels');
    expect(params.get('AddCurrentProgram')).toBe('true');
    expect(params.get('EnableFavoriteSorting')).toBe('true');
    expect(params.get('StartIndex')).toBe('60');
    expect(params.get('UserId')).toBe('user-1');
    expect(params.get('IsFavorite')).toBeNull();

    expect(page.totalCount).toBe(440);
    expect(page.startIndex).toBe(60);
    expect(page.items[0]).toMatchObject({
      id: 'ch-1',
      isFavorite: true,
      name: 'Family Ties',
      number: '315',
      current: {
        episodeTitle: 'Pilot',
        id: 'p-1',
        startTime: Date.parse('2026-10-31T18:00:00Z'),
        endTime: Date.parse('2026-10-31T18:30:00Z'),
      },
    });
    // Logos are handed straight to an Image, so the token rides in the URL.
    expect(page.items[0].imageUrl).toContain('/Items/ch-1/Images/Primary');
    expect(page.items[0].imageUrl).toContain('ApiKey=token-123');
    expect(page.items[1]).toMatchObject({
      current: undefined,
      imageUrl: undefined,
      isFavorite: false,
      number: undefined,
    });
  });

  it.each([
    ['favorites', 'IsFavorite'],
    ['movies', 'IsMovie'],
    ['series', 'IsSeries'],
    ['news', 'IsNews'],
    ['sports', 'IsSports'],
    ['kids', 'IsKids'],
  ] as const)('maps the %s filter to %s', async (filter, param) => {
    const calls = mockFetch(() => ({Items: [], TotalRecordCount: 0}));

    await getLiveTvChannels(session, {filter});

    expect(calls[0].searchParams.get(param)).toBe('true');
  });
});

describe('getNextPrograms', () => {
  it('fetches one page of programmes and keeps the first per channel', async () => {
    const calls = mockFetch(() => ({
      Items: [
        {
          Id: 'a1',
          ChannelId: 'ch-1',
          Name: 'First',
          StartDate: '2026-10-31T18:30:00Z',
          EndDate: '2026-10-31T19:00:00Z',
        },
        {
          Id: 'a2',
          ChannelId: 'ch-1',
          Name: 'Later',
          StartDate: '2026-10-31T19:00:00Z',
          EndDate: '2026-10-31T19:30:00Z',
        },
        {
          Id: 'b1',
          ChannelId: 'ch-2',
          Name: 'Other',
          StartDate: '2026-10-31T18:45:00Z',
          EndDate: '2026-10-31T19:45:00Z',
        },
      ],
    }));

    const now = Date.parse('2026-10-31T18:10:00Z');
    const next = await getNextPrograms(session, ['ch-1', 'ch-2'], now);

    expect(calls).toHaveLength(1);
    expect(calls[0].pathname).toBe('/LiveTv/Programs');
    expect(calls[0].searchParams.get('ChannelIds')).toBe('ch-1,ch-2');
    expect(calls[0].searchParams.get('MinStartDate')).toBe(
      new Date(now).toISOString(),
    );
    expect(calls[0].searchParams.get('SortBy')).toBe('StartDate');
    expect(next['ch-1'].name).toBe('First');
    expect(next['ch-2'].name).toBe('Other');
  });

  it('makes no request without channels', async () => {
    const calls = mockFetch(() => ({Items: []}));

    expect(await getNextPrograms(session, [])).toEqual({});
    expect(calls).toHaveLength(0);
  });
});

describe('getAvailableLiveTvFilters', () => {
  it('offers only filters that have channels, and All always', async () => {
    mockFetch((url) => {
      const counts: Record<string, number> = {IsMovie: 60, IsKids: 27};
      const flag = Object.keys(counts).find((key) => url.searchParams.has(key));
      return {Items: [], TotalRecordCount: flag ? counts[flag] : 0};
    });

    expect(await getAvailableLiveTvFilters(session)).toEqual([
      'all',
      'movies',
      'kids',
    ]);
  });
});

describe('programProgress', () => {
  const program = {id: 'p', name: 'P', startTime: 1000, endTime: 2000};

  it('is the fraction of the slot gone by, clamped to 0..1', () => {
    expect(programProgress(program, 1500)).toBe(0.5);
    expect(programProgress(program, 500)).toBe(0);
    expect(programProgress(program, 3000)).toBe(1);
    expect(programProgress({...program, endTime: 1000}, 1500)).toBe(0);
  });
});

describe('getChannelSchedule', () => {
  const now = Date.parse('2026-10-31T20:00:00Z');
  const programme = (id: string, start: string, end: string) => ({
    Id: id,
    ChannelId: 'ch-1',
    Name: id,
    StartDate: start,
    EndDate: end,
  });

  it('asks for what is still on and returns now and next', async () => {
    const calls = mockFetch(() => ({
      Items: [
        programme('now', '2026-10-31T19:30:00Z', '2026-10-31T20:30:00Z'),
        programme('next', '2026-10-31T20:30:00Z', '2026-10-31T21:00:00Z'),
      ],
    }));

    const schedule = await getChannelSchedule(session, 'ch-1', now);

    expect(calls[0].pathname).toBe('/LiveTv/Programs');
    expect(calls[0].searchParams.get('ChannelIds')).toBe('ch-1');
    expect(calls[0].searchParams.get('MinEndDate')).toBe(
      new Date(now).toISOString(),
    );
    expect(calls[0].searchParams.get('Limit')).toBe('2');
    expect(schedule.current?.id).toBe('now');
    expect(schedule.next?.id).toBe('next');
  });

  it('treats a programme that has not started yet as next', async () => {
    mockFetch(() => ({
      Items: [
        programme('later', '2026-10-31T20:15:00Z', '2026-10-31T21:00:00Z'),
      ],
    }));

    const schedule = await getChannelSchedule(session, 'ch-1', now);

    expect(schedule.current).toBeUndefined();
    expect(schedule.next?.id).toBe('later');
  });
});

describe('closeLiveStream', () => {
  it('posts the stream id to the server once', async () => {
    const calls: Array<{url: URL; method?: string}> = [];
    global.fetch = jest.fn(async (url: string, options: {method?: string}) => {
      calls.push({url: new URL(url), method: options.method});
      return {ok: true, status: 204, text: async () => ''};
    }) as unknown as typeof fetch;

    await closeLiveStream(session, 'live-1');

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.pathname).toBe('/LiveStreams/Close');
    expect(calls[0].url.searchParams.get('liveStreamId')).toBe('live-1');
  });
});

describe('neighbourChannel', () => {
  const channels = ['a', 'b', 'c'].map(
    (id): LiveTvChannel => ({id, name: id, isFavorite: false}),
  );

  it('steps up and down through the list', () => {
    expect(neighbourChannel(channels, 'b', 1)?.id).toBe('c');
    expect(neighbourChannel(channels, 'b', -1)?.id).toBe('a');
  });

  it('wraps round at either end', () => {
    expect(neighbourChannel(channels, 'c', 1)?.id).toBe('a');
    expect(neighbourChannel(channels, 'a', -1)?.id).toBe('c');
  });

  it('has nowhere to go for an unknown or only channel', () => {
    expect(neighbourChannel(channels, 'z', 1)).toBeUndefined();
    expect(neighbourChannel(channels.slice(0, 1), 'a', 1)).toBeUndefined();
  });
});

describe('liveChannelItem', () => {
  it('marks the item as a channel so the player plays it live', () => {
    expect(
      liveChannelItem({id: 'ch-1', name: 'News', isFavorite: false}),
    ).toEqual(expect.objectContaining({id: 'ch-1', type: 'TvChannel'}));
  });
});

describe('isLiveItem', () => {
  it('treats Live TV channels and tagged plugin streams as live', () => {
    expect(isLiveItem({type: 'TvChannel'})).toBe(true);
    expect(isLiveItem({type: 'Video', tags: ['LiveStream']})).toBe(true);
  });

  it('leaves an ordinary video alone', () => {
    expect(isLiveItem({type: 'Video'})).toBe(false);
    expect(isLiveItem({type: 'Video', tags: ['clip']})).toBe(false);
  });

  it('tells a plugin stream from a Live TV channel', () => {
    expect(isPluginLiveItem({type: 'Video', tags: ['livestream']})).toBe(true);
    expect(isPluginLiveItem({type: 'TvChannel'})).toBe(false);
    expect(isPluginLiveItem({type: 'Video'})).toBe(false);
  });
});

describe('getLatestItemsInLibrary', () => {
  it('drops the folders a channel plugin view returns despite IsFolder', async () => {
    const calls = mockFetch(() => ({
      Items: [
        {Id: 'v-1', Name: 'Pluto TV Cars', Type: 'Video', Tags: ['livestream']},
        {Id: 'f-1', Name: 'Live', Type: 'ChannelFolderItem', IsFolder: true},
      ],
    }));

    const items = await getLatestItemsInLibrary(
      session.serverUrl,
      session.accessToken,
      session.userId,
      'channel-1',
    );

    expect(items.map((item) => item.id)).toEqual(['v-1']);
    expect(items[0].tags).toEqual(['livestream']);
    expect(calls[0].searchParams.get('Fields')).toContain('Tags');
  });
});

describe('getGuidePrograms', () => {
  it('asks for the time range with overviews and groups by channel', async () => {
    const start = Date.parse('2026-10-31T18:00:00Z');
    const end = start + 6 * 60 * 60 * 1000;
    const calls = mockFetch(() => ({
      Items: [
        {
          Id: 'p-2',
          ChannelId: 'ch-1',
          Name: 'Cheers',
          Overview: 'Sam reopens the bar.',
          StartDate: '2026-10-31T18:30:00Z',
          EndDate: '2026-10-31T19:00:00Z',
        },
        {
          Id: 'p-1',
          ChannelId: 'ch-1',
          Name: 'Family Ties',
          StartDate: '2026-10-31T18:00:00Z',
          EndDate: '2026-10-31T18:30:00Z',
        },
        {
          Id: 'p-3',
          ChannelId: 'ch-2',
          Name: 'News',
          StartDate: '2026-10-31T18:00:00Z',
          EndDate: '2026-10-31T19:00:00Z',
        },
      ],
    }));

    const programs = await getGuidePrograms(
      session,
      ['ch-1', 'ch-2'],
      start,
      end,
    );

    const params = calls[0].searchParams;
    expect(calls[0].pathname).toBe('/LiveTv/Programs');
    expect(params.get('ChannelIds')).toBe('ch-1,ch-2');
    expect(params.get('MinEndDate')).toBe(new Date(start).toISOString());
    expect(params.get('MaxStartDate')).toBe(new Date(end).toISOString());
    expect(params.get('Fields')).toBe('Overview');
    expect(programs['ch-1'].map((program) => program.id)).toEqual([
      'p-2',
      'p-1',
    ]);
    expect(programs['ch-1'][0].overview).toBe('Sam reopens the bar.');
    expect(programs['ch-2']).toHaveLength(1);
  });

  it('does not ask the server about no channels', async () => {
    const calls = mockFetch(() => ({}));

    expect(await getGuidePrograms(session, [], 0, 1)).toEqual({});
    expect(calls).toHaveLength(0);
  });
});

describe('getOnNowPrograms', () => {
  it('asks for what is airing and pairs each programme with its channel', async () => {
    const calls = mockFetch(() => ({
      Items: [
        {
          Id: 'p-1',
          Name: 'Columbo',
          EpisodeTitle: 'Uneasy Lies the Crown',
          ChannelId: 'ch-1',
          ChannelName: 'Universal Crime',
          ChannelNumber: '120',
          ImageTags: {Primary: 'img-1'},
          StartDate: '2026-10-31T22:11:00.0000000Z',
          EndDate: '2026-10-31T23:58:00.0000000Z',
        },
        // No channel: nothing to tune to, so it is left out.
        {
          Id: 'p-2',
          Name: 'Orphan',
          StartDate: '2026-10-31T22:00:00.0000000Z',
          EndDate: '2026-10-31T23:00:00.0000000Z',
        },
      ],
    }));

    const programs = await getOnNowPrograms(session);

    expect(calls[0].pathname).toBe('/LiveTv/Programs/Recommended');
    expect(calls[0].searchParams.get('IsAiring')).toBe('true');
    expect(calls[0].searchParams.get('Fields')).toBe('ChannelInfo');
    expect(calls[0].searchParams.get('UserId')).toBe('user-1');
    expect(programs).toHaveLength(1);
    expect(programs[0]).toMatchObject({
      id: 'p-1',
      name: 'Columbo',
      episodeTitle: 'Uneasy Lies the Crown',
      channel: {id: 'ch-1', name: 'Universal Crime', number: '120'},
    });
    expect(programs[0].channel.current?.id).toBe('p-1');
    expect(programs[0].imageUrl).toContain('/Items/p-1/Images/Primary');
    expect(programs[0].channel.imageUrl).toContain(
      '/Items/ch-1/Images/Primary',
    );
  });

  it('leaves the image out when the programme has none', async () => {
    mockFetch(() => ({
      Items: [
        {
          Id: 'p-1',
          Name: 'News',
          ChannelId: 'ch-1',
          StartDate: '2026-10-31T22:00:00.0000000Z',
          EndDate: '2026-10-31T23:00:00.0000000Z',
        },
      ],
    }));

    const [program] = await getOnNowPrograms(session);

    expect(program.imageUrl).toBeUndefined();
  });
});

describe('recordings', () => {
  const mockRequests = (defaults: unknown = {}) => {
    const calls: {body?: string; method: string; url: URL}[] = [];

    global.fetch = jest.fn(
      async (url: string, init: {body?: string; method?: string} = {}) => {
        const parsed = new URL(url);
        calls.push({
          body: init.body,
          method: init.method ?? 'GET',
          url: parsed,
        });
        return {
          ok: true,
          status: parsed.pathname.endsWith('/Defaults') ? 200 : 204,
          text: async () =>
            parsed.pathname.endsWith('/Defaults')
              ? JSON.stringify(defaults)
              : '',
        };
      },
    ) as unknown as typeof fetch;

    return calls;
  };

  it('records an airing with the server defaults, sent back unchanged', async () => {
    const defaults = {PrePaddingSeconds: 60, ProgramId: 'p-1'};
    const calls = mockRequests(defaults);

    await recordProgram(session, 'p-1');

    expect(calls[0].url.pathname).toBe('/LiveTv/Timers/Defaults');
    expect(calls[0].url.searchParams.get('programId')).toBe('p-1');
    expect(calls[1].method).toBe('POST');
    expect(calls[1].url.pathname).toBe('/LiveTv/Timers');
    expect(JSON.parse(calls[1].body ?? '')).toEqual(defaults);
  });

  it('records a whole series through the series timers', async () => {
    const calls = mockRequests({ProgramId: 'p-1'});

    await recordProgram(session, 'p-1', true);

    expect(calls[1].method).toBe('POST');
    expect(calls[1].url.pathname).toBe('/LiveTv/SeriesTimers');
  });

  it('cancels an airing or a series', async () => {
    const calls = mockRequests();

    await cancelRecording(session, 't-1');
    await cancelSeriesRecording(session, 's-1');

    expect(calls.map((call) => `${call.method} ${call.url.pathname}`)).toEqual([
      'DELETE /LiveTv/Timers/t-1',
      'DELETE /LiveTv/SeriesTimers/s-1',
    ]);
  });

  it('allows recording only with the Live TV management permission', async () => {
    mockFetch(() => ({Policy: {EnableLiveTvManagement: false}}));
    await expect(canManageRecordings(session)).resolves.toBe(false);

    mockFetch(() => ({Policy: {EnableLiveTvManagement: true}}));
    await expect(canManageRecordings(session)).resolves.toBe(true);
  });

  it('reads whether a programme is set to record', () => {
    expect(
      mapProgram({
        Id: 'p-1',
        IsSeries: true,
        SeriesTimerId: 's-1',
        StartDate: '2026-11-01T01:00:00Z',
        EndDate: '2026-11-01T01:30:00Z',
        TimerId: 't-1',
      }),
    ).toMatchObject({isSeries: true, seriesTimerId: 's-1', timerId: 't-1'});
  });

  it('splits recordings still being made from finished ones, newest first', async () => {
    const calls = mockFetch(() => ({
      Items: [
        {
          Id: 'r-old',
          Name: 'Pilot',
          SeriesName: 'Cheers',
          DateCreated: '2026-10-30T02:00:00Z',
          Type: 'Episode',
          ImageTags: {Primary: 'img'},
        },
        {
          Id: 'r-now',
          Name: 'Sabrina',
          StartDate: '2026-11-01T01:30:00Z',
          EndDate: '2026-11-01T02:00:00Z',
          Status: 'InProgress',
          TimerId: 't-9',
          Type: 'Recording',
          ParentThumbItemId: 'series-1',
          ParentThumbImageTag: 'thumb',
        },
        {Name: 'No id'},
      ],
    }));

    const recordings = await getRecordings(session);

    expect(calls[0].pathname).toBe('/LiveTv/Recordings');
    expect(calls[0].searchParams.get('UserId')).toBe('user-1');
    expect(calls[0].searchParams.get('Fields')).toContain('DateCreated');
    // A page at a time, never the whole DVR in one response.
    expect(calls[0].searchParams.get('Limit')).toBe('100');
    expect(calls[0].searchParams.get('StartIndex')).toBe('0');
    expect(recordings.map((entry) => entry.id)).toEqual(['r-now', 'r-old']);
    expect(recordings[0]).toMatchObject({inProgress: true, timerId: 't-9'});
    expect(recordings[0].imageUrl).toContain('/Items/series-1/Images/Thumb');
    expect(recordings[1]).toMatchObject({
      episodeTitle: 'Pilot',
      inProgress: false,
      name: 'Cheers',
      startTime: Date.parse('2026-10-30T02:00:00Z'),
    });
    expect(recordings[1].imageUrl).toContain('/Items/r-old/Images/Primary');
    expect(recordings[1].item).toMatchObject({id: 'r-old'});
  });

  it('asks for a later page of recordings from where the last ended', async () => {
    const calls = mockFetch(() => ({Items: []}));

    await getRecordings(session, {limit: 50, startIndex: 200});

    expect(calls[0].searchParams.get('Limit')).toBe('50');
    expect(calls[0].searchParams.get('StartIndex')).toBe('200');
  });

  it('lists only airings still to come as scheduled, soonest first', async () => {
    mockFetch(() => ({
      Items: [
        {
          Id: 't-2',
          Name: 'Later',
          Status: 'New',
          StartDate: '2026-11-02T01:00:00Z',
          EndDate: '2026-11-02T01:30:00Z',
          SeriesTimerId: 's-1',
        },
        {
          Id: 't-1',
          Name: 'Sooner',
          Status: 'New',
          StartDate: '2026-11-01T01:00:00Z',
          EndDate: '2026-11-01T01:30:00Z',
          ProgramInfo: {Id: 'p-1', ImageTags: {Primary: 'img'}},
        },
        {
          Id: 't-0',
          Name: 'Recording now',
          Status: 'InProgress',
          StartDate: '2026-10-31T01:00:00Z',
          EndDate: '2026-10-31T01:30:00Z',
        },
      ],
    }));

    const scheduled = await getScheduledRecordings(session);

    expect(scheduled.map((entry) => entry.id)).toEqual(['t-1', 't-2']);
    expect(scheduled[0].imageUrl).toContain('/Items/p-1/Images/Primary');
    expect(scheduled[1].seriesTimerId).toBe('s-1');
  });

  it('lists series recordings with their rules', async () => {
    mockFetch(() => ({
      Items: [
        {
          Id: 's-1',
          Name: 'Cheers',
          RecordAnyChannel: true,
          RecordNewOnly: false,
          ParentPrimaryImageItemId: 'series-1',
          ParentPrimaryImageTag: 'img',
        },
      ],
    }));

    const [series] = await getSeriesRecordings(session);

    expect(series).toMatchObject({
      id: 's-1',
      name: 'Cheers',
      recordAnyChannel: true,
      recordNewOnly: false,
    });
    expect(series.imageUrl).toContain('/Items/series-1/Images/Primary');
  });

  it('deletes a recording as an item', async () => {
    const calls = mockRequests();

    await deleteRecording(session, 'r-1');

    expect(`${calls[0].method} ${calls[0].url.pathname}`).toBe(
      'DELETE /Items/r-1',
    );
  });
});
