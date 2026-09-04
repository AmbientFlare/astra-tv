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
    expect(stream.url).toContain('api_key=');
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

  it('picks the preferred language and asks for burn-in when all subtitles are on', async () => {
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
    expect(requests[1].body.AlwaysBurnInSubtitleWhenTranscoding).toBe(true);
    // Same request shape as the in-player switch that passed on hardware.
    expect(requests[1].body.AllowVideoStreamCopy).toBe(false);
    expect(stream.subtitleStreamIndex).toBe(3);
    expect(stream.subtitleBurnIn).toBe(true);
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

  it('follows the server default per video and burns it in when it is not yet', async () => {
    // Text tracks come back as external streams the app no longer renders,
    // so the server must be asked to burn its own choice in.
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
    expect(requests[1].body.AlwaysBurnInSubtitleWhenTranscoding).toBe(true);
    expect(stream.subtitleStreamIndex).toBe(2);
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
