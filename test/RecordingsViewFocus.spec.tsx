import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';

import {RecordingsView} from '../src/screens/LiveTvScreen/RecordingsView';
import {
  getRecordings,
  getScheduledRecordings,
  getSeriesRecordings,
} from '../src/services/jellyfin/liveTv';

// Each card's focus target, by testID, so a test can see which one was asked
// to take focus. That focus then lands is a device behaviour, checked on the
// stick.
const focusCalls: string[] = [];

jest.mock('../src/components/FocusableItem', () => {
  const MockReact = require('react');
  const {Pressable} = require('react-native');
  return {
    FocusableItem: ({children, focusRef, onPress, testID}: any) => {
      MockReact.useEffect(() => {
        if (typeof focusRef === 'function') {
          focusRef({requestTVFocus: () => focusCalls.push(testID)});
          return () => focusRef(null);
        }
        return undefined;
      }, [focusRef, testID]);
      return MockReact.createElement(Pressable, {onPress, testID}, children);
    },
  };
});

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
  getRecordings: jest.fn(),
  getScheduledRecordings: jest.fn(),
  getSeriesRecordings: jest.fn(),
}));

const session = {accessToken: 'token', serverUrl: 'http://server', userId: 'u'};
const now = Date.now();

beforeEach(() => {
  focusCalls.length = 0;
  (getRecordings as jest.Mock).mockResolvedValue([
    {
      id: 'r-1',
      inProgress: false,
      item: {id: 'r-1', name: 'Cheers'},
      name: 'Cheers',
      startTime: now - 86_400_000,
    },
    {
      id: 'r-2',
      inProgress: true,
      item: {id: 'r-2', name: 'Sabrina'},
      name: 'Sabrina',
      startTime: now - 600_000,
      endTime: now + 600_000,
    },
  ]);
  (getScheduledRecordings as jest.Mock).mockResolvedValue([]);
  (getSeriesRecordings as jest.Mock).mockResolvedValue([]);
});

const renderView = () =>
  render(
    <RecordingsView canManage={true} onPlay={jest.fn()} session={session} />,
  );

describe('RecordingsView focus', () => {
  it('puts focus on the first card once the rows load', async () => {
    const screen = renderView();
    await screen.findByTestId('recording-r-2');
    // "Recording now" is the first row, so its card comes first.
    await waitFor(() => expect(focusCalls).toEqual(['recording-r-2']), {
      timeout: 4000,
    });
  });

  it('comes back to the card that was played', async () => {
    const first = renderView();
    fireEvent.press(await first.findByTestId('recording-r-1'));
    fireEvent.press(first.getByTestId('recordings-panel-play'));
    await waitFor(() =>
      expect(first.queryByTestId('recordings-panel-play')).toBeNull(),
    );
    // Playing replaces this view with the player.
    first.unmount();
    focusCalls.length = 0;

    const again = renderView();
    await again.findByTestId('recording-r-1');
    await waitFor(() => expect(focusCalls).toEqual(['recording-r-1']));
  });

  it('asks nothing of a view that has gone', async () => {
    const screen = renderView();
    await screen.findByTestId('recording-r-2');
    screen.unmount();
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(focusCalls).toEqual([]);
  });
});
