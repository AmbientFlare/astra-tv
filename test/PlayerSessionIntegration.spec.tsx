import React from 'react';
import {StyleSheet} from 'react-native';
import {getTrickplayInfo} from '../src/services/jellyfin/trickplay';
import {render, act, fireEvent} from '@testing-library/react-native';
import {
  startVideoEngagement,
  stopVideoEngagement,
} from '@astra/user-engagement';

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
let mockPlayEmitsPlaying = true;
let mockLoadGate: Promise<void> | undefined;
let mockAppState: (state: string) => void;
const mockManager = {
  addAppStateListener: jest.fn((_event, callback) => {
    mockAppState = callback;
    return {remove: jest.fn()};
  }),
  getComponentInstance: jest.fn(),
};
jest.mock('@amazon-devices/react-native-kepler', () => ({
  TVFocusGuideView: 'TVFocusGuideView',
  useKeplerAppStateManager: () => mockManager,
  useTVEventHandler: (handler: any) => {
    mockRemote = handler;
  },
}));
jest.mock('@amazon-devices/react-native-w3cmedia', () => ({
  KeplerMediaControlHandler: class {},
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
      if (mockPlayEmitsPlaying) {
        v.emit('playing');
      }
    });
    v.pause = jest.fn(() => {
      v.paused = true;
      v.emit('pause');
    });
    mockVideos.push(v);
    return v;
  }),
}));
let mockNetListener: ((state: {isConnected: boolean}) => void) | null = null;
const mockNetRefresh = jest.fn(async () => ({isConnected: true}));
jest.mock('@amazon-devices/keplerscript-netmgr-lib', () => ({
  configure: jest.fn(),
  addEventListener: (listener: typeof mockNetListener) => {
    mockNetListener = listener;
    return () => {
      mockNetListener = null;
    };
  },
  refresh: () => mockNetRefresh(),
}));
jest.mock('../src/services/jellyfin/trickplay', () => ({
  ...jest.requireActual('../src/services/jellyfin/trickplay'),
  getTrickplayInfo: jest.fn(async () => null),
}));
jest.mock('../src/components/VideoPauseIdleVisual', () => ({
  VideoPauseIdleVisual: () => null,
}));
jest.mock('@astra/user-engagement', () => ({
  startVideoEngagement: jest.fn(),
  stopVideoEngagement: jest.fn(),
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
    subtitleAppearance: 'shadow',
  },
  readPlaybackPreferences: jest.fn(async () => ({
    seekDurationSeconds: 10,
    maxBitrateBps: 1e8,
  })),
  getUserPreferences: jest.fn(async () => ({
    nextEpisodeAutoplay: false,
    nextEpisodeCountdownSeconds: 15,
    skipIntroCredits: 'ask',
    subtitleAppearance: 'shadow',
  })),
  recordPlayback: jest.fn(async () => 1),
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
      load: jest.fn(() => mockLoadGate ?? Promise.resolve()),
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
  ExternalSubtitleOverlay,
} from '../src/screens/PlayerScreen';
import {getSleepTimer, setSleepTimer} from '../src/services/sleepTimer';
import {getUserPreferences, recordPlayback} from '../src/services/storage';
import {createPositionStore} from '../src/screens/PlayerScreen/positionStore';
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
  describe('remote seeking', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const atPosition = async (position = 100) => {
      const view = mount();
      await start(view);
      const video = mockVideos[0];
      await act(async () => {
        video.currentTime = position;
        video.emit('timeupdate');
      });
      return {view, video};
    };
    const press = async (eventType: string, eventKeyAction = 0) => {
      await act(async () => {
        mockRemote({eventType, eventKeyAction});
        await flush();
      });
    };
    const advance = async (ms = 800) => {
      await act(async () => {
        jest.advanceTimersByTime(ms);
        await flush();
      });
    };
    const dispose = async (view: ReturnType<typeof mount>) => {
      await act(async () => {
        view.unmount();
        await flush();
      });
    };

    it('accelerates a held direction without seeking at each preview step', async () => {
      const {view, video} = await atPosition();
      await press('right');
      for (let n = 1; n <= 25; n++) {
        await advance(100);
        await press('right_down');
      }
      expect(video.currentTime).toBe(100);
      expect(view.getByTestId('player-seek-preview').props.children).toContain(
        '60s steps',
      );
      expect(view.getByTestId('player-seek-preview').props.children).toContain(
        '11:50',
      );
      expect(getStreamUrl).toHaveBeenCalledTimes(1);
      await press('right_up');
      await advance();
      expect(getStreamUrl).toHaveBeenCalledTimes(2);
      expect((getStreamUrl as jest.Mock).mock.calls[1][4]).toBe(710 * 10000000);
      await dispose(view);
    });

    it('keeps rapid taps precise when every press has a release', async () => {
      const {view, video} = await atPosition();
      for (let n = 0; n < 15; n++) {
        await press('right');
        await press('right', 1);
        await advance(100);
      }
      expect(video.currentTime).toBe(100);
      expect(view.getByTestId('player-seek-preview').props.children).toContain(
        '4:10',
      );
      await advance();
      expect((getStreamUrl as jest.Mock).mock.calls[1][4]).toBe(250 * 10000000);
      await dispose(view);
    });

    it('accelerates dedicated transport commands and resets on reversal', async () => {
      const {view, video} = await atPosition();
      const handler = video.setMediaControlFocus.mock.calls[0][1];
      for (let n = 0; n <= 10; n++) {
        await act(async () => {
          await handler.handleFastForward();
        });
        if (n < 10) {
          await advance(100);
        }
      }
      expect(view.getByTestId('player-seek-preview').props.children).toContain(
        '30s steps',
      );
      await act(async () => {
        await handler.handleRewind();
      });
      expect(view.getByTestId('player-seek-preview').props.children).toContain(
        '10s steps',
      );
      await press('skip_backward_up');
      await press('back');
      await advance();
      expect(video.currentTime).toBe(100);
      expect(getStreamUrl).toHaveBeenCalledTimes(1);
      await dispose(view);
    });

    it('combines directional presses and ignores both key-up forms', async () => {
      const {view, video} = await atPosition();
      await press('right');
      await press('right', 1);
      await press('right_up');
      await press('right');
      await press('left');
      expect(video.currentTime).toBe(100);
      expect(view.getByTestId('player-seek-preview').props.children).toContain(
        '1:50',
      );
      await advance();
      expect(video.currentTime).toBe(110);
      expect(getStreamUrl).toHaveBeenCalledTimes(1);
      await act(async () => {
        video.emit('seeked');
        await flush();
      });
      await dispose(view);
    });

    it('keeps seeking available when thumbnail metadata fails', async () => {
      (getTrickplayInfo as jest.Mock).mockRejectedValueOnce(
        new Error('no previews'),
      );
      const {view, video} = await atPosition();
      await press('right');
      await advance();
      expect(video.currentTime).toBe(110);
      expect(view.queryByTestId('player-seek-thumbnail')).toBeNull();
      await act(async () => {
        video.emit('seeked');
        await flush();
      });
      await dispose(view);
    });

    it('uses KMC exclusively for dedicated keys and shares the directional target', async () => {
      const {view, video} = await atPosition();
      const handler = video.setMediaControlFocus.mock.calls[0][1];
      await press('skip_forward');
      await act(async () => {
        await handler.handleFastForward();
      });
      await press('right');
      await press('skip_backward');
      await act(async () => {
        await handler.handleRewind();
      });
      expect(view.getByTestId('player-seek-preview').props.children).toContain(
        '1:50',
      );
      await advance();
      expect(video.currentTime).toBe(110);
      await act(async () => {
        video.emit('seeked');
        await flush();
      });
      await dispose(view);
    });

    it('cancels a preview with Back and commits early with Select', async () => {
      const {view, video} = await atPosition();
      await press('right');
      await press('back');
      await advance();
      expect(video.currentTime).toBe(100);
      await press('left');
      await press('select');
      expect(video.currentTime).toBe(90);
      await act(async () => {
        video.emit('seeked');
        await flush();
      });
      await press('select_up');
      expect(video.paused).toBe(false);
      await dispose(view);
    });

    it('holds the target through stale native updates and serializes subsequent seeks', async () => {
      const {view, video} = await atPosition();
      await press('right');
      await advance();
      await act(async () => {
        video.currentTime = 100;
        video.emit('timeupdate');
      });
      expect(view.getByTestId('player-seek-preview').props.children).toContain(
        '1:50',
      );
      await press('right');
      await press('right');
      await advance();
      expect(video.currentTime).toBe(100);
      await act(async () => {
        video.currentTime = 110;
        video.emit('seeked');
        await flush();
      });
      expect(video.currentTime).toBe(130);
      await act(async () => {
        video.emit('seeked');
        await flush();
      });
      await dispose(view);
    });

    it('seeks a resumed HLS stream on its media timeline', async () => {
      const {view, video} = await atPosition(0);
      await act(async () => {
        mockShakas[0].settings.onTimelineReady({skippedSeconds: 600});
        video.emit('playing');
      });
      await press('right');
      await advance();
      expect(video.currentTime).toBe(10);
      expect(view.getByTestId('player-seek-preview').props.children).toContain(
        '10:10',
      );
      await act(async () => {
        video.emit('seeked');
        await flush();
      });
      await dispose(view);
    });

    it('reloads once for a combined long jump and keeps paused playback paused', async () => {
      const {view, video} = await atPosition();
      await act(async () => {
        video.pause();
      });
      for (let n = 0; n < 6; n++) {
        await press('right');
      }
      expect(getStreamUrl).toHaveBeenCalledTimes(1);
      await advance();
      expect(getStreamUrl).toHaveBeenCalledTimes(2);
      expect((getStreamUrl as jest.Mock).mock.calls[1][4]).toBe(160 * 10000000);
      expect(mockVideos[1].paused).toBe(true);
      await dispose(view);
    });

    it('preserves pause after a short seek', async () => {
      const {view, video} = await atPosition();
      await act(async () => {
        video.pause();
      });
      await press('right');
      await advance();
      await act(async () => {
        video.emit('seeked');
        await flush();
      });
      expect(video.paused).toBe(true);
      await dispose(view);
    });

    it('waits for a direct-file reload to seek instead of leaving a delayed resume timer', async () => {
      (getStreamUrl as jest.Mock).mockResolvedValue({
        ...stream,
        url: 'https://server/video.mp4',
      });
      const {view} = await atPosition();
      for (let n = 0; n < 6; n++) {
        await press('right');
      }
      await advance();
      const video = mockVideos[1];
      expect(video.currentTime).toBe(160);
      await press('right');
      await advance();
      expect(video.currentTime).toBe(160);
      await act(async () => {
        video.emit('seeked');
        await flush();
      });
      expect(video.currentTime).toBe(170);
      await act(async () => {
        video.emit('seeked');
        await flush();
      });
      await dispose(view);
    });

    it('waits for a reloaded stream’s timeline before applying a queued skip', async () => {
      const {view} = await atPosition();
      mockPlayEmitsPlaying = false;
      for (let n = 0; n < 6; n++) {
        await press('right');
      }
      await advance();
      expect(mockVideos).toHaveLength(2);
      await press('right_down');
      await advance();
      const video = mockVideos[1];
      expect(video.currentTime).toBe(0);
      await act(async () => {
        video.emit('playing');
        await flush();
      });
      expect(video.currentTime).toBe(10);
      expect(getStreamUrl).toHaveBeenCalledTimes(2);
      await act(async () => {
        video.emit('seeked');
        await flush();
      });
      await dispose(view);
    });

    it('routes absolute KMC seeks on the movie timeline', async () => {
      const {view, video} = await atPosition();
      const handler = video.setMediaControlFocus.mock.calls[0][1];
      await act(async () => {
        await handler.handleSeek({seconds: 120, nanoseconds: 500000000});
      });
      await advance();
      expect(video.currentTime).toBe(120.5);
      await act(async () => {
        video.emit('seeked');
        await flush();
      });
      await dispose(view);
    });

    it('finishes the item on a long jump into its last seconds', async () => {
      const {view, video} = await atPosition();
      const handler = video.setMediaControlFocus.mock.calls[0][1];
      await act(async () => {
        await handler.handleSeek({seconds: 999, nanoseconds: 0});
      });
      await advance();
      // A transcode can't start a second from the end; no reload is asked for.
      expect(getStreamUrl).toHaveBeenCalledTimes(1);
      expect(reportPlaybackStopped).toHaveBeenCalled();
      expect(video.paused).toBe(true);
      await dispose(view);
    });

    it('recovers a missing seek completion by reloading at the requested target', async () => {
      const {view} = await atPosition();
      await press('right');
      await advance();
      await advance(15000);
      expect(getStreamUrl).toHaveBeenCalledTimes(2);
      expect((getStreamUrl as jest.Mock).mock.calls[1][4]).toBe(110 * 10000000);
      await dispose(view);
    });

    it('discards a delayed seek when the player is unmounted', async () => {
      const {view, video} = await atPosition();
      await press('right');
      await dispose(view);
      await advance();
      expect(video.currentTime).toBe(100);
      expect(getStreamUrl).toHaveBeenCalledTimes(1);
    });
  });

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
    mockPlayEmitsPlaying = true;
    mockLoadGate = undefined;
    (getStreamUrl as jest.Mock).mockResolvedValue({...stream});
    (reportPlaybackStart as jest.Mock).mockResolvedValue(undefined);
    (reportPlaybackStopped as jest.Mock).mockResolvedValue(undefined);
  });

  it('holds video engagement for as long as the player is open', async () => {
    const view = mount();
    await start(view);
    expect(startVideoEngagement).toHaveBeenCalledTimes(1);
    expect(stopVideoEngagement).not.toHaveBeenCalled();

    // Pausing must not release it; a paused movie still belongs to the viewer.
    await act(async () => {
      mockVideos[0].pause();
      await flush();
    });
    expect(stopVideoEngagement).not.toHaveBeenCalled();

    await act(async () => {
      view.unmount();
      await flush();
    });
    expect(stopVideoEngagement).toHaveBeenCalledTimes(1);
  });

  it('releases video engagement once playback finishes, and re-acquires on resume', async () => {
    const view = mount();
    await start(view);
    expect(startVideoEngagement).toHaveBeenCalledTimes(1);
    expect(stopVideoEngagement).not.toHaveBeenCalled();

    // A movie that plays out is nobody's any more: holding engagement here
    // would keep the device awake on the finished frame indefinitely.
    mockVideos[0].currentTime = 1000;
    await act(async () => {
      mockVideos[0].emit('ended');
      await flush();
    });
    expect(stopVideoEngagement).toHaveBeenCalled();

    // Playing again re-acquires it.
    const releases = (stopVideoEngagement as jest.Mock).mock.calls.length;
    await act(async () => {
      mockVideos[0].play();
      await flush();
    });
    expect(startVideoEngagement).toHaveBeenCalledTimes(2);
    expect(stopVideoEngagement).toHaveBeenCalledTimes(releases);

    await act(async () => {
      view.unmount();
      await flush();
    });
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

  it('reports the stop on background while a load is still running', async () => {
    const load = deferred<void>();
    mockLoadGate = load.promise;
    const view = mount();
    // The surface callback waits for the load, so it is not awaited here.
    let started!: Promise<void>;
    await act(async () => {
      started = view
        .getByTestId('player-video-surface')
        .props.onSurfaceViewCreated('surface');
      await flush();
    });
    expect(mockShakas[0].load).toHaveBeenCalled();
    await act(async () => {
      mockAppState('background');
      await flush();
    });
    expect(reportPlaybackStopped).toHaveBeenCalledTimes(1);
    expect(mockVideos[0].deinitialize).not.toHaveBeenCalled();
    await act(async () => {
      load.resolve();
      await Promise.resolve(started).catch(() => undefined);
      await flush();
    });
    expect(reportPlaybackStopped).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('pauses on a lost connection and restarts from the same point on Retry', async () => {
    jest.useFakeTimers();
    try {
      const view = mount();
      await start(view);
      const video = mockVideos[0];
      await act(async () => {
        video.currentTime = 300;
        video.emit('timeupdate');
        await flush();
      });
      expect(video.paused).toBe(false);

      await act(async () => {
        mockNetListener?.({isConnected: false});
        jest.advanceTimersByTime(3000);
        await flush();
      });
      expect(view.getByTestId('connection-notice')).toBeTruthy();
      expect(video.paused).toBe(true);

      mockNetRefresh.mockResolvedValueOnce({isConnected: false});
      await act(async () => {
        fireEvent.press(view.getByTestId('connection-retry'));
        await flush();
      });
      expect(view.getByTestId('connection-still-offline')).toBeTruthy();
      expect(getStreamUrl).toHaveBeenCalledTimes(1);

      await act(async () => {
        fireEvent.press(view.getByTestId('connection-retry'));
        await flush();
      });
      expect(view.queryByTestId('connection-notice')).toBeNull();
      expect(getStreamUrl).toHaveBeenCalledTimes(2);
      expect((getStreamUrl as jest.Mock).mock.calls[1][4]).toBe(300 * 10000000);
      await act(async () => {
        view.unmount();
        await flush();
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('lets go of a destroyed surface at once, before the release that waits', async () => {
    const view = render(
      <PlayerScreen
        accessToken="token"
        item={item}
        serverUrl="https://server"
      />,
    );
    await start(view);
    const video = mockVideos[0];
    act(() => {
      view
        .getByTestId('player-video-surface')
        .props.onSurfaceViewDestroyed('surface');
    });
    // Synchronous: nothing queued has run yet.
    expect(video.clearSurfaceHandle).toHaveBeenCalledWith('surface');
    expect(video.deinitialize).not.toHaveBeenCalled();
    await act(async () => {
      await flush();
    });
    expect(video.clearSurfaceHandle).toHaveBeenCalledTimes(1);
    expect(video.deinitialize).toHaveBeenCalledTimes(1);
    expect(video.clearSurfaceHandle.mock.invocationCallOrder[0]).toBeLessThan(
      video.pause.mock.invocationCallOrder.at(-1),
    );
    view.unmount();
  });

  it('clears the surface before pausing when playback is closed', async () => {
    const view = render(
      <PlayerScreen
        accessToken="token"
        item={item}
        serverUrl="https://server"
      />,
    );
    await start(view);
    const video = mockVideos[0];
    video.pause.mockClear();
    await act(async () => {
      view.unmount();
      await flush();
    });
    expect(video.clearSurfaceHandle).toHaveBeenCalledTimes(1);
    expect(video.clearSurfaceHandle.mock.invocationCallOrder[0]).toBeLessThan(
      video.pause.mock.invocationCallOrder[0],
    );
    expect(video.deinitialize).toHaveBeenCalledTimes(1);
  });

  describe('subtitle presentation and controls', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    const advance = async (milliseconds = 5000) => {
      await act(async () => {
        jest.advanceTimersByTime(milliseconds);
        await flush();
      });
    };
    const dispose = async (view: ReturnType<typeof mount>) => {
      await act(async () => {
        view.unmount();
        await flush();
      });
    };

    it('renders readable subtitle text over the video without a background box', () => {
      const positionStore = createPositionStore(10);
      const cues = [
        {startTime: 10, endTime: 15, text: 'First line\nSecond line'},
      ];
      const view = render(
        <ExternalSubtitleOverlay cues={cues} positionStore={positionStore} />,
      );
      const textStyle = StyleSheet.flatten(
        view.getByText('First line\nSecond line').props.style,
      );
      expect(textStyle.backgroundColor).toBe('transparent');
      expect(textStyle.color).toBe('#FFFFFF');
      expect(textStyle.textShadowColor).toBe('#000000');
      expect(textStyle.textShadowRadius).toBeGreaterThan(0);
      const normalBottom = StyleSheet.flatten(
        view.getByTestId('player-external-subtitle').props.style,
      ).bottom;
      view.update(
        <ExternalSubtitleOverlay
          cues={cues}
          positionStore={positionStore}
          controlsVisible
        />,
      );
      expect(
        StyleSheet.flatten(
          view.getByTestId('player-external-subtitle').props.style,
        ).bottom,
      ).toBeGreaterThan(normalBottom);
      view.update(
        <ExternalSubtitleOverlay
          cues={cues}
          positionStore={positionStore}
          appearance="background"
        />,
      );
      expect(
        StyleSheet.flatten(
          view.getByText('First line\nSecond line').props.style,
        ).backgroundColor,
      ).toBe('rgba(0,0,0,0.78)');
      act(() => positionStore.set(16));
      expect(view.queryByTestId('player-external-subtitle')).toBeNull();
      view.unmount();
    });

    it.each(['shadow', 'background'] as const)(
      'loads the saved %s appearance and keeps cues updating after controls hide',
      async (appearance) => {
        (getUserPreferences as jest.Mock).mockResolvedValueOnce({
          nextEpisodeAutoplay: false,
          nextEpisodeCountdownSeconds: 15,
          skipIntroCredits: 'ask',
          subtitleAppearance: appearance,
        });
        const previousFetch = global.fetch;
        global.fetch = jest.fn().mockResolvedValue({
          ok: true,
          text: async () =>
            'WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nFirst subtitle\n\n00:00:10.000 --> 00:00:20.000\nNext subtitle',
        });
        (getStreamUrl as jest.Mock).mockResolvedValue({
          ...stream,
          subtitleStreamIndex: 2,
          subtitleTracks: [
            {
              index: 2,
              deliveryUrl: 'https://server/subtitles.vtt',
              burnInRequired: false,
            },
          ],
        });
        const view = mount();
        try {
          await start(view);
          expect(
            StyleSheet.flatten(view.getByText('First subtitle').props.style)
              .backgroundColor,
          ).toBe(appearance === 'shadow' ? 'transparent' : 'rgba(0,0,0,0.78)');
          const raisedBottom = StyleSheet.flatten(
            view.getByTestId('player-external-subtitle').props.style,
          ).bottom;
          await advance();
          expect(view.queryByTestId('player-controls-overlay')).toBeNull();
          expect(view.getByText('First subtitle')).toBeTruthy();
          expect(
            StyleSheet.flatten(
              view.getByTestId('player-external-subtitle').props.style,
            ).bottom,
          ).toBeLessThan(raisedBottom);
          await act(async () => {
            mockVideos[0].currentTime = 12;
            mockVideos[0].emit('timeupdate');
          });
          expect(view.getByText('Next subtitle')).toBeTruthy();
          expect(view.queryByTestId('player-controls-overlay')).toBeNull();
        } finally {
          await dispose(view);
          global.fetch = previousFetch;
        }
      },
    );

    it('keeps controls visible while paused, then hides after playback resumes', async () => {
      const view = mount();
      await start(view);
      await advance();
      expect(view.queryByTestId('player-controls-overlay')).toBeNull();
      await act(async () => {
        mockVideos[0].pause();
      });
      await advance(6000);
      expect(view.getByTestId('player-controls-overlay')).toBeTruthy();
      await act(async () => {
        mockVideos[0].play();
      });
      await advance();
      expect(view.queryByTestId('player-controls-overlay')).toBeNull();
      await dispose(view);
    });

    it.each(['waiting', 'stalled'])(
      'rearms hiding after %s ends with progress but no playing event',
      async (event) => {
        const view = mount();
        await start(view);
        await advance();
        await act(async () => {
          mockVideos[0].emit(event);
        });
        await advance(6000);
        expect(view.getByTestId('player-controls-overlay')).toBeTruthy();
        for (let seconds = 1; seconds <= 5; seconds++) {
          await act(async () => {
            mockVideos[0].currentTime = seconds;
            mockVideos[0].emit('timeupdate');
          });
          await advance(1000);
        }
        expect(view.queryByTestId('player-controls-overlay')).toBeNull();
        await dispose(view);
      },
    );

    it('uses playback state when the native paused getter lags behind playing', async () => {
      const view = mount();
      await start(view);
      // No pause event: the getter alone is stale, playback is still active.
      mockVideos[0].paused = true;
      await advance();
      expect(view.queryByTestId('player-controls-overlay')).toBeNull();
      await dispose(view);
    });

    it('pins settings until closed, then restarts the hide timer', async () => {
      const view = mount();
      await start(view);
      await act(async () => {
        mockRemote({eventType: 'menu'});
      });
      await advance(6000);
      expect(view.getByTestId('player-controls-overlay')).toBeTruthy();
      await act(async () => {
        mockRemote({eventType: 'back'});
      });
      await advance();
      expect(view.queryByTestId('player-controls-overlay')).toBeNull();
      await dispose(view);
    });
  });
  describe('sleep timer', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => {
      setSleepTimer(null);
      jest.useRealTimers();
    });

    const settle = async (ms = 0) => {
      await act(async () => {
        jest.advanceTimersByTime(ms);
        await flush();
      });
    };

    it('pauses, reports the stop, and resumes from the same point on Select', async () => {
      const counted = (recordPlayback as jest.Mock).mock.calls.length;
      const view = mount();
      await start(view);
      const video = mockVideos[0];
      await act(async () => {
        video.currentTime = 600;
        video.emit('timeupdate');
      });
      await act(async () => setSleepTimer(15));
      await settle(15 * 60_000);

      expect(video.paused).toBe(true);
      expect(reportPlaybackStopped).toHaveBeenCalledTimes(1);
      expect(view.getByTestId('player-sleep-notice')).toBeTruthy();
      expect(getSleepTimer()).toBeNull();
      // The frozen test clock reads as a stall, so a recovery load is under
      // way when the timer runs out. It must land paused and unreported.
      const starts = (reportPlaybackStart as jest.Mock).mock.calls.length;
      await settle(5000);
      expect(mockVideos[mockVideos.length - 1].paused).toBe(true);
      expect(reportPlaybackStart).toHaveBeenCalledTimes(starts);
      const loads = (getStreamUrl as jest.Mock).mock.calls.length;

      await act(async () => {
        mockRemote({eventType: 'select'});
        await flush();
      });
      await settle();
      expect(view.queryByTestId('player-sleep-notice')).toBeNull();
      expect(getStreamUrl).toHaveBeenCalledTimes(loads + 1);
      expect((getStreamUrl as jest.Mock).mock.calls[loads][4]).toBe(
        600 * 10000000,
      );
      // One press is enough: the new session plays, it does not keep the
      // sleep pause.
      expect(mockVideos[mockVideos.length - 1].paused).toBe(false);
      // Reloads and the new session after waking are still one playback.
      expect(recordPlayback).toHaveBeenCalledTimes(counted + 1);
      await act(async () => {
        view.unmount();
        await flush();
      });
    });

    it('starts a new session when Alexa plays the paused video', async () => {
      const view = mount();
      await start(view);
      await act(async () => setSleepTimer(15));
      await settle(15 * 60_000);
      const loads = (getStreamUrl as jest.Mock).mock.calls.length;

      await act(async () => {
        mockVideos[mockVideos.length - 1].play();
        await flush();
      });
      await settle();
      expect(view.queryByTestId('player-sleep-notice')).toBeNull();
      expect(getStreamUrl).toHaveBeenCalledTimes(loads + 1);
      await act(async () => {
        view.unmount();
        await flush();
      });
    });

    it('holds at the end of the video for an end-of-episode timer', async () => {
      const view = mount();
      await start(view);
      await act(async () => setSleepTimer('endOfItem'));
      mockVideos[0].currentTime = 1000;
      await act(async () => {
        mockVideos[0].emit('ended');
        await flush();
      });
      expect(view.getByTestId('player-sleep-notice')).toBeTruthy();
      expect(getSleepTimer()).toBeNull();
      await act(async () => {
        view.unmount();
        await flush();
      });
    });

    it('holds at the end when the stream freezes in its last seconds', async () => {
      const view = mount();
      await start(view);
      await act(async () => setSleepTimer('endOfItem'));
      const video = mockVideos[0];
      await act(async () => {
        video.currentTime = 999.4;
        video.emit('timeupdate');
      });
      // No `ended` arrives; two checks with no progress are enough.
      await settle(6000);
      expect(view.getByTestId('player-sleep-notice')).toBeTruthy();
      expect(getSleepTimer()).toBeNull();
      expect(mockVideos).toHaveLength(1);
      await act(async () => {
        view.unmount();
        await flush();
      });
    });

    it('finishes instead of reloading on a stall shortly before the end', async () => {
      const view = mount();
      await start(view);
      await act(async () => setSleepTimer('endOfItem'));
      const video = mockVideos[0];
      await act(async () => {
        video.currentTime = 995;
        video.emit('timeupdate');
      });
      await settle(40_000);
      expect(view.getByTestId('player-sleep-notice')).toBeTruthy();
      expect(mockVideos).toHaveLength(1);
      await act(async () => {
        view.unmount();
        await flush();
      });
    });

    it('drops the timer when the viewer leaves the player', async () => {
      const view = mount();
      await start(view);
      await act(async () => setSleepTimer(30));
      await act(async () => {
        view.unmount();
        await flush();
      });
      expect(getSleepTimer()).toBeNull();
    });
  });
});
