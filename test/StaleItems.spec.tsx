/**
 * Regression tests for items that vanish server-side.
 *
 * A library scan that misses a change leaves the app holding an id the server
 * no longer knows. Opening it must land on an error state with a way out, not
 * a crash or a blank screen.
 */
import 'react-native';
import {act, fireEvent, render} from '@testing-library/react-native';
import React from 'react';

import {EpisodeDetailScreen} from '../src/screens/EpisodeDetailScreen';
import {ItemDetailScreen} from '../src/screens/ItemDetailScreen';
import {
  getEpisodes,
  getItemDetails,
  getSeasons,
  getSimilarItems,
  isMissingItemError,
  JellyfinMediaItem,
  ServerResponseError,
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
}));

const MISSING = 'This item is no longer on the server.';

const profile: ServerProfile = {
  accessToken: 'token-123',
  id: 'server:user',
  lastUsed: 1,
  name: 'Test Server',
  serverType: 'jellyfin',
  serverUrl: 'https://media.example.com',
  userId: 'user-1',
};

const movie = {
  id: 'movie-1',
  name: 'A Film',
  type: 'Movie',
} as JellyfinMediaItem;

const episodeItem = {
  id: 'episode-1',
  name: 'An Episode',
  type: 'Episode',
  seriesId: 'series-1',
  parentId: 'season-1',
} as JellyfinMediaItem;

const mockedDetails = getItemDetails as jest.MockedFunction<
  typeof getItemDetails
>;

const settle = async () => {
  await act(async () => {
    for (let turn = 0; turn < 8; turn += 1) {
      await Promise.resolve();
    }
  });
};

beforeEach(() => {
  // reset, so no one-shot leaks between tests; the collection loaders are
  // re-established because the screens read .length off whatever they return.
  jest.resetAllMocks();
  (getEpisodes as jest.Mock).mockResolvedValue([]);
  (getSeasons as jest.Mock).mockResolvedValue([]);
  (getSimilarItems as jest.Mock).mockResolvedValue([]);
});

describe('isMissingItemError', () => {
  it('recognises the statuses a removed item produces', () => {
    expect(isMissingItemError(new ServerResponseError('gone', 404))).toBe(true);
    expect(isMissingItemError(new ServerResponseError('bad id', 400))).toBe(
      true,
    );
  });

  it('leaves other failures to report themselves', () => {
    expect(isMissingItemError(new ServerResponseError('denied', 401))).toBe(
      false,
    );
    expect(isMissingItemError(new ServerResponseError('broken', 500))).toBe(
      false,
    );
    expect(isMissingItemError(new Error('network down'))).toBe(false);
  });
});

describe('an item removed between the list and the detail request', () => {
  it('shows the detail screen error state rather than crashing', async () => {
    mockedDetails.mockRejectedValue(
      new ServerResponseError('Server request failed 404: /Items/movie-1', 404),
    );

    const screen = render(
      <ItemDetailScreen item={movie} serverProfile={profile} />,
    );
    await settle();

    expect(screen.getByTestId('item-detail-screen')).toBeTruthy();
    expect(screen.getByText(MISSING)).toBeTruthy();
    // The item passed in is still rendered, so the screen is readable.
    expect(screen.getAllByText('A Film').length).toBeGreaterThan(0);
  });

  it('recovers when the retry succeeds', async () => {
    mockedDetails.mockRejectedValueOnce(
      new ServerResponseError('Server request failed 404: /Items/movie-1', 404),
    );

    const screen = render(
      <ItemDetailScreen item={movie} serverProfile={profile} />,
    );
    await settle();

    mockedDetails.mockResolvedValue({...movie, overview: 'Back again.'});
    fireEvent.press(screen.getByTestId('detail-status-retry'));
    await settle();

    expect(screen.queryByText(MISSING)).toBeNull();
    expect(screen.getByText('Back again.')).toBeTruthy();
  });

  it('shows the episode screen error state rather than crashing', async () => {
    mockedDetails.mockRejectedValue(
      new ServerResponseError(
        'Server request failed 404: /Items/episode-1',
        404,
      ),
    );

    const screen = render(
      <EpisodeDetailScreen item={episodeItem} serverProfile={profile} />,
    );
    await settle();

    expect(screen.getByTestId('episode-detail-screen')).toBeTruthy();
    expect(screen.getByText(MISSING)).toBeTruthy();
  });

  it('still reports a failure that is not a missing item', async () => {
    mockedDetails.mockRejectedValue(
      new ServerResponseError('Server request failed 500: /Items/movie-1', 500),
    );

    const screen = render(
      <ItemDetailScreen item={movie} serverProfile={profile} />,
    );
    await settle();

    expect(screen.queryByText(MISSING)).toBeNull();
    expect(
      screen.getByText('Server request failed 500: /Items/movie-1'),
    ).toBeTruthy();
  });
});
