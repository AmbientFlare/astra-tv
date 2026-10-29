import 'react-native';
import {act, fireEvent, render, waitFor} from '@testing-library/react-native';
import * as React from 'react';

import {App} from '../src/App';
import {SearchScreen} from '../src/screens/SearchScreen';
import {onMemoryTrim} from '../src/services/memoryTrim';
import {checkAstraProReceipt} from '../src/services/iap';
import {
  getItems,
  getLibraries,
  initiateQuickConnect,
  isQuickConnectEnabled,
} from '../src/services/jellyfin';
import {
  getLastUsedServerProfile,
  incrementLaunchCount,
  readAppState,
  readServerProfiles,
  writeAppState,
} from '../src/services/storage';
import {
  getLocale,
  readStoredLocale,
  setActiveLocale,
  storeLocale,
} from '../src/i18n';

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
    // The audio player acquires media control focus through this, so the
    // navigator calls it on mount.
    useKeplerAppStateManager: jest.fn(() => ({
      addAppStateListener: jest.fn(() => ({remove: jest.fn()})),
      getComponentInstance: jest.fn(() => ({})),
    })),
    useKeplerBackHandler: jest.fn(() => mockKeplerBackHandler),
    useTVEventHandler: jest.fn(),
  };
});

// English already chosen, so these tests start at setup; the first-run
// language picker has its own test below.
jest.mock('../src/i18n', () => ({
  ...jest.requireActual('../src/i18n'),
  readStoredLocale: jest.fn(async () => 'en'),
  storeLocale: jest.fn(async () => undefined),
}));

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
    KeplerMediaControlHandler: class {},
    KeplerCaptionsView: (props: Record<string, unknown>) =>
      MockReact.createElement(View, props),
    KeplerVideoSurfaceView: (props: Record<string, unknown>) =>
      MockReact.createElement(View, props),
    VideoPlayer,
  };
});

let mockNetListener: ((state: {isConnected: boolean}) => void) | null = null;
const mockNetRefresh = jest.fn(async () => ({isConnected: true}));
jest.mock('@amazon-devices/keplerscript-netmgr-lib', () => ({
  getIpAddress: jest.fn(async () => '192.168.1.25'),
  configure: jest.fn(),
  addEventListener: (listener: typeof mockNetListener) => {
    mockNetListener = listener;
    return () => {
      mockNetListener = null;
    };
  },
  refresh: () => mockNetRefresh(),
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
    baseUrl: 'https://test.example.com',
    id: 'test-server',
    name: 'Test Server',
    version: '10.11.11',
  })),
  discoverServers: jest.fn(async () => []),
  initiateQuickConnect: jest.fn(async () => ({code: '123456', secret: 'sec'})),
  isQuickConnectEnabled: jest.fn(async () => false),
  pollQuickConnect: jest.fn(async () => false),
  getEpisodes: jest.fn(async () => []),
  getItemDetails: jest.fn(async (_url, _token, _user, id) => ({
    id,
    name: 'Item',
    type: 'Movie',
  })),
  getItems: jest.fn(async () => []),
  // Pages whatever the getItems mock holds, the way the server pages a
  // library, so a test sets its data once through getItems.
  getItemsPage: jest.fn(async (...args: any[]) => {
    const all = await jest
      .requireMock('../src/services/jellyfin')
      .getItems(...args);
    const start = args[4]?.startIndex ?? 0;
    return {
      items: all.slice(start, start + (args[4]?.limit ?? all.length)),
      totalRecordCount: all.length,
    };
  }),
  getLibraries: jest.fn(async () => []),
  getLatestItems: jest.fn(async () => []),
  getLatestItemsInLibrary: jest.fn(async () => []),
  getNextUp: jest.fn(async () => []),
  getResumeItems: jest.fn(async () => []),
  getSeasons: jest.fn(async () => []),
  getSimilarItems: jest.fn(async () => []),
  getStreamUrl: jest.fn(async () => ({
    itemId: 'test-item',
    playMethod: 'DirectPlay',
    url: 'https://example.com/video.mp4',
  })),
  reportPlaybackProgress: jest.fn(async () => undefined),
  reportPlaybackStart: jest.fn(async () => undefined),
  reportPlaybackStopped: jest.fn(async () => undefined),
}));

jest.mock('../src/services/jellyfin/music', () => ({
  ...jest.requireActual('../src/services/jellyfin/music'),
  getAlbums: jest.fn(async () => ({items: [], total: 0})),
  hasMusicLibraries: jest.fn(async () => false),
}));

