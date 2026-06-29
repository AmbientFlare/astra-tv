import 'react-native';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';
import * as React from 'react';

import {App} from '../src/App';
import {SearchScreen} from '../src/screens/SearchScreen';
import {
  getLastUsedServerProfile,
  readServerProfiles,
} from '../src/services/storage';

const mockKeplerExitApp = jest.fn();
let mockHardwareBackPressHandler: (() => boolean | void) | undefined;
const mockKeplerBackHandler = {
  addEventListener: jest.fn(
    (_eventName: string, handler: () => boolean | void) => {
      mockHardwareBackPressHandler = handler;
      return {remove: jest.fn()};
    },
  ),
  exitApp: mockKeplerExitApp,
  removeEventListener: jest.fn(),
};

jest.mock('@amazon-devices/react-native-kepler', () => {
  const MockReact = require('react');
  const {TextInput, View} = require('react-native');

  return {
    AsyncStorage: {
      getItem: jest.fn(async () => null),
      removeItem: jest.fn(async () => undefined),
      setItem: jest.fn(async () => undefined),
    },
    TextInput: MockReact.forwardRef(
      (props: Record<string, unknown>, ref: React.Ref<unknown>) =>
        MockReact.createElement(TextInput, {...props, ref}),
    ),
    TVFocusGuideView: (props: Record<string, unknown>) =>
      MockReact.createElement(View, props),
    useKeplerBackHandler: jest.fn(() => mockKeplerBackHandler),
    useTVEventHandler: jest.fn(),
  };
});

jest.mock('@amazon-devices/react-native-w3cmedia', () => {
  const MockReact = require('react');
  const {View} = require('react-native');

  class VideoPlayer {
    autoplay = false;
    currentTime = 0;
    defaultSeekIntervalInSec = 10;
    duration = 0;
    paused = true;
    src = '';

    clearSurfaceHandle = jest.fn();
    deinitialize = jest.fn(async () => undefined);
    initialize = jest.fn(async () => undefined);
    load = jest.fn();
    pause = jest.fn(() => {
      this.paused = true;
    });
    play = jest.fn(() => {
      this.paused = false;
    });
    setSurfaceHandle = jest.fn();
  }

  return {
    KeplerVideoSurfaceView: (props: Record<string, unknown>) =>
      MockReact.createElement(View, props),
    VideoPlayer,
  };
});

jest.mock('../src/services/jellyfin', () => ({
  authenticate: jest.fn(async () => ({
    accessToken: 'test-token',
    userId: 'test-user',
  })),
  connect: jest.fn(async () => ({
    id: 'test-server',
    name: 'Test Server',
    version: '10.11.11',
  })),
  discoverServers: jest.fn(async () => []),
  getLibraries: jest.fn(async () => []),
  getStreamUrl: jest.fn(async () => ({
    itemId: 'test-item',
    playMethod: 'DirectPlay',
    url: 'https://example.com/video.mp4',
  })),
  reportPlaybackProgress: jest.fn(async () => undefined),
  reportPlaybackStart: jest.fn(async () => undefined),
  reportPlaybackStopped: jest.fn(async () => undefined),
}));

jest.mock('../src/services/iap', () => ({
  checkAstraProReceipt: jest.fn(async () => false),
  isIapAvailable: jest.fn(() => false),
  purchaseAstraPro: jest.fn(async () => false),
}));

jest.mock('../src/services/storage', () => ({
  getLastUsedServerProfile: jest.fn(async () => null),
  incrementLaunchCount: jest.fn(async () => 1),
  readServerProfiles: jest.fn(async () => []),
  readAppState: jest.fn(async () => ({isPro: false, launchCount: 0})),
  setProStatus: jest.fn(async () => undefined),
  upsertServerProfile: jest.fn(async () => undefined),
  writeAppState: jest.fn(async () => ({isPro: false, launchCount: 1})),
}));

describe('App', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHardwareBackPressHandler = undefined;
  });

  it('matches snapshot', async () => {
    const screen = render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('setup-screen')).toBeTruthy(),
    );
    expect(screen).toMatchSnapshot();
  });

  it('launches setup when no server profile exists', async () => {
    const screen = render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('setup-screen')).toBeTruthy(),
    );
    expect(readServerProfiles).toHaveBeenCalledTimes(1);
  });

  it('renders setup input fields', async () => {
    const screen = render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('setup-server-url-input')).toBeTruthy(),
    );
    expect(screen.getByTestId('setup-username-input')).toBeTruthy();
    expect(screen.getByTestId('setup-password-input')).toBeTruthy();
    expect(screen.getByTestId('setup-connect-button')).toBeTruthy();
  });

  it('enables the TV soft keyboard for setup input fields', async () => {
    const screen = render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('setup-server-url-input')).toBeTruthy(),
    );

    expect(screen.getByTestId('setup-server-url-input').props).toMatchObject({
      showSoftInputOnFocus: true,
    });
    expect(screen.getByTestId('setup-username-input').props).toMatchObject({
      showSoftInputOnFocus: true,
    });
    expect(screen.getByTestId('setup-password-input').props).toMatchObject({
      showSoftInputOnFocus: true,
    });
  });

  it('enables the TV soft keyboard for search input', () => {
    const screen = render(
      <SearchScreen
        serverProfile={{
          accessToken: 'test-token',
          id: 'test-server',
          lastUsed: 1,
          name: 'Test Server',
          serverType: 'jellyfin',
          serverUrl: 'https://example.com',
          userId: 'test-user',
        }}
      />,
    );

    expect(screen.getByTestId('search-input').props).toMatchObject({
      showSoftInputOnFocus: true,
    });
  });

  it('requires repeated root back presses before showing exit confirmation', async () => {
    const serverProfile = {
      accessToken: 'test-token',
      id: 'test-server',
      lastUsed: 1,
      name: 'Test Server',
      serverType: 'jellyfin' as const,
      serverUrl: 'https://example.com',
      userId: 'test-user',
    };
    (readServerProfiles as jest.Mock).mockResolvedValueOnce([serverProfile]);
    (getLastUsedServerProfile as jest.Mock).mockResolvedValueOnce(
      serverProfile,
    );

    const screen = render(<App />);
    await waitFor(() => expect(screen.getByTestId('home-screen')).toBeTruthy());

    act(() => {
      mockHardwareBackPressHandler?.();
      mockHardwareBackPressHandler?.();
    });
    expect(screen.queryByTestId('exit-confirmation')).toBeNull();
    expect(mockKeplerExitApp).not.toHaveBeenCalled();

    act(() => {
      mockHardwareBackPressHandler?.();
    });
    expect(screen.getByTestId('exit-confirmation')).toBeTruthy();
    expect(mockKeplerExitApp).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('exit-cancel-button'));
    expect(screen.queryByTestId('exit-confirmation')).toBeNull();
  });
});
