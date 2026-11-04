import React from 'react';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';

import {OnNowRow} from '../src/screens/HomeScreen/OnNowRow';
import {getOnNowPrograms} from '../src/services/jellyfin/liveTv';

jest.mock('@amazon-devices/react-native-kepler', () => {
  const MockReact = require('react');
  const {View} = require('react-native');
  return {
    TVFocusGuideView: (props: Record<string, unknown>) =>
      MockReact.createElement(View, props),
  };
});

jest.mock('../src/services/jellyfin/liveTv', () => ({
  ...jest.requireActual('../src/services/jellyfin/liveTv'),
  getOnNowPrograms: jest.fn(),
}));

const session = {accessToken: 'token', serverUrl: 'http://server', userId: 'u'};

const onNow = (id: string, name: string, endInMinutes: number) => ({
  channel: {id: `ch-${id}`, isFavorite: false, name: `${name} Channel`},
  endTime: Date.now() + endInMinutes * 60_000,
  episodeTitle: 'Pilot',
  id,
  name,
  startTime: Date.now() - 10 * 60_000,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('OnNowRow', () => {
  it('shows what is airing and tunes to the channel on select', async () => {
    const programs = [onNow('p1', 'Columbo', 30), onNow('p2', 'Cheers', 20)];
    (getOnNowPrograms as jest.Mock).mockResolvedValue(programs);
    const onSelect = jest.fn();

    const screen = render(<OnNowRow onSelect={onSelect} session={session} />);

    await waitFor(() => expect(screen.getByText('On Now')).toBeTruthy());
    expect(screen.getByText('Columbo')).toBeTruthy();
    expect(screen.getAllByText('Pilot')).toHaveLength(2);

    fireEvent.press(screen.getByTestId('on-now-card-p2'));

    expect(onSelect).toHaveBeenCalledWith(programs[1], programs);
  });

  it('hides itself when nothing is on or the server refuses', async () => {
    (getOnNowPrograms as jest.Mock).mockRejectedValue(new Error('401'));

    const screen = render(<OnNowRow onSelect={jest.fn()} session={session} />);

    await waitFor(() => expect(getOnNowPrograms).toHaveBeenCalled());
    expect(screen.queryByText('On Now')).toBeNull();
  });

  it('fetches again once a programme has ended', async () => {
    jest.useFakeTimers();
    try {
      (getOnNowPrograms as jest.Mock).mockResolvedValue([
        onNow('p1', 'Columbo', 0.25),
      ]);

      render(<OnNowRow onSelect={jest.fn()} session={session} />);
      await act(async () => {});
      expect(getOnNowPrograms).toHaveBeenCalledTimes(1);

      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });

      expect(getOnNowPrograms).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});
