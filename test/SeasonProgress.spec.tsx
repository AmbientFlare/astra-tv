/**
 * Issue #28: after an episode, show how much of the season is left, so the
 * viewer can decide whether to watch another. Next Up cards carry the
 * season's unwatched count, and the episode page lists the rest of the season.
 */
jest.mock('../src/services/deviceIdentity', () => ({
  initializeDeviceIdentity: jest.fn(async () => 'test-installation'),
  getDeviceId: () => 'test-installation',
}));

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

import 'react-native';
import {act, render} from '@testing-library/react-native';
import React from 'react';

import {EpisodeDetailScreen} from '../src/screens/EpisodeDetailScreen';
import * as jellyfin from '../src/services/jellyfin';
import {getNextUp, JellyfinMediaItem} from '../src/services/jellyfin';
import {ServerProfile} from '../src/services/storage';

const profile: ServerProfile = {
  accessToken: 'token-123',
  id: 'server:user',
  lastUsed: 1,
  name: 'Test Server',
  serverType: 'jellyfin',
  serverUrl: 'https://media.example.com',
  userId: 'user-1',
};

const respond = (body: unknown) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(body),
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('getNextUp', () => {
  it("adds each season's unwatched count from one season request", async () => {
    const calls: string[] = [];

    global.fetch = jest.fn(async (url: string) => {
      calls.push(url);

      if (url.includes('/Shows/NextUp')) {
        return respond({
          Items: [
            {Id: 'e1', Name: 'One', Type: 'Episode', SeasonId: 's1'},
            {Id: 'e2', Name: 'Two', Type: 'Episode', SeasonId: 's2'},
            {Id: 'e3', Name: 'Three', Type: 'Episode', SeasonId: 's1'},
          ],
        });
      }

      return respond({
        Items: [
          {Id: 's1', Type: 'Season', UserData: {UnplayedItemCount: 9}},
          {Id: 's2', Type: 'Season', UserData: {UnplayedItemCount: 1}},
        ],
      });
    }) as unknown as typeof fetch;

    const items = await getNextUp(profile.serverUrl, 'token-123', 'user-1');

    expect(calls).toHaveLength(2);
    expect(decodeURIComponent(calls[1])).toContain('Ids=s1,s2');
    expect(items.map((item) => item.seasonUnplayedCount)).toEqual([9, 1, 9]);
  });

  it('skips the season request when nothing is up next', async () => {
    // An empty Ids filter would return the user's root folders instead.
    const calls: string[] = [];

    global.fetch = jest.fn(async (url: string) => {
      calls.push(url);
      return respond({Items: []});
    }) as unknown as typeof fetch;

    await expect(
      getNextUp(profile.serverUrl, 'token-123', 'user-1'),
    ).resolves.toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('still returns the row when the season request fails', async () => {
    global.fetch = jest.fn(async (url: string) =>
      url.includes('/Shows/NextUp')
        ? respond({
            Items: [{Id: 'e1', Name: 'One', Type: 'Episode', SeasonId: 's1'}],
          })
        : {ok: false, status: 500, text: async () => 'boom'},
    ) as unknown as typeof fetch;

    const items = await getNextUp(profile.serverUrl, 'token-123', 'user-1');

    expect(items.map((item) => item.id)).toEqual(['e1']);
    expect(items[0].seasonUnplayedCount).toBeUndefined();
  });
});

describe('EpisodeDetailScreen season progress', () => {
  const episode = (index: number, isPlayed: boolean): JellyfinMediaItem => ({
    id: `e${index}`,
    indexNumber: index,
    isPlayed,
    name: `Episode name ${index}`,
    parentId: 'season-1',
    parentIndexNumber: 1,
    seriesId: 'series-1',
    type: 'Episode',
  });

  const settle = async () => {
    await act(async () => {
      for (let turn = 0; turn < 8; turn += 1) {
        await Promise.resolve();
      }
    });
  };

  const renderAt = async (current: JellyfinMediaItem) => {
    jest
      .spyOn(jellyfin, 'getItemDetails')
      .mockImplementation(async (_url, _token, _user, id) =>
        id === current.id
          ? current
          : ({id, name: 'The Show', type: 'Series'} as JellyfinMediaItem),
      );
    jest
      .spyOn(jellyfin, 'getEpisodes')
      .mockResolvedValue([
        episode(1, true),
        episode(2, true),
        episode(3, false),
        episode(4, true),
        episode(5, false),
      ]);

    const screen = render(
      <EpisodeDetailScreen item={current} serverProfile={profile} />,
    );
    await settle();
    return screen;
  };

  it('counts what is still unwatched and lists the rest of the season', async () => {
    const screen = await renderAt(episode(3, false));

    expect(screen.getByText(/2 unwatched in season/)).toBeTruthy();
    expect(screen.getByText('Rest of the Season (2)')).toBeTruthy();
    expect(screen.getByTestId('media-card-Episode name 4')).toBeTruthy();
    expect(screen.getByText('Episode 4 · Watched')).toBeTruthy();
    expect(screen.getByTestId('media-card-Episode name 5')).toBeTruthy();
    expect(screen.queryByTestId('media-card-Episode name 2')).toBeNull();
  });

  it('keeps the single-card heading for the last episode but one', async () => {
    const screen = await renderAt(episode(4, true));

    expect(screen.getByText('Next Episode')).toBeTruthy();
    expect(screen.getByText(/2 unwatched in season/)).toBeTruthy();
  });

  it('says so when the season is done', async () => {
    jest
      .spyOn(jellyfin, 'getItemDetails')
      .mockImplementation(async (_url, _token, _user, id) =>
        id === 'e2'
          ? episode(2, true)
          : ({id, name: 'The Show', type: 'Series'} as JellyfinMediaItem),
      );
    jest
      .spyOn(jellyfin, 'getEpisodes')
      .mockResolvedValue([episode(1, true), episode(2, true)]);

    const screen = render(
      <EpisodeDetailScreen item={episode(2, true)} serverProfile={profile} />,
    );
    await settle();

    expect(screen.getByText(/Season watched/)).toBeTruthy();
    expect(screen.queryByText('Next Episode')).toBeNull();
  });
});
