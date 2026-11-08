import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';

import {LiveTvScreen, nowAndNext} from '../src/screens/LiveTvScreen';
import {
  getAvailableLiveTvFilters,
  getGuidePrograms,
  getLiveTvChannels,
  getNextPrograms,
} from '../src/services/jellyfin/liveTv';
import {ServerProfile} from '../src/services/storage';

jest.mock('@amazon-devices/react-native-kepler', () => {
  const MockReact = require('react');
  const {View} = require('react-native');
  return {
    TVFocusGuideView: (props: Record<string, unknown>) =>
      MockReact.createElement(View, props),
    useTVEventHandler: jest.fn(),
  };
});

jest.mock('../src/services/jellyfin/liveTv', () => ({
  ...jest.requireActual('../src/services/jellyfin/liveTv'),
  canManageRecordings: jest.fn(async () => false),
  getAvailableLiveTvFilters: jest.fn(),
  getGuidePrograms: jest.fn(),
  getLiveTvChannels: jest.fn(),
  getNextPrograms: jest.fn(),
}));

const profile = {
  accessToken: 'token',
  serverUrl: 'http://server',
  userId: 'user',
} as ServerProfile;

const now = Date.now();
const program = (id: string, name: string, start: number, end: number) => ({
  endTime: now + end * 60_000,
  id,
  name,
  startTime: now + start * 60_000,
});

const channel = {
  current: program('p1', 'Family Ties', -10, 20),
  id: 'ch-1',
  isFavorite: false,
  name: 'Family Ties Channel',
  number: '315',
};

beforeEach(() => {
  jest.clearAllMocks();
  (getAvailableLiveTvFilters as jest.Mock).mockResolvedValue(['all', 'movies']);
  (getLiveTvChannels as jest.Mock).mockResolvedValue({
    items: [channel],
    startIndex: 0,
    totalCount: 1,
  });
  (getNextPrograms as jest.Mock).mockResolvedValue({
    'ch-1': program('p2', 'Cheers', 20, 50),
  });
  (getGuidePrograms as jest.Mock).mockResolvedValue({
    'ch-1': [
      {...program('p1', 'Family Ties', -10, 20), overview: 'Alex runs.'},
      program('p2', 'Cheers', 20, 50),
    ],
  });
});

