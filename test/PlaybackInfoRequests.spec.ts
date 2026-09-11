jest.mock('../src/services/deviceIdentity', () => ({
  initializeDeviceIdentity: jest.fn(async () => 'test-installation'),
  getDeviceId: () => 'test-installation',
  getDeviceName: () => 'FireTV',
}));

/**
 * Characterization tests for the PlaybackInfo request sequence.
 *
 * getStreamUrl is the single path every video playback goes through, and the
 * order and contents of its requests are load-bearing: the first request must
 * not claim to know a media source id, the audio re-request must reuse the id
 * the server just reported, and an unresolved item must be retried once before
 * failing.
 */
import {getStreamUrl, PLAYBACK_INFO_RETRY_MS} from '../src/services/jellyfin';

// The device's storage and audio hardware are not part of what these tests
// are about; both are stood in for so the request sequence is all that varies.
let mockUserPreferences: Record<string, unknown> = {};

jest.mock('../src/services/storage', () => {
  const actual = jest.requireActual('../src/services/storage');

  return {
    ...actual,
    getUserPreferences: async () => ({
      ...actual.defaultUserPreferences,
      ...mockUserPreferences,
    }),
    readPlaybackPreferences: async () => actual.defaultPlaybackPrefs,
  };
});

jest.mock('../src/services/mediaCapabilities', () => ({
  getAudioOutputCapabilities: async () => ({
    ac3: false,
    eac3: false,
    mp3: false,
    opus: false,
    dtsProbeSupported: false,
    dtsDirectPlayVerified: false,
    preferredTranscodeCodec: 'aac',
    probeSucceeded: true,
  }),
}));

const SERVER = 'https://media.example.com';
const TOKEN = 'token-123';
const ITEM = 'item-abc';
const USER = 'user-1';

interface Recorded {
  url: string;
  body: Record<string, unknown>;
}

/** Serves a scripted list of PlaybackInfo responses and records the requests. */
const mockPlaybackInfo = (responses: unknown[]) => {
  const requests: Recorded[] = [];
  let call = 0;

  global.fetch = jest.fn(async (url: string, options: {body?: string} = {}) => {
    requests.push({
      url,
      body: options.body ? JSON.parse(options.body) : {},
    });
    const response = responses[Math.min(call, responses.length - 1)];
    call += 1;

    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(response),
    };
  }) as unknown as typeof fetch;

  return requests;
};

const playableSource = (overrides: Record<string, unknown> = {}) => ({
  PlaySessionId: 'session-1',
  MediaSources: [
    {
      Id: 'source-from-server',
      Container: 'mkv',
      TranscodingUrl: '/videos/item-abc/master.m3u8?PlaySessionId=session-1',
      SupportsTranscoding: true,
      MediaStreams: [
        {Index: 0, Type: 'Video', Codec: 'h264', Height: 1080, Width: 1920},
        {
          Index: 1,
          Type: 'Audio',
          Codec: 'aac',
          Channels: 2,
          Language: 'eng',
          IsDefault: true,
        },
      ],
      ...overrides,
    },
  ],
});

/** A response shaped like an item whose source the server has not resolved. */
const unresolved = () => ({PlaySessionId: 'session-1', MediaSources: []});

/**
 * Fires only the retry wait immediately, so a test does not spend a real
 * second and a half asleep. Every other timer — notably getJson's request
 * timeout — keeps its normal behaviour.
 */
