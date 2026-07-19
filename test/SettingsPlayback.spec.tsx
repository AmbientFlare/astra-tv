import React from 'react';
import {fireEvent, render, waitFor} from '@testing-library/react-native';

import {
  PlaybackSettingsOverlay,
  PlaybackStatsOverlay,
} from '../src/screens/PlayerScreen';
import {SettingsScreen} from '../src/screens/SettingsScreen';
import {writePlaybackPreferences} from '../src/services/storage';

jest.mock('@amazon-devices/react-native-kepler', () => {
  const MockReact = require('react');
  const {View} = require('react-native');

  return {
    TVFocusGuideView: (props: Record<string, unknown>) =>
      MockReact.createElement(View, props),
    useKeplerAppStateManager: jest.fn(() => ({
      addAppStateListener: jest.fn(() => ({remove: jest.fn()})),
      getComponentInstance: jest.fn(),
    })),
    useKeplerBackHandler: jest.fn(() => ({
      addEventListener: jest.fn(() => ({remove: jest.fn()})),
    })),
    useTVEventHandler: jest.fn(),
  };
});

jest.mock('@amazon-devices/react-native-w3cmedia', () => ({
  KeplerVideoSurfaceView: 'KeplerVideoSurfaceView',
  VideoPlayer: jest.fn(),
}));

jest.mock('../src/services/jellyfin', () => ({
  measureServerBandwidth: jest.fn(async () => 100000000),
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
    homeSections: {},
    nextEpisodeAutoplay: false,
    nextEpisodeCountdownSeconds: 15,
    preferredSubtitleLanguage: 'English',
    skipIntroCredits: 'ask',
    subtitleMode: 'default',
  },
  getDisplayPreferences: jest.fn(async () => ({
    imageSize: 'medium',
    imageType: 'Primary',
  })),
  getUserPreferences: jest.fn(async () => ({
    accountSortBy: 'lastUsed',
    autoSignIn: 'mostRecent',
    focusedBackdropEnabled: true,
    homeSections: {},
    nextEpisodeAutoplay: false,
    nextEpisodeCountdownSeconds: 15,
    preferredSubtitleLanguage: 'English',
    skipIntroCredits: 'ask',
    subtitleMode: 'default',
  })),
  readPlaybackPreferences: jest.fn(async () => ({
    maxAudioChannels: 6,
    maxBitrateBps: 80000000,
    preferredAudioLanguage: 'en',
    seekDurationSeconds: 10,
    showPlaybackStats: false,
    version: 1,
  })),
  readServerProfiles: jest.fn(async () => []),
  removeServerProfile: jest.fn(async () => undefined),
  setDisplayPreferences: jest.fn(async () => undefined),
  signOutServerProfile: jest.fn(async () => undefined),
  updateUserPreferences: jest.fn(async (patch) => patch),
  writePlaybackPreferences: jest.fn(async (patch) => ({
    maxAudioChannels: 6,
    maxBitrateBps: 80000000,
    preferredAudioLanguage: 'en',
    seekDurationSeconds: 10,
    showPlaybackStats: Boolean(patch.showPlaybackStats),
    version: 1,
  })),
}));

const mockWritePlaybackPreferences =
  writePlaybackPreferences as jest.MockedFunction<
    typeof writePlaybackPreferences
  >;

const serverProfile = {
  accessToken: 'test-token',
  id: 'server-1',
  lastUsed: 1,
  name: 'Test Server',
  serverType: 'jellyfin' as const,
  serverUrl: 'https://example.com',
  userId: 'user-1',
};

describe('playback diagnostics entry points', () => {
  beforeEach(() => mockWritePlaybackPreferences.mockClear());

  it('shows the persistent toggle after navigating to Settings > Playback', async () => {
    const screen = render(<SettingsScreen serverProfile={serverProfile} />);

    fireEvent.press(screen.getByTestId('settings-Playback'));

    expect(screen.getByTestId('settings-toggle-Stats for Nerds')).toBeTruthy();
    fireEvent.press(screen.getByTestId('settings-toggle-Stats for Nerds'));

    await waitFor(() =>
      expect(mockWritePlaybackPreferences).toHaveBeenCalledWith({
        showPlaybackStats: true,
      }),
    );
  });

  it('also renders diagnostics in the separate in-player options overlay', () => {
    const screen = render(
      <PlaybackSettingsOverlay
        onSelectAudio={jest.fn()}
        onSelectSubtitle={jest.fn()}
        onToggleStats={jest.fn()}
        selectedAudioIndex={1}
        showStats={false}
        streamInfo={{
          audioStreamIndex: 1,
          audioTracks: [],
          itemId: 'item-1',
          playMethod: 'Transcode',
          qualityOptions: [],
          subtitleTracks: [],
          url: 'https://example.com/video.m3u8',
        }}
      />,
    );

    expect(screen.getByText('Diagnostics')).toBeTruthy();
    expect(screen.getByText('Stats for Nerds: Off')).toBeTruthy();
  });

  it('distinguishes source codecs from delivered codecs and copy from transcode', () => {
    const screen = render(
      <PlaybackStatsOverlay
        diagnostics={{
          activeVideoHeight: 2160,
          activeVideoWidth: 3840,
          bufferedAheadSeconds: 12.5,
          decodedFrames: 240,
          droppedFrames: 0,
          estimatedBandwidth: 100000000,
          streamBandwidth: 22700000,
        }}
        positionSeconds={15}
        streamInfo={{
          audioDeliveryMethod: 'Transcode',
          audioStreamIndex: 1,
          audioTracks: [
            {
              channels: 6,
              codec: 'dts',
              id: '1',
              index: 1,
              profile: 'DTS-HD MA',
              sampleRate: 48000,
              title: 'English DTS-HD MA 5.1',
              type: 'Audio',
            },
          ],
          deliveredAudioStreamIndex: 1,
          height: 2160,
          itemId: 'item-1',
          outputAudioBitrate: 448000,
          outputAudioCodec: 'aac',
          outputContainer: 'mp4',
          outputVideoCodec: 'hevc',
          playMethod: 'Transcode',
          qualityOptions: [],
          sourceAudioCodec: 'dts',
          sourceAudioProfile: 'DTS-HD MA',
          sourceAudioSampleRate: 48000,
          sourceContainer: 'mkv',
          sourceVideoCodec: 'hevc',
          subtitleTracks: [],
          transcodeReasons: ['AudioCodecNotSupported'],
          url: 'https://example.com/video.m3u8',
          videoDeliveryMethod: 'Copy',
          width: 3840,
        }}
      />,
    );

    expect(screen.getByText(/DTS DTS-HD MA → AAC/)).toBeTruthy();
    expect(screen.getByText(/Transcode {3}6 ch/)).toBeTruthy();
    expect(screen.getByText(/HEVC → HEVC {3}Copy/)).toBeTruthy();
    expect(
      screen.getByText(/Resolution {2}source 3840x2160 → active 3840x2160/),
    ).toBeTruthy();
    expect(screen.getByText(/MKV → HLS\/MP4/)).toBeTruthy();
    expect(screen.getByText(/AudioCodecNotSupported/)).toBeTruthy();
  });
});
