import {getAdjacentEpisodes, getMediaSegments} from '../src/services/jellyfin';
import {
  createCountdown,
  decideEndOfPlayback,
  findCreditsWindow,
  isInsideWindow,
  MAX_CONSECUTIVE_AUTO_ADVANCES,
  nextAutoAdvanceCount,
  resolveNextEpisode,
} from '../src/services/episodePlayback';
import type {JellyfinMediaItem} from '../src/services/jellyfin';

const originalFetch = global.fetch;

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });

afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

describe('media segments', () => {
  it('requests Outro segments and drops ranges that do not run forward', async () => {
    let requestedUrl = '';
    global.fetch = jest.fn((url: string) => {
      requestedUrl = url;
      return jsonResponse({
        Items: [
          {Id: 'outro-1', StartTicks: 800, EndTicks: 1000, Type: 'Outro'},
          {Id: 'bad', StartTicks: 1200, EndTicks: 1100, Type: 'Outro'},
          {Id: 'no-end', StartTicks: 1200, Type: 'Outro'},
        ],
      });
    }) as unknown as typeof fetch;

    await expect(
      getMediaSegments('https://media.example.com', 'token', 'episode-1'),
    ).resolves.toEqual([
      {endTicks: 1000, id: 'outro-1', startTicks: 800, type: 'Outro'},
    ]);

    const url = new URL(requestedUrl);
    expect(url.pathname).toBe('/MediaSegments/episode-1');
    expect(url.searchParams.get('IncludeSegmentTypes')).toBe('Outro');
  });

  it('treats a server without the endpoint as having no segments', async () => {
    global.fetch = jest.fn(() =>
      jsonResponse({}, 404),
    ) as unknown as typeof fetch;

    await expect(
      getMediaSegments('https://media.example.com', 'token', 'episode-1'),
    ).resolves.toEqual([]);
  });

  it('still surfaces other server failures', async () => {
    global.fetch = jest.fn(() =>
      jsonResponse({}, 500),
    ) as unknown as typeof fetch;

    await expect(
      getMediaSegments('https://media.example.com', 'token', 'episode-1'),
    ).rejects.toThrow('Server request failed 500');
  });
});

describe('adjacent episodes', () => {
  it('asks the series episode list for the neighbours of one episode', async () => {
    let requestedUrl = '';
    global.fetch = jest.fn((url: string) => {
      requestedUrl = url;
      return jsonResponse({
        Items: [
          {Id: 'e1', Name: 'One', Type: 'Episode', SeriesId: 's1'},
          {Id: 'e2', Name: 'Two', Type: 'Episode', SeriesId: 's1'},
        ],
      });
    }) as unknown as typeof fetch;

    const items = await getAdjacentEpisodes(
      'https://media.example.com',
      'token',
      'user-1',
      's1',
      'e1',
    );

    expect(items.map((item) => item.id)).toEqual(['e1', 'e2']);
    const url = new URL(requestedUrl);
    expect(url.pathname).toBe('/Shows/s1/Episodes');
    expect(url.searchParams.get('AdjacentTo')).toBe('e1');
    expect(url.searchParams.get('UserId')).toBe('user-1');
  });
});