beforeEach(() => {
  mockUserPreferences = {};
  const realSetTimeout = global.setTimeout;

  jest.spyOn(global, 'setTimeout').mockImplementation(((
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ) => {
    if (ms === PLAYBACK_INFO_RETRY_MS) {
      callback();
      return 0;
    }

    return realSetTimeout(callback, ms, ...args);
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('the first PlaybackInfo request', () => {
  it('does not claim to know a media source id', async () => {
    const requests = mockPlaybackInfo([playableSource()]);

    await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {audioStreamIndex: 1});

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toContain(`/Items/${ITEM}/PlaybackInfo`);
    expect(requests[0].body.MediaSourceId).toBeUndefined();
    expect(requests[0].body.UserId).toBe(USER);
  });

  it('sends a caller-supplied media source id when a reload has one', async () => {
    const requests = mockPlaybackInfo([playableSource()]);

    await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {
      audioStreamIndex: 1,
      mediaSourceId: 'source-from-a-previous-load',
    });

    expect(requests[0].body.MediaSourceId).toBe('source-from-a-previous-load');
  });

  it('asks for HLS rather than direct play', async () => {
    // Direct play blocks the JS thread on this device; the app is built
    // around the server's HLS output. Pinned so it cannot regress silently.
    const requests = mockPlaybackInfo([playableSource()]);

    await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {audioStreamIndex: 1});

    expect(requests[0].body.EnableDirectPlay).toBe(false);
    expect(requests[0].body.EnableDirectStream).toBe(false);
    expect(requests[0].body.AutoOpenLiveStream).toBe(true);
  });
});

describe('the audio re-request', () => {
  it('reuses the media source id the server reported', async () => {
    // No audioStreamIndex from the caller, so the service picks one itself
    // and asks again — pinned to the id it just learned.
    const requests = mockPlaybackInfo([playableSource(), playableSource()]);

    await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0);

    expect(requests).toHaveLength(2);
    expect(requests[0].body.MediaSourceId).toBeUndefined();
    expect(requests[1].body.MediaSourceId).toBe('source-from-server');
    expect(requests[1].body.AudioStreamIndex).toBe(1);
  });

  it('does not fire when the caller already chose a track', async () => {
    const requests = mockPlaybackInfo([playableSource()]);

    await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {audioStreamIndex: 1});

    expect(requests).toHaveLength(1);
  });

  it('keeps the first response when the re-request comes back empty', async () => {
    const requests = mockPlaybackInfo([playableSource(), unresolved()]);

    const stream = await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0);

    expect(requests).toHaveLength(2);
    expect(stream.mediaSourceId).toBe('source-from-server');
    expect(stream.url).toContain('master.m3u8');
  });
});

describe('an item the server has not resolved yet', () => {
  it('retries once and succeeds when the second answer is playable', async () => {
    const requests = mockPlaybackInfo([unresolved(), playableSource()]);

    const stream = await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {
      audioStreamIndex: 1,
    });

    expect(requests).toHaveLength(2);
    expect(stream.url).toContain('master.m3u8');
  });

  it('retries exactly once, then fails with a readable message', async () => {
    const requests = mockPlaybackInfo([unresolved(), unresolved()]);

    await expect(
      getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {audioStreamIndex: 1}),
    ).rejects.toThrow(
      'The server has no playable source for this item right now.',
    );

    expect(requests).toHaveLength(2);
  });

  it('treats a placeholder source with nothing to stream as unresolved', async () => {
    const placeholder = {
      PlaySessionId: 'session-1',
      MediaSources: [{Id: 'pending', MediaStreams: []}],
    };
    const requests = mockPlaybackInfo([placeholder, playableSource()]);

    await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {audioStreamIndex: 1});

    expect(requests).toHaveLength(2);
  });
});

describe('a locally hosted item', () => {
  it('resolves in one request when the caller picked a track', async () => {
    // The protected path: a local file, a chosen audio track, no retry.
    const requests = mockPlaybackInfo([playableSource()]);

    const stream = await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {
      audioStreamIndex: 1,
    });

    expect(requests).toHaveLength(1);
    expect(stream.playMethod).toBe('Transcode');
    expect(stream.mediaSourceId).toBe('source-from-server');
    expect(stream.audioTracks).toHaveLength(1);
    expect(stream.url).toContain('ApiKey=');
    expect(stream.url).not.toContain('api_key=');
  });

  it('uses ApiKey on the direct-stream fallback URL', async () => {
    const requests = mockPlaybackInfo([
      playableSource({
        SupportsDirectPlay: true,
        SupportsTranscoding: false,
        TranscodingUrl: undefined,
      }),
    ]);

    const stream = await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {
      audioStreamIndex: 1,
    });

    expect(requests).toHaveLength(1);
    expect(stream.url).toContain(`/Videos/${ITEM}/stream`);
    expect(new URL(stream.url).searchParams.get('ApiKey')).toBe(TOKEN);
    expect(stream.url).not.toContain('api_key=');
  });
});

