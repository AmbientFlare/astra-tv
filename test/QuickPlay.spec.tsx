/**
 * Play on a library card starts the item without opening its details page,
 * and Stop on Now Playing ends the music instead of only pausing it.
 */
import 'react-native';
import {act, fireEvent, render} from '@testing-library/react-native';
import React from 'react';

import {
  LibraryScreen,
  resetLibrarySessions,
} from '../src/screens/LibraryScreen';
import {NowPlayingScreen} from '../src/screens/NowPlayingScreen';
import {audioPlayback} from '../src/services/audioPlayer';
import {
  getEpisodes,
  getItems,
  getSeriesNextUp,
  getSeriesResume,
  JellyfinMediaItem,
} from '../src/services/jellyfin';
import {resolveQuickPlay} from '../src/services/quickPlay';
import {ServerProfile} from '../src/services/storage';

const mockTvHandlers: Array<(event: Record<string, unknown>) => void> = [];

jest.mock('@amazon-devices/react-native-kepler', () => {
  const MockReact = require('react');
  const {View} = require('react-native');

  return {
    TVFocusGuideView: (props: Record<string, unknown>) =>
      MockReact.createElement(View, props),
    useTVEventHandler: (handler: (event: Record<string, unknown>) => void) => {
      mockTvHandlers.push(handler);
    },
  };
});

jest.mock('../src/components/FocusableItem', () => {
  const MockReact = require('react');
  const {View} = require('react-native');

  return {
    FocusableItem: ({
      children,
      focusedStyle: _focusedStyle,
      ...props
    }: Record<string, unknown>) =>
      MockReact.createElement(View, props, children),
  };
});

jest.mock('../src/services/audioPlayer', () => ({
  audioPlayback: {
    getStatus: jest.fn(() => ({track: null})),
    next: jest.fn(),
    skipPrevious: jest.fn(),
    stop: jest.fn(async () => undefined),
    subscribe: jest.fn(() => () => undefined),
    togglePlayPause: jest.fn(),
  },
}));

jest.mock('../src/services/storage', () => ({
  ...jest.requireActual('../src/services/storage'),
  getDisplayPreferences: jest.fn(async () => ({
    imageSize: 'medium',
    imageType: 'Primary',
  })),
  setDisplayPreferences: jest.fn(async () => undefined),
}));

