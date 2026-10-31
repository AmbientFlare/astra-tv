/**
 * A live stream from a channel plugin opens the ordinary detail page. It
 * never finishes, so the page must not offer to mark it watched.
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
}));

const profile: ServerProfile = {
  accessToken: 'token-123',
  id: 'server:user',
  lastUsed: 1,
  name: 'Test Server',
  serverType: 'jellyfin',
  serverUrl: 'https://media.example.com',
  userId: 'user-1',
};

const settle = async () => {
  await act(async () => {
    for (let turn = 0; turn < 8; turn += 1) {
      await Promise.resolve();
    }
  });
};

const open = async (item: JellyfinMediaItem) => {
  (getItemDetails as jest.Mock).mockResolvedValue(item);
  const screen = render(
    <ItemDetailScreen item={item} serverProfile={profile} />,
  );
  await settle();
  return screen;
};

beforeEach(() => {
  jest.resetAllMocks();
  (getEpisodes as jest.Mock).mockResolvedValue([]);
  (getSeasons as jest.Mock).mockResolvedValue([]);
  (getSimilarItems as jest.Mock).mockResolvedValue([]);
});

describe('the Watched button on a detail page', () => {
  it('is hidden for a live plugin stream', async () => {
    const screen = await open({
      id: 'live-1',
      name: 'A Live Channel',
      type: 'Video',
      tags: ['LiveStream'],
    } as JellyfinMediaItem);

    expect(screen.getByTestId('item-detail-screen')).toBeTruthy();
    expect(screen.queryByTestId('detail-watched-button')).toBeNull();
  });

  it('stays for an on-demand clip', async () => {
    const screen = await open({
      id: 'clip-1',
      name: 'A Clip',
      type: 'Video',
    } as JellyfinMediaItem);

    expect(screen.getByTestId('detail-watched-button')).toBeTruthy();
  });
});
