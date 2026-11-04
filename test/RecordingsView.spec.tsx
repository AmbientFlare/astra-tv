import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';

import {RecordingsView} from '../src/screens/LiveTvScreen/RecordingsView';
import {
  cancelRecording,
  cancelSeriesRecording,
  deleteRecording,
  getRecordings,
  getScheduledRecordings,
  getSeriesRecordings,
} from '../src/services/jellyfin/liveTv';

jest.mock('@amazon-devices/react-native-kepler', () => {
  const MockReact = require('react');
  const {View} = require('react-native');
  return {
    TVFocusGuideView: (props: Record<string, unknown>) =>
      MockReact.createElement(View, props),
    useKeplerBackHandler: () => ({
      addEventListener: () => ({remove: jest.fn()}),
    }),
  };
});

jest.mock('../src/services/jellyfin/liveTv', () => ({
  ...jest.requireActual('../src/services/jellyfin/liveTv'),
  cancelRecording: jest.fn(async () => undefined),
  cancelSeriesRecording: jest.fn(async () => undefined),
  deleteRecording: jest.fn(async () => undefined),
  getRecordings: jest.fn(),
  getScheduledRecordings: jest.fn(),
  getSeriesRecordings: jest.fn(),
}));

const session = {accessToken: 'token', serverUrl: 'http://server', userId: 'u'};
const now = Date.now();
const cheers = {
  id: 'r-1',
  inProgress: false,
  item: {id: 'r-1', name: 'Cheers', type: 'Recording'},
  name: 'Cheers',
  episodeTitle: 'Pilot',
  startTime: now - 86_400_000,
};

beforeEach(() => {
  jest.clearAllMocks();
  (getRecordings as jest.Mock).mockResolvedValue([
    cheers,
    {
      id: 'r-2',
      inProgress: true,
      item: {id: 'r-2', name: 'Sabrina'},
      name: 'Sabrina',
      startTime: now - 600_000,
      endTime: now + 600_000,
      timerId: 't-9',
    },
  ]);
  (getScheduledRecordings as jest.Mock).mockResolvedValue([
    {
      id: 't-1',
      name: 'Frasier',
      startTime: now + 3_600_000,
      endTime: now + 5_400_000,
      seriesTimerId: 's-1',
    },
  ]);
  (getSeriesRecordings as jest.Mock).mockResolvedValue([
    {id: 's-1', name: 'Frasier', recordAnyChannel: true, recordNewOnly: true},
  ]);
});

const renderView = (onPlay = jest.fn(), canManage = true) =>
  render(
    <RecordingsView canManage={canManage} onPlay={onPlay} session={session} />,
  );

describe('RecordingsView', () => {
  it('shows each row with its cards', async () => {
    const screen = renderView();

    expect(await screen.findByText('Recording now')).toBeTruthy();
    expect(screen.getByText('Recorded')).toBeTruthy();
    expect(screen.getByText('Scheduled')).toBeTruthy();
    expect(screen.getByText('Series')).toBeTruthy();
    expect(screen.getByText('● REC')).toBeTruthy();
    expect(screen.getByText('New episodes only')).toBeTruthy();
    expect(screen.getByText('Any channel')).toBeTruthy();
  });

  it('plays a recording', async () => {
    const onPlay = jest.fn();
    const screen = renderView(onPlay);

    fireEvent.press(await screen.findByTestId('recording-r-1'));
    fireEvent.press(screen.getByTestId('recordings-panel-play'));

    await waitFor(() =>
      expect(onPlay).toHaveBeenCalledWith(expect.objectContaining({id: 'r-1'})),
    );
  });

  it('deletes a recording only on a second press', async () => {
    const screen = renderView();

    fireEvent.press(await screen.findByTestId('recording-r-1'));
    fireEvent.press(screen.getByTestId('recordings-panel-delete'));

    expect(await screen.findByText('Press again to delete')).toBeTruthy();
    expect(deleteRecording).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('recordings-panel-delete'));

    await waitFor(() =>
      expect(deleteRecording).toHaveBeenCalledWith(session, 'r-1'),
    );
    await waitFor(() => expect(getRecordings).toHaveBeenCalledTimes(2));
  });

  it('stops a recording in progress through its timer', async () => {
    const screen = renderView();

    fireEvent.press(await screen.findByTestId('recording-r-2'));
    expect(screen.queryByTestId('recordings-panel-delete')).toBeNull();
    fireEvent.press(screen.getByTestId('recordings-panel-stop'));

    await waitFor(() =>
      expect(cancelRecording).toHaveBeenCalledWith(session, 't-9'),
    );
  });

  it('cancels a scheduled airing or its whole series', async () => {
    const screen = renderView();

    fireEvent.press(await screen.findByTestId('scheduled-t-1'));
    fireEvent.press(screen.getByTestId('recordings-panel-cancel'));
    await waitFor(() =>
      expect(cancelRecording).toHaveBeenCalledWith(session, 't-1'),
    );

    fireEvent.press(await screen.findByTestId('series-s-1'));
    fireEvent.press(screen.getByTestId('recordings-panel-cancelSeries'));
    await waitFor(() =>
      expect(cancelSeriesRecording).toHaveBeenCalledWith(session, 's-1'),
    );
  });

  it('offers only Play to users who cannot manage recordings', async () => {
    const screen = renderView(jest.fn(), false);

    fireEvent.press(await screen.findByTestId('recording-r-1'));

    expect(screen.getByTestId('recordings-panel-play')).toBeTruthy();
    expect(screen.queryByTestId('recordings-panel-delete')).toBeNull();
  });

  it('says how to record when there is nothing yet', async () => {
    (getRecordings as jest.Mock).mockResolvedValue([]);
    (getScheduledRecordings as jest.Mock).mockResolvedValue([]);
    (getSeriesRecordings as jest.Mock).mockResolvedValue([]);
    const screen = renderView();

    expect(
      await screen.findByText(/Nothing recorded or scheduled yet/),
    ).toBeTruthy();
  });
});
