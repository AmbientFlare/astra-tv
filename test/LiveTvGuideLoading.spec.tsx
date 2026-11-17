import React from 'react';
import {act, render} from '@testing-library/react-native';

import {LiveTvGuide} from '../src/screens/LiveTvScreen/LiveTvGuide';
import {getGuidePrograms, LiveTvChannel} from '../src/services/jellyfin/liveTv';

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
  getGuidePrograms: jest.fn(),
}));

const session = {accessToken: 'token', serverUrl: 'http://server', userId: 'u'};
const now = Date.parse('2026-11-09T18:10:00Z');

const channelAt = (index: number): LiveTvChannel => ({
  id: `ch-${index}`,
  isFavorite: false,
  name: `Channel ${index}`,
  number: `${index}`,
});

const guideFor = (ids: string[]) =>
  Object.fromEntries(
    ids.map((id) => [
      id,
      [
        {
          endTime: now + 20 * 60_000,
          id: `p-${id}`,
          name: `Show on ${id}`,
          startTime: now - 10 * 60_000,
        },
      ],
    ]),
  );

const renderGuide = (channels: LiveTvChannel[]) =>
  render(
    <LiveTvGuide
      channels={channels}
      now={now}
      onNeedMore={jest.fn()}
      onSelectChannel={jest.fn()}
      session={session}
    />,
  );

const flush = async () => {
  for (let turn = 0; turn < 10; turn++) {
    await Promise.resolve();
  }
};

const requestsFor = (id: string) =>
  (getGuidePrograms as jest.Mock).mock.calls.filter(([, ids]) =>
    ids.includes(id),
  ).length;

describe('LiveTvGuide loading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(now);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('asks again for a block that failed, and fills it in', async () => {
    (getGuidePrograms as jest.Mock)
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async (_session, ids: string[]) => guideFor(ids));

    const screen = renderGuide([channelAt(1)]);
    await act(flush);

    expect(requestsFor('ch-1')).toBe(1);
    // Still waiting on the retry, so not yet called empty.
    expect(screen.queryByText(/No guide information/i)).toBeNull();
    expect(screen.queryAllByText('Show on ch-1')).toHaveLength(0);

    await act(async () => {
      jest.advanceTimersByTime(4000);
      await flush();
    });

    expect(requestsFor('ch-1')).toBe(2);
    expect(screen.queryAllByText('Show on ch-1').length).toBeGreaterThan(0);
  });

  it('gives up on a server that stays down, without looping', async () => {
    (getGuidePrograms as jest.Mock).mockRejectedValue(new Error('offline'));

    const screen = renderGuide([channelAt(1)]);
    await act(flush);
    await act(async () => {
      jest.advanceTimersByTime(4000);
      await flush();
    });
    await act(async () => {
      jest.advanceTimersByTime(15000);
      await flush();
    });

    expect(requestsFor('ch-1')).toBe(3);
    expect(screen.getByText(/No guide information/i)).toBeTruthy();

    await act(async () => {
      jest.advanceTimersByTime(10 * 60_000);
      await flush();
    });

    expect(requestsFor('ch-1')).toBe(3);
  });

  it('stops retrying once the guide has gone', async () => {
    (getGuidePrograms as jest.Mock).mockRejectedValue(new Error('offline'));

    const screen = renderGuide([channelAt(1)]);
    await act(flush);
    screen.unmount();
    await act(async () => {
      jest.advanceTimersByTime(60_000);
      await flush();
    });

    expect(requestsFor('ch-1')).toBe(1);
  });

  it('drops the guide for channels that are no longer near the screen', async () => {
    (getGuidePrograms as jest.Mock).mockImplementation(
      async (_session, ids: string[]) => guideFor(ids),
    );
    const first = [channelAt(1)];
    const second = [channelAt(2)];

    const screen = renderGuide(first);
    await act(flush);
    expect(requestsFor('ch-1')).toBe(1);

    const guide = (channels: LiveTvChannel[]) => (
      <LiveTvGuide
        channels={channels}
        now={now}
        onNeedMore={jest.fn()}
        onSelectChannel={jest.fn()}
        session={session}
      />
    );
    screen.rerender(guide(second));
    await act(flush);
    expect(requestsFor('ch-2')).toBe(1);

    // Back on the first list: its guide was dropped, so it is fetched again.
    screen.rerender(guide(first));
    await act(flush);
    expect(requestsFor('ch-1')).toBe(2);
    expect(screen.queryAllByText('Show on ch-1').length).toBeGreaterThan(0);
  });
});