describe('the credits window', () => {
  const chapters = [
    {name: 'Opening', startPositionTicks: 0},
    {name: 'Act Two', startPositionTicks: 5000},
    {name: 'End Credits', startPositionTicks: 9000},
  ];

  it('prefers the last Outro segment the server marked', () => {
    const window = findCreditsWindow(
      [
        {startTicks: 100, endTicks: 200, type: 'Intro'},
        {startTicks: 8000, endTicks: 9500, type: 'outro', id: 'a'},
        {startTicks: 9600, endTicks: 9900, type: 'Outro', id: 'b'},
      ],
      chapters,
      10000,
    );

    expect(window).toEqual({
      endTicks: 9900,
      key: 'segment:b',
      source: 'segment',
      startTicks: 9600,
    });
  });

  it('falls back to a chapter named credits, ending at the runtime', () => {
    expect(findCreditsWindow([], chapters, 10000)).toEqual({
      endTicks: 10000,
      key: 'chapter:9000',
      source: 'chapter',
      startTicks: 9000,
    });
  });

  it('ends a credits chapter at the following chapter when one exists', () => {
    const withScene = [
      ...chapters,
      {name: 'Post-credits scene', startPositionTicks: 9800},
    ];

    expect(findCreditsWindow([], withScene, 10000)).toMatchObject({
      endTicks: 9800,
      startTicks: 9000,
    });
  });

  it('does not mistake a post-credits scene for the credits', () => {
    expect(
      findCreditsWindow(
        [],
        [
          {name: 'Opening', startPositionTicks: 0},
          {name: 'Post-Credits Scene', startPositionTicks: 9800},
        ],
        10000,
      ),
    ).toBeNull();
  });

  it('does not match chapters that merely mention the word elsewhere', () => {
    expect(
      findCreditsWindow(
        [],
        [{name: 'Credits roll early', startPositionTicks: 100}],
        10000,
      ),
    ).toMatchObject({startTicks: 100});
    expect(
      findCreditsWindow(
        [],
        [{name: 'Discredited', startPositionTicks: 100}],
        10000,
      ),
    ).toBeNull();
  });

  it('offers nothing without segments, credits chapters, or a usable runtime', () => {
    expect(findCreditsWindow([], undefined, 10000)).toBeNull();
    expect(findCreditsWindow([], chapters.slice(0, 2), 10000)).toBeNull();
    expect(findCreditsWindow([], chapters, undefined)).toBeNull();
    expect(findCreditsWindow([], chapters, 9000)).toBeNull();
  });

  it('is inside only from the start up to, not including, the end', () => {
    const window = {startTicks: 800, endTicks: 1000};

    expect(isInsideWindow(window, 799)).toBe(false);
    expect(isInsideWindow(window, 800)).toBe(true);
    expect(isInsideWindow(window, 999)).toBe(true);
    expect(isInsideWindow(window, 1000)).toBe(false);
    expect(isInsideWindow(null, 900)).toBe(false);
  });
});

describe('the next episode', () => {
  const episode = (
    id: string,
    overrides: Partial<JellyfinMediaItem> = {},
  ): JellyfinMediaItem =>
    ({
      id,
      name: id,
      seriesId: 's1',
      type: 'Episode',
      ...overrides,
    } as JellyfinMediaItem);

  it('is the item after the current one in server order, across seasons', () => {
    const next = resolveNextEpisode(
      [
        episode('s1e9', {parentIndexNumber: 1, indexNumber: 9}),
        episode('s1e10', {parentIndexNumber: 1, indexNumber: 10}),
        episode('s2e1', {parentIndexNumber: 2, indexNumber: 1}),
      ],
      {id: 's1e10', seriesId: 's1'},
    );

    expect(next?.id).toBe('s2e1');
  });

  it('skips another copy of the same episode number', () => {
    const next = resolveNextEpisode(
      [
        episode('e1-1080p', {parentIndexNumber: 1, indexNumber: 1}),
        episode('e1-4k', {parentIndexNumber: 1, indexNumber: 1}),
        episode('e2', {parentIndexNumber: 1, indexNumber: 2}),
      ],
      {id: 'e1-1080p', seriesId: 's1', parentIndexNumber: 1, indexNumber: 1},
    );

    expect(next?.id).toBe('e2');
    expect(
      resolveNextEpisode(
        [
          episode('e1-1080p', {parentIndexNumber: 1, indexNumber: 1}),
          episode('e1-4k', {parentIndexNumber: 1, indexNumber: 1}),
        ],
        {id: 'e1-1080p', seriesId: 's1', parentIndexNumber: 1, indexNumber: 1},
      ),
    ).toBeNull();
  });

  it('is missing for the last episode and never wraps around', () => {
    expect(
      resolveNextEpisode([episode('a'), episode('b')], {
        id: 'b',
        seriesId: 's1',
      }),
    ).toBeNull();
  });

  it('never crosses into another series or a non-episode item', () => {
    expect(
      resolveNextEpisode([episode('a'), episode('other', {seriesId: 's2'})], {
        id: 'a',
        seriesId: 's1',
      }),
    ).toBeNull();
    expect(
      resolveNextEpisode(
        [episode('a'), episode('trailer', {type: 'Trailer'}), episode('c')],
        {id: 'a', seriesId: 's1'},
      )?.id,
    ).toBe('c');
  });

  it('is missing when the current item is not an episode of a series', () => {
    expect(
      resolveNextEpisode([episode('a'), episode('b')], {
        id: 'a',
        seriesId: undefined,
      }),
    ).toBeNull();
    expect(
      resolveNextEpisode([episode('a'), episode('b')], {
        id: 'zzz',
        seriesId: 's1',
      }),
    ).toBeNull();
  });
});

