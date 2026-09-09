/**
 * Regression tests for the automatic season re-fetch.
 *
 * The re-fetch exists because some servers build a series' season tree while
 * a client browses it. Two things must stay true: a slow first request must
 * not cause a second one to pile up behind it, and a series that is genuinely
 * empty must stop asking rather than poll forever.
 */
import 'react-native';
import {act, render} from '@testing-library/react-native';
import React from 'react';

import {ItemDetailScreen} from '../src/screens/ItemDetailScreen';
import {
  getEpisodes,
  getItemDetails,
  getSeasons,
  getSimilarItems,
  JellyfinMediaItem,
} from '../src/services/jellyfin';
import {ServerProfile} from '../src/services/storage';

jest.mock('@amazon-devices/react-native-kepler', () => {
  const MockReact = require('react');
  const {View} = require('react-native');

  return {
    TVFocusGuideView: (props: Record<string, unknown>) =>
      MockReact.createElement(View, props),
  };
});

jest.mock('../src/components/FocusableItem', () => {
  const MockReact = require('react');
  const {View} = require('react-native');

  return {
    FocusableItem: ({
      children,
      focusedStyle: _focusedStyle,
      hasTVPreferredFocus: _hasTVPreferredFocus,
      ...props
    }: Record<string, unknown>) =>
      MockReact.createElement(View, props, children),
  };
});

jest.mock('../src/services/jellyfin', () => ({
  ...jest.requireActual('../src/services/jellyfin'),
  getEpisodes: jest.fn(async () => []),
  getItemDetails: jest.fn(),
  getSeasons: jest.fn(async () => []),
  getSimilarItems: jest.fn(async () => []),
  setFavorite: jest.fn(async () => undefined),
  setPlayed: jest.fn(async () => undefined),
}));

const RETRY_MS = 1200;

const profile: ServerProfile = {
  id: 'server:user',
  name: 'Test Server',
  serverType: 'jellyfin',
  serverUrl: 'https://media.example.com',
  username: 'viewer',
  userId: 'user-1',
  accessToken: 'token-123',
  lastUsed: 0,
};

const series = (overrides: Partial<JellyfinMediaItem> = {}) =>
  ({
    id: 'series-1',
    name: 'A Show',
    type: 'Series',
    ...overrides,
  } as JellyfinMediaItem);

const season = (id: string, childCount: number | null) =>
  ({
    id,
    name: `Season ${id}`,
    type: 'Season',
    childCount,
    seriesId: 'series-1',
  } as JellyfinMediaItem);

const episode = (id: string) =>
  ({
    id,
    name: `Episode ${id}`,
    type: 'Episode',
    seriesId: 'series-1',
  } as JellyfinMediaItem);

const mockedSeasons = getSeasons as jest.MockedFunction<typeof getSeasons>;
const mockedEpisodes = getEpisodes as jest.MockedFunction<typeof getEpisodes>;
const mockedDetails = getItemDetails as jest.MockedFunction<
  typeof getItemDetails
>;
const mockedSimilar = getSimilarItems as jest.MockedFunction<
  typeof getSimilarItems
>;

const renderSeries = () =>
  render(<ItemDetailScreen item={series()} serverProfile={profile} />);

beforeEach(() => {
  // reset rather than clear: a mockResolvedValueOnce left unconsumed by one
  // test would otherwise answer the next test's first request.
  jest.resetAllMocks();
  // Legacy fake timers patch only the timer functions. The modern
  // implementation also fakes the microtask queue, which deadlocks the
  // promise flushing these tests depend on.
  jest.useFakeTimers({legacyFakeTimers: true});
  mockedDetails.mockResolvedValue(series());
  mockedSeasons.mockResolvedValue([]);
  mockedSimilar.mockResolvedValue([]);
  mockedEpisodes.mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

/** Lets pending promises settle without advancing the fake clock. */
const settle = async () => {
  await act(async () => {
    for (let turn = 0; turn < 8; turn += 1) {
      await Promise.resolve();
    }
  });
};

/** Fires the pending retry, if one is scheduled, and lets it complete. */
const tick = async () => {
  await act(async () => {
    jest.advanceTimersByTime(RETRY_MS);
  });
  await settle();
};

describe('a series whose tree the server is still building', () => {
  it('asks again once the first answer comes back empty', async () => {
    mockedSeasons
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([season('s1', 6)]);

    renderSeries();
    await settle();

    expect(mockedSeasons).toHaveBeenCalledTimes(1);

    await tick();

    expect(mockedSeasons).toHaveBeenCalledTimes(2);
  });

  it('treats a lone empty season as not yet built', async () => {
    mockedSeasons
      .mockResolvedValueOnce([season('s1', 0)])
      .mockResolvedValueOnce([season('s1', 10)]);

    renderSeries();
    await settle();

    await tick();

    expect(mockedSeasons).toHaveBeenCalledTimes(2);
  });
});

describe('a slow first request', () => {
  it('does not schedule a retry before the first answer arrives', async () => {
    let releaseFirst: (value: JellyfinMediaItem[]) => void = () => undefined;
    mockedSeasons.mockImplementationOnce(
      () =>
        new Promise<JellyfinMediaItem[]>((resolve) => {
          releaseFirst = resolve;
        }),
    );

    renderSeries();
    await settle();

    // Well past the retry delay, with the first request still in flight.
    await act(async () => {
      jest.advanceTimersByTime(RETRY_MS * 5);
    });
    await settle();

    expect(mockedSeasons).toHaveBeenCalledTimes(1);

    await act(async () => {
      releaseFirst([season('s1', 4)]);
    });
    await settle();

    // A complete answer ends it; no retry follows.
    await act(async () => {
      jest.advanceTimersByTime(RETRY_MS * 5);
    });
    await settle();

    expect(mockedSeasons).toHaveBeenCalledTimes(1);
  });
});

describe('a series that is genuinely empty', () => {
  it('stops after the capped number of retries instead of polling', async () => {
    mockedSeasons.mockResolvedValue([]);

    renderSeries();
    await settle();

    // Far more time than the retries could ever consume.
    for (let round = 0; round < 10; round += 1) {
      await tick();
    }

    // One initial request plus at most two automatic retries.
    expect(mockedSeasons).toHaveBeenCalledTimes(3);
  });

  it('falls back to the flat episode list when no season ever appears', async () => {
    mockedSeasons.mockResolvedValue([]);
    mockedEpisodes.mockResolvedValue([episode('e1')]);

    const screen = renderSeries();
    await settle();

    for (let round = 0; round < 4; round += 1) {
      await tick();
    }

    // Asked for every episode in the series, with no season id.
    expect(mockedEpisodes).toHaveBeenCalledWith(
      profile.serverUrl,
      profile.accessToken,
      profile.userId,
      'series-1',
    );
    expect(screen.getAllByText('Episode e1').length).toBeGreaterThan(0);
  });
});

describe('a complete series', () => {
  it('never schedules a retry', async () => {
    mockedSeasons.mockResolvedValue([season('s1', 8), season('s2', 8)]);

    renderSeries();
    await settle();

    await act(async () => {
      jest.advanceTimersByTime(RETRY_MS * 5);
    });
    await settle();

    expect(mockedSeasons).toHaveBeenCalledTimes(1);
  });
});
