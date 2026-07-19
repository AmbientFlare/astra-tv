import 'react-native';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';
import * as React from 'react';

import {App} from '../src/App';
import {SearchScreen} from '../src/screens/SearchScreen';
import {checkAstraProReceipt} from '../src/services/iap';
import {
  initiateQuickConnect,
  isQuickConnectEnabled,
} from '../src/services/jellyfin';
import {
  getLastUsedServerProfile,
  incrementLaunchCount,
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

jest.mock('../src/components/FocusableItem', () => {
  const MockReact = require('react');
  const {View} = require('react-native');

  return {
    FocusableItem: ({
      children,
      focusedStyle: _focusedStyle,
      hasTVPreferredFocus: _hasTVPreferredFocus,
      ...props
    }: Record<string, unknown>) =>
      MockReact.createElement(View, props, children),
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
    KeplerCaptionsView: (props: Record<string, unknown>) =>
      MockReact.createElement(View, props),
    KeplerVideoSurfaceView: (props: Record<string, unknown>) =>
      MockReact.createElement(View, props),
    VideoPlayer,
  };
});

jest.mock('@amazon-devices/keplerscript-netmgr-lib', () => ({
  getIpAddress: jest.fn(async () => '192.168.1.25'),
}));

jest.mock('../src/services/jellyfin', () => ({
  authenticate: jest.fn(async () => ({
    accessToken: 'test-token',
    userId: 'test-user',
  })),
  authenticateWithQuickConnect: jest.fn(async () => ({
    accessToken: 'test-token',
    userId: 'test-user',
    username: 'Test User',
  })),
  connect: jest.fn(async () => ({
    id: 'test-server',
    name: 'Test Server',
    version: '10.11.11',
  })),
  discoverServers: jest.fn(async () => []),
  initiateQuickConnect: jest.fn(async () => ({code: '123456', secret: 'sec'})),
  isQuickConnectEnabled: jest.fn(async () => false),
  pollQuickConnect: jest.fn(async () => false),
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
  defaultPlaybackPrefs: {
    maxAudioChannels: 6,
    maxBitrateBps: 80000000,
    preferredAudioLanguage: 'en',
    seekDurationSeconds: 10,
    showPlaybackStats: false,
    version: 1,
  },
  defaultUserPreferences: {
    accountSortBy: 'lastUsed',
    autoSignIn: 'mostRecent',
    focusedBackdropEnabled: true,
    homeSections: {
      continueWatching: true,
      latestMovies: true,
      latestShows: true,
      myMedia: true,
      nextUp: true,
    },
    maxStreamingBitrate: 'auto',
    nextEpisodeAutoplay: false,
    nextEpisodeCountdownSeconds: 15,
    preferredAudioLanguage: 'English',
    preferredSubtitleLanguage: 'English',
    seekDurationSeconds: 10,
    skipIntroCredits: 'ask',
    subtitleMode: 'default',
  },
  getDisplayPreferences: jest.fn(async () => ({
    imageSize: 'medium',
    imageType: 'Primary',
  })),
  getLastUsedServerProfile: jest.fn(async () => null),
  getUserPreferences: jest.fn(async () => ({
    accountSortBy: 'lastUsed',
    autoSignIn: 'mostRecent',
    focusedBackdropEnabled: true,
    homeSections: {
      continueWatching: true,
      latestMovies: true,
      latestShows: true,
      myMedia: true,
      nextUp: true,
    },
    maxStreamingBitrate: 'auto',
    nextEpisodeAutoplay: false,
    nextEpisodeCountdownSeconds: 15,
    preferredAudioLanguage: 'English',
    preferredSubtitleLanguage: 'English',
    seekDurationSeconds: 10,
    skipIntroCredits: 'ask',
    subtitleMode: 'default',
  })),
  incrementLaunchCount: jest.fn(async () => 1),
  readPlaybackPreferences: jest.fn(async () => ({
    maxAudioChannels: 6,
    maxBitrateBps: 80000000,
    preferredAudioLanguage: 'en',
    seekDurationSeconds: 10,
    showPlaybackStats: false,
    version: 1,
  })),
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

  it('never interrupts startup with a support prompt', async () => {
    (incrementLaunchCount as jest.Mock).mockResolvedValueOnce(10);
    (checkAstraProReceipt as jest.Mock).mockResolvedValueOnce(false);

    const screen = render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('setup-screen')).toBeTruthy(),
    );

    expect(screen.queryByTestId('support-screen')).toBeNull();
    expect(incrementLaunchCount).not.toHaveBeenCalled();
    expect(checkAstraProReceipt).not.toHaveBeenCalled();
  });

  it('shows Emby as a disabled coming-soon option', async () => {
    const screen = render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('setup-server-type-emby')).toBeTruthy(),
    );

    expect(screen.getByTestId('setup-server-type-emby').props.disabled).toBe(
      true,
    );
    expect(screen.getByText('Coming soon')).toBeTruthy();
  });

  const advanceToPasswordStep = async (screen: ReturnType<typeof render>) => {
    await waitFor(() =>
      expect(screen.getByTestId('setup-server-type-jellyfin')).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId('setup-server-type-jellyfin'));
    await waitFor(() =>
      expect(screen.getByTestId('setup-server-url-input')).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId('setup-connect-button'));
    await waitFor(() =>
      expect(screen.getByTestId('setup-username-input')).toBeTruthy(),
    );
  };

  it('walks the setup wizard to the password sign-in fields', async () => {
    const screen = render(<App />);
    await advanceToPasswordStep(screen);
    expect(screen.getByTestId('setup-username-input')).toBeTruthy();
    expect(screen.getByTestId('setup-password-input')).toBeTruthy();
    expect(screen.getByTestId('setup-signin-button')).toBeTruthy();
  });

  it('offers Quick Connect and displays the server-issued code', async () => {
    (isQuickConnectEnabled as jest.Mock).mockResolvedValueOnce(true);
    const screen = render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId('setup-server-type-jellyfin')).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId('setup-server-type-jellyfin'));
    await waitFor(() =>
      expect(screen.getByTestId('setup-server-url-input')).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId('setup-connect-button'));
    await waitFor(() =>
      expect(screen.getByTestId('setup-method-code')).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId('setup-method-code'));
    await waitFor(() =>
      expect(screen.getByTestId('setup-quickconnect-code').props.children).toBe(
        '123456',
      ),
    );

    expect(initiateQuickConnect).toHaveBeenCalledTimes(1);
  });

  it('enables the TV soft keyboard for setup input fields', async () => {
    const screen = render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('setup-server-type-jellyfin')).toBeTruthy(),
    );
    fireEvent.press(screen.getByTestId('setup-server-type-jellyfin'));
    await waitFor(() =>
      expect(screen.getByTestId('setup-server-url-input')).toBeTruthy(),
    );

    expect(screen.getByTestId('setup-server-url-input').props).toMatchObject({
      showSoftInputOnFocus: true,
    });
    fireEvent.press(screen.getByTestId('setup-connect-button'));
    await waitFor(() =>
      expect(screen.getByTestId('setup-username-input')).toBeTruthy(),
    );
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
