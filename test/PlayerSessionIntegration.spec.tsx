import React from 'react';
import {render, act} from '@testing-library/react-native';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return {promise, resolve};
};
const mockVideos: any[] = [];
const mockShakas: any[] = [];
let mockRemote: (event: any) => void;
let mockAppState: (state: string) => void;
const mockManager = {
  addAppStateListener: jest.fn((_event, callback) => {
    mockAppState = callback;
    return {remove: jest.fn()};
  }),
  getComponentInstance: jest.fn(),
};
jest.mock('@amazon-devices/react-native-kepler', () => ({
  useKeplerAppStateManager: () => mockManager,
  useTVEventHandler: (handler: any) => {
    mockRemote = handler;
  },
}));
jest.mock('@amazon-devices/react-native-w3cmedia', () => ({
  KeplerVideoSurfaceView: 'KeplerVideoSurfaceView',
  VideoPlayer: jest.fn().mockImplementation(() => {
    const listeners = new Map<string, Set<() => void>>();
    const v: any = {
      paused: true,
      duration: 1000,
      currentTime: 0,
      emit: (event: string) => listeners.get(event)?.forEach((fn) => fn()),
      initialize: jest.fn(async () => undefined),
      setMediaControlFocus: jest.fn(async () => undefined),
      setSurfaceHandle: jest.fn(),
      clearSurfaceHandle: jest.fn(),
      deinitialize: jest.fn(async () => undefined),
      addEventListener: (event: string, fn: () => void) => {
        const set = listeners.get(event) ?? new Set();
        set.add(fn);
        listeners.set(event, set);
      },
      removeEventListener: (event: string, fn: () => void) =>
        listeners.get(event)?.delete(fn),
      load: jest.fn(),
    };
    v.play = jest.fn(() => {
      v.paused = false;
      v.emit('playing');
    });
    v.pause = jest.fn(() => {
      v.paused = true;
      v.emit('pause');
    });
    mockVideos.push(v);
    return v;
  }),
}));
jest.mock('../src/components/VideoPauseIdleVisual', () => ({
  VideoPauseIdleVisual: () => null,
}));
jest.mock('../src/services/audioPlayer', () => ({
  audioPlayback: {stop: jest.fn(async () => undefined)},
}));
jest.mock('../src/services/storage', () => ({
  defaultPlaybackPrefs: {seekDurationSeconds: 10, maxBitrateBps: 1e8},
  defaultUserPreferences: {
    nextEpisodeAutoplay: false,
    nextEpisodeCountdownSeconds: 15,
    skipIntroCredits: 'ask',
  },
  readPlaybackPreferences: jest.fn(async () => ({
    seekDurationSeconds: 10,
    maxBitrateBps: 1e8,
  })),
  getUserPreferences: jest.fn(async () => ({
    nextEpisodeAutoplay: false,
    nextEpisodeCountdownSeconds: 15,
    skipIntroCredits: 'ask',
  })),
}));
jest.mock('../src/services/jellyfin', () => ({
  getMediaSegments: jest.fn(async () => []),
  getAdjacentEpisodes: jest.fn(async () => []),
  getStreamUrl: jest.fn(),
  reportPlaybackStart: jest.fn(async () => undefined),
  reportPlaybackProgress: jest.fn(async () => undefined),
  reportPlaybackStopped: jest.fn(async () => undefined),
  sanitizeUrlForLog: () => 'redacted',
}));
jest.mock('../src/w3cmedia/shakaplayer/ShakaPlayer', () => ({
  ShakaPlayer: jest.fn().mockImplementation((_video, settings) => {
    const player = {
      settings,
      load: jest.fn(async () => undefined),
      unload: jest.fn(async () => undefined),
      cancelLoad: jest.fn(async () => undefined),
      getDebugStats: jest.fn(() => ({buffered: {total: []}})),
      waitForAppendComplete: jest.fn(async () => undefined),
    };
    mockShakas.push(player);
    return player;
  }),
}));