/** A source with Spanish and English text subtitles and no server default. */
const subtitledSource = (overrides: Record<string, unknown> = {}) =>
  playableSource({
    MediaStreams: [
      {Index: 0, Type: 'Video', Codec: 'h264', Height: 1080, Width: 1920},
      {Index: 1, Type: 'Audio', Codec: 'aac', Channels: 2, Language: 'eng'},
      {Index: 2, Type: 'Subtitle', Codec: 'subrip', Language: 'spa'},
      {Index: 3, Type: 'Subtitle', Codec: 'subrip', Language: 'eng'},
      {
        Index: 4,
        Type: 'Subtitle',
        Codec: 'pgssub',
        Language: 'eng',
        IsForced: true,
      },
    ],
    ...overrides,
  });

describe('the global subtitle preference', () => {
  it('sends -1 on the pinned request when all subtitles are off', async () => {
    // The server would otherwise burn its default track in.
    mockUserPreferences = {subtitleMode: 'alwaysOff'};
    const requests = mockPlaybackInfo([
      subtitledSource({
        DefaultSubtitleStreamIndex: 2,
        TranscodingUrl:
          '/videos/item-abc/master.m3u8?PlaySessionId=session-1&SubtitleStreamIndex=2&SubtitleMethod=Encode',
      }),
      subtitledSource(),
    ]);

    const stream = await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {
      audioStreamIndex: 1,
    });

    expect(requests).toHaveLength(2);
    expect(requests[0].body.SubtitleStreamIndex).toBeUndefined();
    expect(requests[1].body.MediaSourceId).toBe('source-from-server');
    expect(requests[1].body.SubtitleStreamIndex).toBe(-1);
    expect(requests[1].body.AlwaysBurnInSubtitleWhenTranscoding).toBeFalsy();
    expect(requests[1].body.AllowVideoStreamCopy).toBe(true);
    expect(stream.subtitleStreamIndex).toBeUndefined();
    expect(stream.subtitleBurnIn).toBe(false);
  });

  it('does not re-request when off is wanted and the server chose nothing', async () => {
    mockUserPreferences = {subtitleMode: 'alwaysOff'};
    const requests = mockPlaybackInfo([subtitledSource()]);

    const stream = await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {
      audioStreamIndex: 1,
    });

    expect(requests).toHaveLength(1);
    expect(stream.subtitleStreamIndex).toBeUndefined();
  });

  it('uses ApiKey for fallback subtitle delivery URLs', async () => {
    const requests = mockPlaybackInfo([subtitledSource()]);

    const stream = await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {
      audioStreamIndex: 1,
    });

    expect(requests).toHaveLength(1);
    expect(stream.subtitleTracks[0].deliveryUrl).toContain('ApiKey=');
    expect(stream.subtitleTracks[0].deliveryUrl).not.toContain('api_key=');
  });

  it('picks the preferred language and keeps the stream copy for a text track', async () => {
    mockUserPreferences = {
      preferredSubtitleLanguage: 'English',
      subtitleMode: 'alwaysOn',
    };
    const requests = mockPlaybackInfo([subtitledSource(), subtitledSource()]);

    const stream = await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {
      audioStreamIndex: 1,
    });

    expect(requests).toHaveLength(2);
    expect(requests[1].body.MediaSourceId).toBe('source-from-server');
    expect(requests[1].body.AudioStreamIndex).toBe(1);
    expect(requests[1].body.SubtitleStreamIndex).toBe(3);
    // Stream 3 is subrip: the app renders it, so the server keeps its copy
    // instead of re-encoding the video to paint the text on (issue #20).
    expect(requests[1].body.AlwaysBurnInSubtitleWhenTranscoding).toBeFalsy();
    expect(requests[1].body.AllowVideoStreamCopy).toBe(true);
    expect(stream.subtitleStreamIndex).toBe(3);
    expect(stream.subtitleBurnIn).toBe(false);
    expect(
      stream.subtitleTracks.find((track) => track.index === 3)?.burnInRequired,
    ).toBe(false);
    // Stream 4 is PGS, which has no in-app renderer.
    expect(
      stream.subtitleTracks.find((track) => track.index === 4)?.burnInRequired,
    ).toBe(true);
    expect(stream.subtitleTracks.map((track) => track.index)).toEqual([
      2, 3, 4,
    ]);
    expect(stream.subtitleTracks[2].isForced).toBe(true);
  });

  it('plays without subtitles when all-on finds no subtitle streams', async () => {
    mockUserPreferences = {subtitleMode: 'alwaysOn'};
    const requests = mockPlaybackInfo([playableSource()]);

    const stream = await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {
      audioStreamIndex: 1,
    });

    expect(requests).toHaveLength(1);
    expect(stream.subtitleStreamIndex).toBeUndefined();
  });

  it('follows the server default per video without forcing a re-encode', async () => {
    // The server's own default is a text track, which the app renders itself.
    mockUserPreferences = {subtitleMode: 'default'};
    const requests = mockPlaybackInfo([
      subtitledSource({DefaultSubtitleStreamIndex: 2}),
      subtitledSource({DefaultSubtitleStreamIndex: 2}),
    ]);

    const stream = await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {
      audioStreamIndex: 1,
    });

    expect(requests).toHaveLength(2);
    expect(requests[1].body.SubtitleStreamIndex).toBe(2);
    expect(requests[1].body.AlwaysBurnInSubtitleWhenTranscoding).toBeFalsy();
    expect(requests[1].body.AllowVideoStreamCopy).toBe(true);
    expect(stream.subtitleStreamIndex).toBe(2);
    expect(stream.subtitleBurnIn).toBe(false);
  });

  it('asks for burn-in when the chosen track is picture-based', async () => {
    // Stream 4 is PGS and forced; nothing in the app can draw it.
    mockUserPreferences = {subtitleMode: 'default'};
    const requests = mockPlaybackInfo([
      subtitledSource({DefaultSubtitleStreamIndex: 4}),
      subtitledSource({DefaultSubtitleStreamIndex: 4}),
    ]);

    const stream = await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {
      audioStreamIndex: 1,
    });

    expect(requests).toHaveLength(2);
    expect(requests[1].body.SubtitleStreamIndex).toBe(4);
    expect(requests[1].body.AlwaysBurnInSubtitleWhenTranscoding).toBe(true);
    expect(requests[1].body.AllowVideoStreamCopy).toBe(false);
    expect(stream.subtitleBurnIn).toBe(true);
  });

  it('accepts a server default the server already burns in without a second request', async () => {
    mockUserPreferences = {subtitleMode: 'default'};
    const requests = mockPlaybackInfo([
      subtitledSource({
        DefaultSubtitleStreamIndex: 4,
        TranscodingUrl:
          '/videos/item-abc/master.m3u8?PlaySessionId=session-1&SubtitleStreamIndex=4&SubtitleMethod=Encode',
      }),
    ]);

    const stream = await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {
      audioStreamIndex: 1,
    });

    expect(requests).toHaveLength(1);
    expect(stream.subtitleStreamIndex).toBe(4);
    expect(stream.subtitleBurnIn).toBe(true);
  });

  it('leaves a video with no server default alone in per-video mode', async () => {
    mockUserPreferences = {subtitleMode: 'default'};
    const requests = mockPlaybackInfo([subtitledSource()]);

    const stream = await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {
      audioStreamIndex: 1,
    });

    expect(requests).toHaveLength(1);
    expect(stream.subtitleStreamIndex).toBeUndefined();
  });

  it('takes only the forced track in forced-only mode', async () => {
    mockUserPreferences = {subtitleMode: 'forcedOnly'};
    const requests = mockPlaybackInfo([subtitledSource(), subtitledSource()]);

    const stream = await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {
      audioStreamIndex: 1,
    });

    expect(requests[1].body.SubtitleStreamIndex).toBe(4);
    expect(stream.subtitleStreamIndex).toBe(4);
  });

  it('pins audio and subtitle in the same re-request on a first load', async () => {
    mockUserPreferences = {
      preferredSubtitleLanguage: 'Spanish',
      subtitleMode: 'alwaysOn',
    };
    const requests = mockPlaybackInfo([subtitledSource(), subtitledSource()]);

    await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0);

    expect(requests).toHaveLength(2);
    expect(requests[1].body.AudioStreamIndex).toBe(1);
    expect(requests[1].body.SubtitleStreamIndex).toBe(2);
  });
});

