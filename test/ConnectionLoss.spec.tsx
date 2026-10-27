import React from 'react';
import {Text} from 'react-native';
import {act, render} from '@testing-library/react-native';

let mockListener: ((state: {isConnected: boolean | null}) => void) | null =
  null;
const mockRefresh = jest.fn(async () => ({isConnected: true}));
const mockConfigure = jest.fn();
jest.mock('@amazon-devices/keplerscript-netmgr-lib', () => ({
  configure: (configuration: unknown) => mockConfigure(configuration),
  addEventListener: (listener: typeof mockListener) => {
    mockListener = listener;
    return () => {
      mockListener = null;
    };
  },
  refresh: () => mockRefresh(),
}));

import {
  CONNECTION_LOSS_GRACE_MS,
  checkConnection,
  useConnectionLoss,
} from '../src/services/network/connection';

let latest: ReturnType<typeof useConnectionLoss>;
const Probe = ({enabled = true}: {enabled?: boolean}) => {
  latest = useConnectionLoss(enabled);
  return <Text>{latest.lost ? 'lost' : 'ok'}</Text>;
};

const network = (isConnected: boolean | null) =>
  act(() => {
    mockListener?.({isConnected});
  });

describe('connection loss', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRefresh.mockResolvedValue({isConnected: true});
  });
  afterEach(() => jest.useRealTimers());

  it('turns off the library’s Google reachability probe', async () => {
    await checkConnection();
    expect(mockConfigure).toHaveBeenCalledTimes(1);
    const [configuration] = mockConfigure.mock.calls[0];
    expect(configuration.reachabilityShouldRun()).toBe(false);
  });

  it('ignores a drop shorter than the grace period', () => {
    const view = render(<Probe />);
    network(false);
    act(() => {
      jest.advanceTimersByTime(CONNECTION_LOSS_GRACE_MS - 1);
    });
    network(true);
    act(() => {
      jest.advanceTimersByTime(CONNECTION_LOSS_GRACE_MS);
    });
    expect(view.getByText('ok')).toBeTruthy();
  });

  it('treats an unknown state as online', () => {
    const view = render(<Probe />);
    network(null);
    act(() => {
      jest.advanceTimersByTime(CONNECTION_LOSS_GRACE_MS * 2);
    });
    expect(view.getByText('ok')).toBeTruthy();
  });

  it('stays lost until Retry finds the network', async () => {
    const view = render(<Probe />);
    network(false);
    act(() => {
      jest.advanceTimersByTime(CONNECTION_LOSS_GRACE_MS);
    });
    expect(view.getByText('lost')).toBeTruthy();

    // The network coming back on its own does not hide the notice.
    network(true);
    expect(view.getByText('lost')).toBeTruthy();

    mockRefresh.mockResolvedValueOnce({isConnected: false});
    await act(async () => {
      expect(await latest.retry()).toBe(false);
    });
    expect(view.getByText('lost')).toBeTruthy();

    await act(async () => {
      expect(await latest.retry()).toBe(true);
    });
    expect(view.getByText('ok')).toBeTruthy();
  });

  it('clears and stops watching while disabled', () => {
    const view = render(<Probe />);
    network(false);
    act(() => {
      jest.advanceTimersByTime(CONNECTION_LOSS_GRACE_MS);
    });
    view.rerender(<Probe enabled={false} />);
    expect(view.getByText('ok')).toBeTruthy();
    expect(mockListener).toBeNull();
  });
});