jest.mock('../src/services/iap', () => ({
  checkAstraProReceipt: jest.fn(async () => false),
  isIapAvailable: jest.fn(() => false),
  purchaseAstraPro: jest.fn(async () => false),
}));

// Required inside the factory rather than imported: a jest.mock factory may not
// close over an import. Reading the real id keeps these tests off the
// version-bump checklist.
const acknowledgedNoticeId = (): string =>
  require('../src/config/releaseNotes').CURRENT_NOTICE_ID;

jest.mock('../src/services/storage', () => ({
  defaultPlaybackPrefs: {
    hlsSegmentLengthSeconds: 0,
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
    hlsSegmentLengthSeconds: 0,
    maxAudioChannels: 6,
    maxBitrateBps: 80000000,
    preferredAudioLanguage: 'en',
    seekDurationSeconds: 10,
    showPlaybackStats: false,
    version: 1,
  })),
  readServerProfiles: jest.fn(async () => []),
  // Notice already acknowledged: these tests exercise navigation and the exit
  // prompt, and an unacknowledged notice deliberately replaces the screen.
  readAppState: jest.fn(async () => ({
    acknowledgedNoticeId: acknowledgedNoticeId(),
    isPro: false,
    launchCount: 0,
  })),
  setProStatus: jest.fn(async () => undefined),
  shouldShowSupportCard: jest.requireActual('../src/services/storage')
    .shouldShowSupportCard,
  upsertServerProfile: jest.fn(async () => undefined),
  writeAppState: jest.fn(async () => ({isPro: false, launchCount: 1})),
  writePlaybackPreferences: jest.fn(async () => undefined),
}));

// These tests are about navigation, so the first-run capability questions are
// answered here. The wizard itself is covered in ServerCapabilities.spec.
jest.mock('../src/services/serverCapabilities', () => ({
  acknowledgeCapabilityNotice: jest.fn(async () => undefined),
  applyServerCapabilities: jest.fn(async () => ({
    interviewCompleted: true,
    lastTranscodeProbeAtMs: 0,
    maxAudioChannels: 6,
    maxAudioChannelsSource: 'stated',
    pendingCapabilityNotice: false,
    updatedAtMs: 1,
    videoTranscode: 'hardware',
    videoTranscodeSource: 'stated',
  })),
  getServerCapabilities: jest.fn(async () => ({
    interviewCompleted: true,
    lastTranscodeProbeAtMs: 0,
    maxAudioChannels: 6,
    maxAudioChannelsSource: 'stated',
    pendingCapabilityNotice: false,
    updatedAtMs: 1,
    videoTranscode: 'hardware',
    videoTranscodeSource: 'stated',
  })),
  serverCapabilityKey: (url: string) => url,
}));