describe('a subtitle chosen in the player', () => {
  it('sends a manual Off as -1 on the first request and skips the policy', async () => {
    mockUserPreferences = {subtitleMode: 'alwaysOn'};
    const requests = mockPlaybackInfo([
      subtitledSource({DefaultSubtitleStreamIndex: 2}),
    ]);

    const stream = await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {
      audioStreamIndex: 1,
      subtitleSelectionIsManual: true,
      subtitleStreamIndex: undefined,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].body.SubtitleStreamIndex).toBe(-1);
    expect(stream.subtitleStreamIndex).toBeUndefined();
    expect(stream.subtitleBurnIn).toBe(false);
  });

  it('passes a manual track through untouched even when the preference is off', async () => {
    mockUserPreferences = {subtitleMode: 'alwaysOff'};
    const requests = mockPlaybackInfo([subtitledSource()]);

    const stream = await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {
      alwaysBurnInSubtitleWhenTranscoding: true,
      audioStreamIndex: 1,
      forceTranscode: true,
      subtitleSelectionIsManual: true,
      subtitleStreamIndex: 2,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].body.SubtitleStreamIndex).toBe(2);
    expect(requests[0].body.AlwaysBurnInSubtitleWhenTranscoding).toBe(true);
    expect(requests[0].body.AllowVideoStreamCopy).toBe(false);
    expect(stream.subtitleStreamIndex).toBe(2);
    expect(stream.subtitleBurnIn).toBe(true);
  });
});