describe('what happens when a video ends', () => {
  it('always finishes a movie, even with autoplay on', () => {
    expect(
      decideEndOfPlayback({
        autoplayEnabled: true,
        consecutiveAutoAdvances: 0,
        hasNextEpisode: true,
        itemType: 'Movie',
      }),
    ).toBe('finished');
  });

  it('finishes an episode with no next episode', () => {
    expect(
      decideEndOfPlayback({
        autoplayEnabled: true,
        consecutiveAutoAdvances: 0,
        hasNextEpisode: false,
        itemType: 'Episode',
      }),
    ).toBe('finished');
  });

  it('counts down for an episode while autoplay is on and under the cap', () => {
    for (let count = 0; count < MAX_CONSECUTIVE_AUTO_ADVANCES; count += 1) {
      expect(
        decideEndOfPlayback({
          autoplayEnabled: true,
          consecutiveAutoAdvances: count,
          hasNextEpisode: true,
          itemType: 'Episode',
        }),
      ).toBe('countdown');
    }
  });

  it('asks after two unattended advances, and whenever autoplay is off', () => {
    // The viewer's own episode plus two automatic ones: three in total.
    expect(MAX_CONSECUTIVE_AUTO_ADVANCES).toBe(2);
    expect(
      decideEndOfPlayback({
        autoplayEnabled: true,
        consecutiveAutoAdvances: 2,
        hasNextEpisode: true,
        itemType: 'Episode',
      }),
    ).toBe('confirm');
    expect(
      decideEndOfPlayback({
        autoplayEnabled: false,
        consecutiveAutoAdvances: 0,
        hasNextEpisode: true,
        itemType: 'Episode',
      }),
    ).toBe('confirm');
  });

  it('counts automatic advances and resets on a manual one', () => {
    expect(nextAutoAdvanceCount(0, true)).toBe(1);
    expect(nextAutoAdvanceCount(2, true)).toBe(3);
    expect(nextAutoAdvanceCount(3, false)).toBe(0);
    expect(nextAutoAdvanceCount(-5, true)).toBe(1);
  });

  it('walks through the cap: two automatic advances, then confirmation', () => {
    let count = 0;
    const actions: string[] = [];
    for (let episodeEnd = 0; episodeEnd < 4; episodeEnd += 1) {
      const action = decideEndOfPlayback({
        autoplayEnabled: true,
        consecutiveAutoAdvances: count,
        hasNextEpisode: true,
        itemType: 'Episode',
      });
      actions.push(action);
      count = nextAutoAdvanceCount(count, action === 'countdown');
    }

    // Two automatic advances, then a question. Answering it (the count
    // reset below) starts a fresh run, so the following end counts down again.
    expect(actions).toEqual(['countdown', 'countdown', 'confirm', 'countdown']);
    // The viewer pressed Continue: the next episode starts a fresh run.
    expect(nextAutoAdvanceCount(count, false)).toBe(0);
  });
});

describe('the countdown', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  it('ticks every second and fires once at zero', () => {
    const ticks: number[] = [];
    const onExpire = jest.fn();

    createCountdown({
      onExpire,
      onTick: (value) => ticks.push(value),
      seconds: 3,
    });
    jest.advanceTimersByTime(3000);
    jest.advanceTimersByTime(5000);

    expect(ticks).toEqual([3, 2, 1]);
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it('never fires after being cancelled', () => {
    const onExpire = jest.fn();
    const countdown = createCountdown({
      onExpire,
      onTick: jest.fn(),
      seconds: 3,
    });

    jest.advanceTimersByTime(1000);
    countdown.cancel();
    countdown.cancel();
    jest.advanceTimersByTime(10000);

    expect(onExpire).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
  });

  it('fires immediately for a zero-second countdown', () => {
    const onExpire = jest.fn();

    createCountdown({onExpire, onTick: jest.fn(), seconds: 0});

    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