import {
  PlayerScreen,
  PlaybackSettingsOverlay,
} from '../src/screens/PlayerScreen';
import {
  getStreamUrl,
  reportPlaybackStart,
  reportPlaybackStopped,
} from '../src/services/jellyfin';

const item: any = {
  id: 'movie-1',
  name: 'Movie',
  type: 'Movie',
  runTimeTicks: 1000 * 10000000,
};
const stream: any = {
  itemId: item.id,
  mediaSourceId: 'source',
  playSessionId: 'session',
  url: 'https://server/video.m3u8',
  audioTracks: [],
  subtitleTracks: [],
  playMethod: 'Transcode',
  outputContainer: 'fMP4 HLS',
  runTimeTicks: item.runTimeTicks,
  qualityOptions: [],
};
const flush = async () => {
  for (let n = 0; n < 30; n++) await Promise.resolve();
};
const mount = () =>
  render(
    <PlayerScreen accessToken="token" item={item} serverUrl="https://server" />,
  );
const start = async (view: ReturnType<typeof mount>) => {
  await act(async () => {
    await view
      .getByTestId('player-video-surface')
      .props.onSurfaceViewCreated('surface');
  });
};

describe('PlayerScreen native session integration', () => {
  it('ignores duplicate surface creation while a session is playing', async () => {
    const view = mount();
    await start(view);
    await start(view);
    expect(mockVideos).toHaveLength(1);
    await act(async () => {
      view.unmount();
      await flush();
    });
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mockVideos.length = 0;
    mockShakas.length = 0;
    (getStreamUrl as jest.Mock).mockResolvedValue({...stream});
    (reportPlaybackStart as jest.Mock).mockResolvedValue(undefined);
    (reportPlaybackStopped as jest.Mock).mockResolvedValue(undefined);
  });

  it('cannot load/play or report start after unmount during PlaybackInfo', async () => {
    const pending = deferred<any>();
    (getStreamUrl as jest.Mock).mockReturnValue(pending.promise);
    const view = mount();
    let startup!: Promise<void>;
    await act(async () => {
      startup = view
        .getByTestId('player-video-surface')
        .props.onSurfaceViewCreated('surface');
      await flush();
    });
    expect(getStreamUrl).toHaveBeenCalledTimes(1);
    const signal = (getStreamUrl as jest.Mock).mock.calls[0][5].signal;
    await act(async () => {
      view.unmount();
      await flush();
    });
    expect(signal.aborted).toBe(true);
    await act(async () => {
      pending.resolve({...stream});
      await startup;
      await flush();
    });
    expect(mockVideos[0].deinitialize).toHaveBeenCalledTimes(1);
    expect(mockVideos[0].play).not.toHaveBeenCalled();
    expect(mockShakas).toHaveLength(0);
    expect(reportPlaybackStart).not.toHaveBeenCalled();
  });

  it('releases media even when the stopped report has not completed', async () => {
    const pending = deferred<void>();
    (reportPlaybackStopped as jest.Mock).mockReturnValue(pending.promise);
    const view = mount();
    await start(view);
    await act(async () => {
      view.unmount();
      await flush();
    });
    expect(reportPlaybackStopped).toHaveBeenCalledTimes(1);
    expect(mockShakas[0].unload).toHaveBeenCalledTimes(1);
    expect(mockVideos[0].deinitialize).toHaveBeenCalledTimes(1);
    pending.resolve();
    await flush();
  });

  it('does not turn a reporting failure into a playback failure', async () => {
    (reportPlaybackStart as jest.Mock).mockRejectedValue(new Error('offline'));
    const view = mount();
    await start(view);
    expect(mockVideos[0].play).toHaveBeenCalled();
    expect(view.queryByTestId('player-startup-state')).toBeNull();
    await act(async () => {
      view.unmount();
      await flush();
    });
  });

  it('recovers a Shaka network failure in a fresh player at the saved position', async () => {
    const view = mount();
    await start(view);
    mockVideos[0].currentTime = 100;
    mockVideos[0].emit('timeupdate');
    await act(async () => {
      mockShakas[0].settings.onError({
        source: 'shaka',
        code: 1002,
        category: 1,
        severity: 2,
      });
      await flush();
    });
    expect(mockVideos).toHaveLength(2);
    expect(mockVideos[0].deinitialize).toHaveBeenCalledTimes(1);
    expect((getStreamUrl as jest.Mock).mock.calls[1][4]).toBe(100 * 10000000);
    expect((getStreamUrl as jest.Mock).mock.calls[1][5].forceTranscode).toBe(
      false,
    );
    expect(mockVideos[1].play).toHaveBeenCalled();
    await act(async () => {
      view.unmount();
      await flush();
    });
  });

  it('treats early native EOF as recovery rather than completion', async () => {
    const view = mount();
    await start(view);
    mockVideos[0].currentTime = 100;
    await act(async () => {
      mockVideos[0].emit('ended');
      await flush();
    });
    expect(mockVideos).toHaveLength(2);
    expect(view.queryByTestId('player-end-prompt')).toBeNull();
    await act(async () => {
      view.unmount();
      await flush();
    });
  });

  it('removes subtitle-only conversion when selecting Off', async () => {
    const track: any = {
      id: 'sub',
      index: 2,
      title: 'English',
      burnInRequired: true,
    };
    (getStreamUrl as jest.Mock).mockImplementation(async (...args) => ({
      ...stream,
      subtitleTracks: [track],
      subtitleStreamIndex: args[5].subtitleStreamIndex,
      subtitleBurnIn: args[5].subtitleStreamIndex !== undefined,
    }));
    const view = mount();
    await start(view);
    await act(async () => {
      mockRemote({eventType: 'menu'});
    });
    await act(async () => {
      await view
        .UNSAFE_getByType(PlaybackSettingsOverlay)
        .props.onSelectSubtitle(track);
    });
    expect((getStreamUrl as jest.Mock).mock.calls[1][5].forceTranscode).toBe(
      true,
    );
    await act(async () => {
      mockRemote({eventType: 'context_menu'});
    });
    await act(async () => {
      await view
        .UNSAFE_getByType(PlaybackSettingsOverlay)
        .props.onSelectSubtitle(null);
    });
    expect((getStreamUrl as jest.Mock).mock.calls[2][5].forceTranscode).toBe(
      false,
    );
    await act(async () => {
      view.unmount();
      await flush();
    });
  });

  it('switches a text subtitle track in place, without a new stream', async () => {
    // Issue #20: the app draws text cues itself, so choosing one changes no
    // part of the stream the server is sending.
    const track: any = {
      id: 'sub',
      index: 2,
      title: 'English',
      burnInRequired: false,
      deliveryUrl: 'https://example.test/Subtitles/2/Stream.vtt',
    };
    (getStreamUrl as jest.Mock).mockImplementation(async () => ({
      ...stream,
      subtitleTracks: [track],
      subtitleStreamIndex: undefined,
      subtitleBurnIn: false,
    }));
    const view = mount();
    await start(view);
    const callsAfterStart = (getStreamUrl as jest.Mock).mock.calls.length;
    await act(async () => {
      mockRemote({eventType: 'menu'});
    });
    await act(async () => {
      await view
        .UNSAFE_getByType(PlaybackSettingsOverlay)
        .props.onSelectSubtitle(track);
    });
    expect((getStreamUrl as jest.Mock).mock.calls).toHaveLength(
      callsAfterStart,
    );
    expect(mockVideos).toHaveLength(1);
    await act(async () => {
      view.unmount();
      await flush();
    });
  });

  it('releases on background and navigates only once if the surface also disappears', async () => {
    const onBack = jest.fn();
    const view = render(
      <PlayerScreen
        accessToken="token"
        item={item}
        serverUrl="https://server"
        onBack={onBack}
      />,
    );
    await start(view);
    await act(async () => {
      mockAppState('background');
      view
        .getByTestId('player-video-surface')
        .props.onSurfaceViewDestroyed('surface');
      await flush();
    });
    expect(mockVideos[0].deinitialize).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