describe('Issue 21: degraded direct-stream responses', () => {
  const degraded = (overrides: Record<string, unknown> = {}) =>
    playableSource({
      Container: 'mkv',
      TranscodingUrl: '/videos/item-abc/stream?PlaySessionId=session-1',
      ...overrides,
    });

  it.each(['mkv', 'avi', 'webm', 'flv'])(
    'requests direct stream once for unsupported %s with a codec-less /stream URL',
    async (container) => {
      const requests = mockPlaybackInfo([
        degraded({Container: container}),
        playableSource({Container: container}),
      ]);

      const stream = await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {
        audioStreamIndex: 1,
      });

      expect(requests).toHaveLength(2);
      expect(stream.url).toContain('/master.m3u8');
      expect(requests[0].body.EnableDirectStream).toBe(false);
      expect(requests[1].body.EnableDirectStream).toBe(true);
      expect(requests[1].body.EnableDirectPlay).toBe(false);
    },
  );

  it.each(['mp4', 'm4v', 'ts'])(
    'leaves raw %s /stream responses unchanged',
    async (container) => {
      const requests = mockPlaybackInfo([degraded({Container: container})]);

      await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {
        audioStreamIndex: 1,
      });

      expect(requests).toHaveLength(1);
      expect(requests[0].body.EnableDirectStream).toBe(false);
    },
  );

  it('does not mistake an encoded /stream query value for the pathname', async () => {
    const requests = mockPlaybackInfo([
      degraded({
        TranscodingUrl:
          '/videos/item-abc/master.m3u8?Name=%2Fstream&PlaySessionId=session-1',
      }),
    ]);

    await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {audioStreamIndex: 1});

    expect(requests).toHaveLength(1);
  });

  it('retains the complete retry response, including session, source, and tracks', async () => {
    const retry = {
      PlaySessionId: 'retry-session',
      MediaSources: [
        {
          ...playableSource().MediaSources[0],
          Id: 'retry-source',
          TranscodingUrl:
            '/videos/item-abc/master.m3u8?PlaySessionId=retry-session',
          MediaStreams: [
            {Index: 7, Type: 'Video', Codec: 'hevc', Height: 720, Width: 1280},
            {Index: 8, Type: 'Audio', Codec: 'aac', Channels: 2},
          ],
        },
      ],
    };
    const requests = mockPlaybackInfo([degraded(), retry]);

    const stream = await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {
      audioStreamIndex: 8,
    });

    expect(requests).toHaveLength(2);
    expect(stream.playSessionId).toBe('retry-session');
    expect(stream.mediaSourceId).toBe('retry-source');
    expect(stream.audioTracks[0].index).toBe(8);
    expect(stream.sourceVideoCodec).toBe('hevc');
    expect(stream.url).toContain('PlaySessionId=retry-session');
  });

  it('applies the guard independently to separate invocations', async () => {
    const requests = mockPlaybackInfo([
      degraded(),
      playableSource(),
      degraded(),
      playableSource(),
    ]);

    await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {audioStreamIndex: 1});
    await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {audioStreamIndex: 1});

    expect(requests).toHaveLength(4);
    expect(requests[1].body.EnableDirectStream).toBe(true);
    expect(requests[3].body.EnableDirectStream).toBe(true);
  });

  it('recovers a late degraded response during audio/subtitle pinning only once', async () => {
    const retry = {
      PlaySessionId: 'late-session',
      MediaSources: [
        {
          ...playableSource().MediaSources[0],
          Id: 'late-source',
          DefaultSubtitleStreamIndex: 9,
          TranscodingUrl:
            '/videos/item-abc/master.m3u8?PlaySessionId=late-session&SubtitleStreamIndex=9&SubtitleMethod=Encode',
          MediaStreams: [
            {Index: 0, Type: 'Video', Codec: 'hevc'},
            {Index: 8, Type: 'Audio', Codec: 'ac3', Channels: 6},
            {Index: 9, Type: 'Subtitle', Codec: 'subrip', Language: 'eng'},
          ],
        },
      ],
    };
    const requests = mockPlaybackInfo([
      playableSource(),
      degraded(),
      retry,
      retry,
    ]);

    const stream = await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0);

    expect(requests).toHaveLength(4);
    expect(requests[2].body.EnableDirectStream).toBe(true);
    expect(requests[3].body.EnableDirectStream).toBe(true);
    expect(requests[3].body.MediaSourceId).toBe('late-source');
    expect(requests[3].body.AudioStreamIndex).toBe(8);
    expect(requests[3].body.SubtitleStreamIndex).toBe(9);
    expect(stream.mediaSourceId).toBe('late-source');
    expect(stream.playSessionId).toBe('late-session');
    expect(stream.audioStreamIndex).toBe(8);
    expect(stream.subtitleStreamIndex).toBe(9);
  });

  it('fails after the one degraded-response retry is exhausted', async () => {
    const requests = mockPlaybackInfo([degraded(), degraded()]);

    await expect(
      getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {audioStreamIndex: 1}),
    ).rejects.toThrow(
      'This server is not permitted to transcode video for your account',
    );
    expect(requests).toHaveLength(2);
  });

  it.each(['videocodec=hevc', 'segmentcontainer=ts'])(
    'preserves a /stream URL with %s',
    async (parameter) => {
      const requests = mockPlaybackInfo([
        degraded({TranscodingUrl: `/videos/item-abc/stream?${parameter}`}),
      ]);
      await getStreamUrl(SERVER, TOKEN, ITEM, USER, 0, {audioStreamIndex: 1});
      expect(requests).toHaveLength(1);
    },
  );

  it('does not retry again if the track-pinned response degrades after recovery', async () => {
    const requests = mockPlaybackInfo([
      degraded(),
      playableSource(),
      degraded(),
    ]);
    await expect(getStreamUrl(SERVER, TOKEN, ITEM, USER, 0)).rejects.toThrow(
      'This server is not permitted to transcode video for your account',
    );
    expect(requests).toHaveLength(3);
  });
});
