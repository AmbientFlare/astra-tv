jest.mock('../src/services/deviceIdentity', () => ({
  initializeDeviceIdentity: jest.fn(async () => 'test-installation'),
  getDeviceId: () => 'test-installation',
}));

import {
  getAvailableLiveTvFilters,
  getLiveTvChannels,
  getNextPrograms,
  LiveTvSession,
  programProgress,
} from '../src/services/jellyfin/liveTv';

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