describe('LiveTvScreen', () => {
  it('lists channels with what is on now and next', async () => {
    const screen = render(
      <LiveTvScreen onBack={jest.fn()} serverProfile={profile} />,
    );
    fireEvent.press(screen.getByTestId('livetv-view-channels'));

    expect(await screen.findByTestId('livetv-channel-ch-1')).toBeTruthy();
    expect(await screen.findByText('Family Ties')).toBeTruthy();
    expect(screen.getByText('315')).toBeTruthy();
    expect(screen.getByText('Family Ties Channel')).toBeTruthy();
    expect(await screen.findByText('Cheers')).toBeTruthy();
    expect(screen.getByText('1 channel')).toBeTruthy();
    expect(getNextPrograms).toHaveBeenCalledWith(
      expect.objectContaining({userId: 'user'}),
      ['ch-1'],
    );

    fireEvent.press(screen.getByTestId('livetv-view-guide'));
  });

  it('offers only the filters the server has channels for', async () => {
    const screen = render(
      <LiveTvScreen onBack={jest.fn()} serverProfile={profile} />,
    );

    expect(await screen.findByTestId('livetv-filter-movies')).toBeTruthy();
    expect(screen.queryByTestId('livetv-filter-sports')).toBeNull();

    fireEvent.press(screen.getByTestId('livetv-filter-movies'));

    await waitFor(() =>
      expect(getLiveTvChannels).toHaveBeenLastCalledWith(expect.anything(), {
        filter: 'movies',
      }),
    );
  });

  it('says so when a filter has no channels', async () => {
    (getLiveTvChannels as jest.Mock).mockResolvedValue({
      items: [],
      startIndex: 0,
      totalCount: 0,
    });
    const screen = render(
      <LiveTvScreen onBack={jest.fn()} serverProfile={profile} />,
    );

    expect(
      await screen.findByText('This server has no channels yet.'),
    ).toBeTruthy();
  });

  it('shows the error when channels fail to load', async () => {
    (getLiveTvChannels as jest.Mock).mockRejectedValue(
      new Error('Server request failed 500: /LiveTv/Channels'),
    );
    const screen = render(
      <LiveTvScreen onBack={jest.fn()} serverProfile={profile} />,
    );

    expect(
      await screen.findByText('Server request failed 500: /LiveTv/Channels'),
    ).toBeTruthy();
  });

  it('hands the chosen channel to the caller', async () => {
    const onSelectChannel = jest.fn();
    const screen = render(
      <LiveTvScreen
        onBack={jest.fn()}
        onSelectChannel={onSelectChannel}
        serverProfile={profile}
      />,
    );

    fireEvent.press(screen.getByTestId('livetv-view-channels'));
    fireEvent.press(await screen.findByTestId('livetv-channel-ch-1'));

    expect(onSelectChannel).toHaveBeenCalledWith(
      expect.objectContaining({id: 'ch-1'}),
      [expect.objectContaining({id: 'ch-1'})],
    );

    // The view is remembered for next time; put it back for other tests.
    fireEvent.press(screen.getByTestId('livetv-view-guide'));
  });

  it('opens on the guide and plays the channel picked in it', async () => {
    const onSelectChannel = jest.fn();
    const screen = render(
      <LiveTvScreen
        onBack={jest.fn()}
        onSelectChannel={onSelectChannel}
        serverProfile={profile}
      />,
    );

    expect(await screen.findByTestId('livetv-guide-row-ch-1')).toBeTruthy();
    await waitFor(() => expect(getGuidePrograms).toHaveBeenCalled());
    expect(await screen.findByText('Alex runs.')).toBeTruthy();
    expect(screen.getAllByText('Cheers').length).toBeGreaterThan(0);

    fireEvent.press(screen.getByTestId('livetv-guide'));

    expect(onSelectChannel).toHaveBeenCalledWith(
      expect.objectContaining({id: 'ch-1'}),
      [expect.objectContaining({id: 'ch-1'})],
    );
  });

  it('shows the channel name when its logo fails to load', async () => {
    (getLiveTvChannels as jest.Mock).mockResolvedValue({
      items: [{...channel, imageUrl: 'http://server/broken-logo'}],
      startIndex: 0,
      totalCount: 1,
    });
    const {Image} = require('react-native');
    const screen = render(
      <LiveTvScreen onBack={jest.fn()} serverProfile={profile} />,
    );

    expect(await screen.findByTestId('livetv-guide-row-ch-1')).toBeTruthy();
    const namesShown = screen.queryAllByText('Family Ties Channel').length;
    const brokenLogos = () =>
      screen
        .UNSAFE_queryAllByType(Image)
        .filter(
          (image: {props: {source?: {uri?: string}}}) =>
            image.props.source?.uri === 'http://server/broken-logo',
        );
    expect(brokenLogos()).toHaveLength(1);

    fireEvent(brokenLogos()[0], 'error');

    await waitFor(() => expect(brokenLogos()).toHaveLength(0));
    expect(screen.getAllByText('Family Ties Channel')).toHaveLength(
      namesShown + 1,
    );
  });
});

describe('nowAndNext', () => {
  it('moves on to the next programme once the current one has ended', () => {
    const next = program('p2', 'Cheers', -5, 25);
    const ended = {...channel, current: program('p1', 'Old', -40, -5), next};

    expect(nowAndNext(ended, now)).toEqual({current: next, next: undefined});
  });

  it('keeps the current programme while it is still on', () => {
    const next = program('p2', 'Cheers', 20, 50);

    expect(nowAndNext({...channel, next}, now)).toEqual({
      current: channel.current,
      next,
    });
  });
});
