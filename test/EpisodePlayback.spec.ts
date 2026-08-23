import {getMediaSegments, getNextEpisode} from '../src/services/jellyfin';
import {
  findActiveOutro,
  mediaSegmentKey,
  shouldAutoAdvanceEpisode,
} from '../src/services/episodePlayback';

const originalFetch = global.fetch;

const jsonResponse = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  });

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

describe('Jellyfin episode playback APIs', () => {
  it('requests Outro media segments and ignores invalid ranges', async () => {
    let requestedUrl = '';
    const fetchMock = jest.fn((url: string) => {
      requestedUrl = url;
      return jsonResponse({
        Items: [
          {Id: 'outro-1', StartTicks: 800, EndTicks: 1000, Type: 'Outro'},
          {Id: 'invalid', StartTicks: 1200, EndTicks: 1100, Type: 'Outro'},
        ],
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      getMediaSegments('https://media.example.com', 'token', 'episode-1'),
    ).resolves.toEqual([
      {id: 'outro-1', startTicks: 800, endTicks: 1000, type: 'Outro'},
    ]);

    const url = new URL(requestedUrl);
    expect(url.pathname).toBe('/MediaSegments/episode-1');
    expect(url.searchParams.get('IncludeSegmentTypes')).toBe('Outro');
  });

  it('resolves the next unwatched episode for the same series', async () => {
    let requestedUrl = '';
    const fetchMock = jest.fn((url: string) => {
      requestedUrl = url;
      return jsonResponse({
        Items: [
          {Id: 'episode-1', Name: 'Current', Type: 'Episode'},
          {Id: 'episode-2', Name: 'Next', Type: 'Episode'},
        ],
      });
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      getNextEpisode(
        'https://media.example.com',
        'token',
        'user-1',
        'series-1',
        'episode-1',
      ),
    ).resolves.toEqual(
      expect.objectContaining({id: 'episode-2', name: 'Next'}),
    );

    const url = new URL(requestedUrl);
    expect(url.pathname).toBe('/Shows/NextUp');
    expect(url.searchParams.get('UserId')).toBe('user-1');
    expect(url.searchParams.get('SeriesId')).toBe('series-1');
    expect(url.searchParams.get('EnableResumable')).toBe('false');
    expect(url.searchParams.get('Limit')).toBe('2');
  });
});

describe('episode playback decisions', () => {
  const outro = {
    endTicks: 1000,
    id: 'outro-1',
    startTicks: 800,
    type: 'Outro',
  };

  it('selects an Outro only inside its bounded range', () => {
    expect(findActiveOutro([outro], 799)).toBeNull();
    expect(findActiveOutro([outro], 800)).toBe(outro);
    expect(findActiveOutro([outro], 999)).toBe(outro);
    expect(findActiveOutro([outro], 1000)).toBeNull();
    expect(mediaSegmentKey(outro)).toBe('outro-1');
  });

  it('auto-advances only an enabled episode with series and user context', () => {
    expect(
      shouldAutoAdvanceEpisode({
        enabled: true,
        itemType: 'Episode',
        seriesId: 'series-1',
        userId: 'user-1',
      }),
    ).toBe(true);
    expect(
      shouldAutoAdvanceEpisode({
        enabled: true,
        itemType: 'Movie',
        seriesId: 'series-1',
        userId: 'user-1',
      }),
    ).toBe(false);
    expect(
      shouldAutoAdvanceEpisode({
        enabled: false,
        itemType: 'Episode',
        seriesId: 'series-1',
        userId: 'user-1',
      }),
    ).toBe(false);
  });
});
