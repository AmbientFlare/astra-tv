import React from 'react';
import {act, fireEvent, render} from '@testing-library/react-native';

import {RecordPanel} from '../src/screens/LiveTvScreen/RecordPanel';

const mockBackListeners: Array<() => boolean> = [];

jest.mock('@amazon-devices/react-native-kepler', () => {
  const MockReact = require('react');
  const {View} = require('react-native');
  return {
    TVFocusGuideView: (props: Record<string, unknown>) =>
      MockReact.createElement(View, props),
    useKeplerBackHandler: () => ({
      addEventListener: (_event: string, listener: () => boolean) => {
        mockBackListeners.push(listener);
        return {remove: jest.fn()};
      },
    }),
  };
});

const channel = {id: 'ch-1', isFavorite: false, name: 'Cheers TV'};
const program = {
  endTime: Date.now() + 90 * 60_000,
  episodeTitle: 'Pilot',
  id: 'p-1',
  isSeries: true,
  name: 'Cheers',
  startTime: Date.now() + 60 * 60_000,
};

beforeEach(() => {
  mockBackListeners.length = 0;
});

describe('RecordPanel', () => {
  it('offers to record the episode or the series, or watch now', () => {
    const screen = render(
      <RecordPanel
        channel={channel}
        onAction={jest.fn(async () => undefined)}
        onClose={jest.fn()}
        program={program}
      />,
    );

    expect(screen.getByText('Record episode')).toBeTruthy();
    expect(screen.getByText('Record series')).toBeTruthy();
    expect(screen.getByText('Watch now')).toBeTruthy();
  });

  it('offers to cancel what is already set to record', () => {
    const screen = render(
      <RecordPanel
        channel={channel}
        onAction={jest.fn(async () => undefined)}
        onClose={jest.fn()}
        program={{...program, seriesTimerId: 's-1', timerId: 't-1'}}
      />,
    );

    expect(screen.getByText('Set to record')).toBeTruthy();
    expect(screen.getByText('Cancel recording')).toBeTruthy();
    expect(screen.getByText('Cancel series recording')).toBeTruthy();
  });

  it('has no series option for a one-off programme', () => {
    const screen = render(
      <RecordPanel
        channel={channel}
        onAction={jest.fn(async () => undefined)}
        onClose={jest.fn()}
        program={{...program, isSeries: false}}
      />,
    );

    expect(screen.queryByText('Record series')).toBeNull();
  });

  it('hands the choice back and says so when the server refuses', async () => {
    const onAction = jest.fn(async () => {
      throw new Error('403');
    });
    const screen = render(
      <RecordPanel
        channel={channel}
        onAction={onAction}
        onClose={jest.fn()}
        program={program}
      />,
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId('livetv-record-recordSeries'));
    });

    expect(onAction).toHaveBeenCalledWith('recordSeries');
    expect(
      screen.getByText("The server didn't accept that. Please try again."),
    ).toBeTruthy();
  });

  it('closes on Back', () => {
    const onClose = jest.fn();
    render(
      <RecordPanel
        channel={channel}
        onAction={jest.fn(async () => undefined)}
        onClose={onClose}
        program={program}
      />,
    );

    expect(mockBackListeners[mockBackListeners.length - 1]()).toBe(true);
    expect(onClose).toHaveBeenCalled();
  });
});