describe('App', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHardwareBackPressHandler = undefined;
    // clearAllMocks resets calls but not implementations, so a test that makes
    // the notice unacknowledged would otherwise leak into the next one and
    // hide the screen it expects.
    (readAppState as jest.Mock).mockResolvedValue({
      acknowledgedNoticeId: acknowledgedNoticeId(),
      isPro: false,
      launchCount: 0,
    });
  });

  it('matches snapshot', async () => {
    const screen = render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('setup-screen')).toBeTruthy(),
    );
    expect(screen).toMatchSnapshot();
  });

  it('sheds caches when the app leaves the screen or memory runs short', async () => {
    const {useKeplerAppStateManager} = jest.requireMock(
      '@amazon-devices/react-native-kepler',
    );
    const listeners: Record<string, Array<(state?: string) => void>> = {};
    const manager = {
      addAppStateListener: jest.fn(
        (event: string, callback: (state?: string) => void) => {
          (listeners[event] ??= []).push(callback);
          return {remove: jest.fn()};
        },
      ),
      getComponentInstance: jest.fn(() => ({})),
    };
    (useKeplerAppStateManager as jest.Mock).mockReturnValue(manager);
    const trim = jest.fn();
    const off = onMemoryTrim(trim);

    try {
      const screen = render(<App />);
      await waitFor(() =>
        expect(screen.getByTestId('setup-screen')).toBeTruthy(),
      );

      listeners.change.forEach((callback) => callback('background'));
      expect(trim).toHaveBeenLastCalledWith('background');

      listeners.memoryWarning.forEach((callback) => callback());
      expect(trim).toHaveBeenLastCalledWith('critical');
    } finally {
      off();
      (useKeplerAppStateManager as jest.Mock).mockImplementation(() => ({
        addAppStateListener: jest.fn(() => ({remove: jest.fn()})),
        getComponentInstance: jest.fn(() => ({})),
      }));
    }
  });

  it('offers Retry when the saved servers cannot be read, then recovers', async () => {
    (readServerProfiles as jest.Mock).mockRejectedValueOnce(
      new Error('storage unavailable'),
    );
    const screen = render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('navigation-load-failed')).toBeTruthy(),
    );
    // Never guessed "fresh install": Setup must not appear over stored
    // sign-ins just because one read failed.
    expect(screen.queryByTestId('setup-screen')).toBeNull();

    fireEvent.press(screen.getByTestId('navigation-retry'));
    await waitFor(() =>
      expect(screen.getByTestId('setup-screen')).toBeTruthy(),
    );
    expect(readServerProfiles).toHaveBeenCalledTimes(2);
  });

  it('launches setup when no server profile exists', async () => {
    const screen = render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('setup-screen')).toBeTruthy(),
    );
    expect(readServerProfiles).toHaveBeenCalledTimes(1);
  });

  it('asks for a language on first run and then shows setup in it', async () => {
    let stored: string | null = null;
    (readStoredLocale as jest.Mock).mockImplementation(async () => stored);
    (storeLocale as jest.Mock).mockImplementation(async (locale: string) => {
      stored = locale;
    });
    const screen = render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('language-picker')).toBeTruthy(),
    );
    expect(screen.getByText('Deutsch')).toBeTruthy();

    // The choice is stored before the navigator remounts in the new language.
    await act(async () => {
      fireEvent.press(screen.getByTestId('language-de'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('setup-screen')).toBeTruthy(),
    );
    expect(storeLocale).toHaveBeenCalledWith('de');
    expect(getLocale()).toBe('de');
    expect(screen.getByText('Verbinde deinen Medienserver')).toBeTruthy();
    (readStoredLocale as jest.Mock).mockImplementation(async () => 'en');
    setActiveLocale('en');
  });

  it('keeps English for existing users who never chose a language', async () => {
    (readStoredLocale as jest.Mock).mockResolvedValueOnce(null);
    (readServerProfiles as jest.Mock).mockResolvedValueOnce([
      {id: 'p', name: 'Home', serverUrl: 'http://x', userId: 'u'},
    ]);
    const screen = render(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('setup-screen')).toBeTruthy(),
    );
    expect(screen.queryByTestId('language-picker')).toBeNull();
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

  it("replaces the screen with the what's new notice until it is acknowledged", async () => {
    // The notice must not merely overlay the screen: on device the screen
    // behind kept focus, so the first centre press selected a library item and
    // navigated away instead of dismissing, leaving the notice unacknowledged.
    const serverProfile = {
      accessToken: 'test-token',
      id: 'test-server',
      lastUsed: 1,
      name: 'Test Server',
      url: 'http://server.local',
      userId: 'user-1',
    };
    (getLastUsedServerProfile as jest.Mock).mockResolvedValue(serverProfile);
    (readServerProfiles as jest.Mock).mockResolvedValue([serverProfile]);
    (readAppState as jest.Mock).mockResolvedValue({
      acknowledgedNoticeId: '',
      isPro: false,
      launchCount: 0,
    });

    const screen = render(<App />);

    await waitFor(() =>
      expect(screen.getByTestId('whats-new-notice')).toBeTruthy(),
    );
    expect(screen.queryByTestId('home-screen')).toBeNull();
    expect(screen.getByTestId('whats-new-notice-ok')).toBeTruthy();
  });

  describe('support card', () => {
    const serverProfile = {
      accessToken: 'test-token',
      id: 'test-server',
      lastUsed: 1,
      name: 'Test Server',
      url: 'http://server.local',
      userId: 'user-1',
    };
    const signIn = (playbackCount: number, supportCardShown = false) => {
      (getLastUsedServerProfile as jest.Mock).mockResolvedValue(serverProfile);
      (readServerProfiles as jest.Mock).mockResolvedValue([serverProfile]);
      (readAppState as jest.Mock).mockResolvedValue({
        acknowledgedNoticeId: acknowledgedNoticeId(),
        isPro: false,
        launchCount: 3,
        playbackCount,
        supportCardShown,
      });
    };

    it('shows once on Home after 25 playbacks and remembers the dismissal', async () => {
      signIn(25);
      const screen = render(<App />);

      await waitFor(() =>
        expect(screen.getByTestId('support-card')).toBeTruthy(),
      );
      expect(screen.getByTestId('support-card-qr')).toBeTruthy();
      expect(screen.queryByTestId('home-screen')).toBeNull();

      fireEvent.press(screen.getByTestId('support-card-ok'));

      await waitFor(() =>
        expect(screen.getByTestId('home-screen')).toBeTruthy(),
      );
      expect(screen.queryByTestId('support-card')).toBeNull();
      expect(writeAppState).toHaveBeenCalledWith({supportCardShown: true});
    });

    it.each([
      ['before the 25th playback', 24, false],
      ['after it was dismissed', 80, true],
    ])('stays away %s', async (_label, count, shown) => {
      signIn(count, shown);
      const screen = render(<App />);

      await waitFor(() =>
        expect(screen.getByTestId('home-screen')).toBeTruthy(),
      );
      expect(screen.queryByTestId('support-card')).toBeNull();
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

  it('leaves on Back once the exit prompt has settled', async () => {
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
    const now = jest.spyOn(Date, 'now').mockReturnValue(10_000);
    try {
      const screen = render(<App />);
      await waitFor(() =>
        expect(screen.getByTestId('home-screen')).toBeTruthy(),
      );
      act(() => {
        mockHardwareBackPressHandler?.();
        mockHardwareBackPressHandler?.();
        mockHardwareBackPressHandler?.();
      });
      expect(screen.getByTestId('exit-confirmation')).toBeTruthy();

      // A press still in flight from opening the prompt does nothing.
      now.mockReturnValue(10_200);
      act(() => {
        mockHardwareBackPressHandler?.();
      });
      expect(screen.getByTestId('exit-confirmation')).toBeTruthy();
      expect(mockKeplerExitApp).not.toHaveBeenCalled();

      now.mockReturnValue(11_000);
      act(() => {
        mockHardwareBackPressHandler?.();
      });
      expect(mockKeplerExitApp).toHaveBeenCalledTimes(1);
    } finally {
      now.mockRestore();
    }
  });

  it('replaces the screen with a connection notice and reloads it on Retry', async () => {
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
    const librariesBefore = (getLibraries as jest.Mock).mock.calls.length;

    jest.useFakeTimers();
    try {
      act(() => {
        mockNetListener?.({isConnected: false});
        jest.advanceTimersByTime(3000);
      });
      expect(screen.getByTestId('connection-notice')).toBeTruthy();
      expect(screen.queryByTestId('home-screen')).toBeNull();

      mockNetRefresh.mockResolvedValueOnce({isConnected: false});
      await act(async () => {
        fireEvent.press(screen.getByTestId('connection-retry'));
      });
      expect(screen.getByTestId('connection-still-offline')).toBeTruthy();

      await act(async () => {
        fireEvent.press(screen.getByTestId('connection-retry'));
      });
      expect(screen.queryByTestId('connection-notice')).toBeNull();
    } finally {
      jest.useRealTimers();
    }
    await waitFor(() => expect(screen.getByTestId('home-screen')).toBeTruthy());
    await waitFor(() =>
      expect((getLibraries as jest.Mock).mock.calls.length).toBeGreaterThan(
        librariesBefore,
      ),
    );
  });

  it('pops back out of a nested library instead of offering to exit', async () => {
    // A view can put folders at its top level, and tapping one browses into
    // it. Back must then unwind the stack a screen at a time; only the home
    // screen may start the exit count.
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
    (getLibraries as jest.Mock).mockResolvedValue([
      {id: 'view-1', name: 'Watchlist', type: 'somethingnew'},
    ]);
    (getItems as jest.Mock).mockResolvedValue([
      {id: 'folder-1', name: 'A Folder', type: 'Folder', isFolder: true},
    ]);

    const screen = render(<App />);
    await waitFor(() => expect(screen.getByTestId('home-screen')).toBeTruthy());

    fireEvent.press(screen.getByTestId('home-nav-other'));
    await waitFor(() =>
      expect(screen.getByTestId('library-screen')).toBeTruthy(),
    );

    fireEvent.press(screen.getByTestId('media-card-A Folder'));
    await waitFor(() =>
      expect(screen.getAllByText('A Folder').length).toBeGreaterThan(0),
    );

    // First back: out of the folder, still inside the library.
    await act(async () => {
      mockHardwareBackPressHandler?.();
    });
    expect(screen.queryByTestId('exit-confirmation')).toBeNull();
    await waitFor(() =>
      expect(screen.getAllByText('Watchlist').length).toBeGreaterThan(0),
    );

    // Second back: out of the library, home again — still no exit prompt.
    await act(async () => {
      mockHardwareBackPressHandler?.();
    });
    expect(screen.getByTestId('home-screen')).toBeTruthy();
    expect(screen.queryByTestId('exit-confirmation')).toBeNull();
    expect(mockKeplerExitApp).not.toHaveBeenCalled();
  });
});
