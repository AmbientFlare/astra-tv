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

  describe('a long DVR', () => {
    const many = (from: number, count: number) =>
      Array.from({length: count}, (_unused, offset) => ({
        id: `m-${from + offset}`,
        inProgress: false,
        item: {id: `m-${from + offset}`, name: `Show ${from + offset}`},
        name: `Show ${from + offset}`,
        startTime: now - (from + offset + 1) * 3_600_000,
      }));

    beforeEach(() => {
      (getScheduledRecordings as jest.Mock).mockResolvedValue([]);
      (getSeriesRecordings as jest.Mock).mockResolvedValue([]);
    });

    it('draws a row a batch at a time as focus moves along it', async () => {
      (getRecordings as jest.Mock).mockResolvedValue(many(0, 60));
      const screen = renderView();

      expect(await screen.findByTestId('recording-m-0')).toBeTruthy();
      expect(screen.getByTestId('recording-m-23')).toBeTruthy();
      expect(screen.queryByTestId('recording-m-24')).toBeNull();

      fireEvent(screen.getByTestId('recording-m-20'), 'focus');

      expect(await screen.findByTestId('recording-m-44')).toBeTruthy();
      expect(screen.queryByTestId('recording-m-45')).toBeNull();
      // Sixty is short of a full page, so there is nothing more to ask for.
      expect(getRecordings).toHaveBeenCalledTimes(1);
    });

    it('asks for the next page as focus nears the end, once', async () => {
      (getRecordings as jest.Mock)
        .mockResolvedValueOnce(many(0, 100))
        .mockResolvedValueOnce(many(100, 30));
      const screen = renderView();
      await screen.findByTestId('recording-m-0');
      expect(getRecordings).toHaveBeenLastCalledWith(session, {
        limit: 100,
        startIndex: 0,
      });

      // Walk focus to the end of the first page.
      for (const index of [20, 40, 60, 80, 99]) {
        fireEvent(await screen.findByTestId(`recording-m-${index}`), 'focus');
      }

      await waitFor(() => expect(getRecordings).toHaveBeenCalledTimes(2));
      expect(getRecordings).toHaveBeenLastCalledWith(session, {
        limit: 100,
        startIndex: 100,
      });
      // The new page is drawn without another move.
      expect(await screen.findByTestId('recording-m-100')).toBeTruthy();

      // Thirty is a short page: the end, so nothing more is asked for.
      fireEvent(await screen.findByTestId('recording-m-120'), 'focus');
      fireEvent(await screen.findByTestId('recording-m-129'), 'focus');
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(getRecordings).toHaveBeenCalledTimes(2);
    });

    it('stops asking a server that answers every page the same', async () => {
      (getRecordings as jest.Mock).mockResolvedValue(many(0, 100));
      const screen = renderView();
      await screen.findByTestId('recording-m-0');

      for (const index of [20, 40, 60, 80, 99]) {
        fireEvent(await screen.findByTestId(`recording-m-${index}`), 'focus');
      }
      await waitFor(() => expect(getRecordings).toHaveBeenCalledTimes(2));
      fireEvent(screen.getByTestId('recording-m-99'), 'focus');
      fireEvent(screen.getByTestId('recording-m-98'), 'focus');
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(getRecordings).toHaveBeenCalledTimes(2);
    });
  });
});