jest.mock('../src/services/jellyfin', () => ({
  ...jest.requireActual('../src/services/jellyfin'),
  getEpisodes: jest.fn(async () => []),
  getItems: jest.fn(async () => []),
  getItemsPage: jest.fn(async (...args: any[]) => {
    const all = await jest
      .requireMock('../src/services/jellyfin')
      .getItems(...args);
    return {items: all, totalRecordCount: all.length};
  }),
  getItemDetails: jest.fn(async () => ({})),
  getSeriesNextUp: jest.fn(async () => null),
  getSeriesResume: jest.fn(async () => null),
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

const item = (id: string, type: string, extra = {}) =>
  ({id, name: id, type, ...extra} as JellyfinMediaItem);

const settle = async () => {
  await act(async () => {
    for (let turn = 0; turn < 8; turn += 1) {
      await Promise.resolve();
    }
  });
};

const pressKey = async (eventType: string) => {
  await act(async () => {
    mockTvHandlers[mockTvHandlers.length - 1]?.({eventType});
  });
  await settle();
};

beforeEach(() => {
  jest.clearAllMocks();
  mockTvHandlers.length = 0;
  resetLibrarySessions();
  (audioPlayback.getStatus as jest.Mock).mockReturnValue({track: null});
});

describe('resolveQuickPlay', () => {
  it('plays a movie or episode as it is, keeping its resume point', async () => {
    const movie = item('m1', 'Movie', {resumePositionTicks: 500});
    await expect(resolveQuickPlay(movie, profile)).resolves.toBe(movie);
    const episode = item('e1', 'Episode');
    await expect(resolveQuickPlay(episode, profile)).resolves.toBe(episode);
    expect(getSeriesNextUp).not.toHaveBeenCalled();
  });

  it('resumes the episode a series was left part-way through', async () => {
    const inProgress = item('s1e7', 'Episode', {resumePositionTicks: 4200});
    (getSeriesResume as jest.Mock).mockResolvedValueOnce(inProgress);

    await expect(resolveQuickPlay(item('s1', 'Series'), profile)).resolves.toBe(
      inProgress,
    );
    expect(getSeriesNextUp).not.toHaveBeenCalled();
  });

  it("plays a series' Next Up episode when none is in progress", async () => {
    const nextUp = item('s1e4', 'Episode', {resumePositionTicks: 900});
    (getSeriesNextUp as jest.Mock).mockResolvedValueOnce(nextUp);

    await expect(resolveQuickPlay(item('s1', 'Series'), profile)).resolves.toBe(
      nextUp,
    );
    expect(getSeriesNextUp).toHaveBeenCalledWith(
      profile.serverUrl,
      profile.accessToken,
      profile.userId,
      's1',
    );
    expect(getEpisodes).not.toHaveBeenCalled();
  });

  it('starts a series with no Next Up from its first episode', async () => {
    (getEpisodes as jest.Mock).mockResolvedValueOnce([
      item('s1e1', 'Episode', {resumePositionTicks: 300}),
      item('s1e2', 'Episode'),
    ]);

    await expect(
      resolveQuickPlay(item('s1', 'Series'), profile),
    ).resolves.toMatchObject({id: 's1e1', resumePositionTicks: 0});
  });

  it('leaves folders and empty series to open as usual', async () => {
    await expect(
      resolveQuickPlay(item('f1', 'BoxSet'), profile),
    ).resolves.toBeNull();
    await expect(
      resolveQuickPlay(item('s2', 'Series'), profile),
    ).resolves.toBeNull();
  });
});

describe('LibraryScreen quick play', () => {
  const renderLibrary = (
    items: JellyfinMediaItem[],
    onPlayItem = jest.fn(),
    onSelectItem = jest.fn(),
    onTransportKey?: () => boolean,
  ) => {
    (getItems as jest.Mock).mockResolvedValue(items);
    const screen = render(
      <LibraryScreen
        libraryId="library-1"
        libraryName="Shows"
        libraryType="tvshows"
        menuVisible={false}
        onMenuVisibleChange={() => undefined}
        onTransportKey={onTransportKey}
        onPlayItem={onPlayItem}
        onSelectItem={onSelectItem}
        serverProfile={profile}
      />,
    );
    return {onPlayItem, onSelectItem, screen};
  };

  it('plays the focused card on Play/Pause', async () => {
    const nextUp = item('b-e2', 'Episode');
    (getSeriesNextUp as jest.Mock).mockResolvedValue(nextUp);
    const {onPlayItem, onSelectItem, screen} = renderLibrary([
      item('A', 'Series'),
      item('B', 'Series'),
    ]);
    await settle();

    fireEvent(screen.getByTestId('media-card-B'), 'focus');
    await pressKey('playpause');

    expect(onPlayItem).toHaveBeenCalledTimes(1);
    expect(onPlayItem).toHaveBeenCalledWith(nextUp);
    expect(onSelectItem).not.toHaveBeenCalled();
    expect((getSeriesNextUp as jest.Mock).mock.calls[0][3]).toBe('B');
  });

  it('opens an item it cannot play instead of doing nothing', async () => {
    const {onPlayItem, onSelectItem} = renderLibrary([item('Box', 'BoxSet')]);
    await settle();

    await pressKey('play');

    expect(onPlayItem).not.toHaveBeenCalled();
    expect(onSelectItem).toHaveBeenCalledWith(
      expect.objectContaining({id: 'Box'}),
    );
  });

  it('leaves the transport keys to music while a track is loaded', async () => {
    const onTransportKey = jest.fn(() => true);
    const {onPlayItem, onSelectItem} = renderLibrary(
      [item('M', 'Movie')],
      jest.fn(),
      jest.fn(),
      onTransportKey,
    );
    await settle();

    await pressKey('playpause');

    expect(onTransportKey).toHaveBeenCalledTimes(1);
    expect(onPlayItem).not.toHaveBeenCalled();
    expect(onSelectItem).not.toHaveBeenCalled();
  });
});

describe('NowPlayingScreen Stop', () => {
  it('stops the music and leaves the screen', async () => {
    (audioPlayback.getStatus as jest.Mock).mockReturnValue({
      isPlaying: true,
      positionSeconds: 0,
      durationSeconds: 100,
      track: {id: 't1', name: 'Song', artist: 'Artist'},
    });
    const onBack = jest.fn();
    const screen = render(<NowPlayingScreen onBack={onBack} />);

    fireEvent.press(screen.getByText('Stop'));

    expect(audioPlayback.stop).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
