/**
 * Jellyfin with legacy authorization off (the 12.0 default) answers a URL
 * carrying only `api_key` with 401, which is how music stopped playing on a
 * 12.0 server. Older servers read only `api_key`. URLs the player fetches
 * without headers must carry both.
 */
import {
  getAudioHlsStreamUrl,
  getAudioStreamUrl,
} from '../src/services/jellyfin/music';
import {tokenQuery} from '../src/services/jellyfin/http';
import {buildTranscodingUrl} from '../src/services/jellyfin/playbackHelpers';
import {
  getItemDetails,
  getItemsPage,
  getLatestItems,
  getMediaSegments,
  reportPlaybackProgress,
  setFavorite,
} from '../src/services/jellyfin';

jest.mock('../src/services/deviceIdentity', () => ({
  initializeDeviceIdentity: jest.fn(async () => 'test-installation'),
  getDeviceId: () => 'test-installation',
}));

const session = {
  accessToken: 'tok-1',
  serverUrl: 'http://media.example.com:8096',
  userId: 'user-1',
};

const params = (url: string) => new URL(url).searchParams;

describe('token in URLs', () => {
  it('sends both spellings', () => {
    expect(tokenQuery('tok-1')).toEqual({ApiKey: 'tok-1', api_key: 'tok-1'});
  });

  it.each([
    ['direct', getAudioStreamUrl],
    ['HLS', getAudioHlsStreamUrl],
  ])('puts both on the %s music stream URL', (_name, build) => {
    const url = build(session, 'track-1', 'device-1');
    expect(params(url).get('ApiKey')).toBe('tok-1');
    expect(params(url).get('api_key')).toBe('tok-1');
  });

  it('adds whichever one a server transcoding URL lacks, once', () => {
    const fromNewServer = buildTranscodingUrl(
      'http://media.example.com:8096',
      '/videos/abc/master.m3u8?MediaSourceId=abc&ApiKey=server-tok',
      'tok-1',
    );
    expect(params(fromNewServer).getAll('ApiKey')).toEqual(['server-tok']);
    expect(params(fromNewServer).get('api_key')).toBe('tok-1');

    const fromOldServer = buildTranscodingUrl(
      'http://media.example.com:8096',
      '/videos/abc/master.m3u8?MediaSourceId=abc&api_key=server-tok',
      'tok-1',
    );
    expect(params(fromOldServer).getAll('api_key')).toEqual(['server-tok']);
    expect(params(fromOldServer).get('ApiKey')).toBe('tok-1');
  });
});

/**
 * Every JSON request already carries the token in its headers. A copy in the
 * query string adds nothing for those calls and leaves a live token in every
 * reverse-proxy and server access log, so only URLs the player or an Image
 * fetches without headers (streams, subtitles, artwork) may carry one.
 */
describe('token placement on JSON requests', () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      text: async () => (url.includes('/Latest') ? '[]' : '{"Items":[]}'),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  const requests = () =>
    fetchMock.mock.calls.map(([url, init]) => ({
      url: new URL(url as string),
      headers: (init as {headers: Record<string, string>}).headers,
    }));

  it('keeps the token out of the URL and in the headers', async () => {
    await getItemsPage(session.serverUrl, session.accessToken, 'lib', 'user', {
      limit: 100,
      startIndex: 0,
    });
    await getItemDetails(session.serverUrl, session.accessToken, 'user', 'i');
    await getLatestItems(
      session.serverUrl,
      session.accessToken,
      'user',
      'Movie',
    );
    await getMediaSegments(session.serverUrl, session.accessToken, 'i');
    await reportPlaybackProgress(session.serverUrl, session.accessToken, {
      itemId: 'i',
      positionTicks: 1,
    });
    await setFavorite(
      session.serverUrl,
      session.accessToken,
      'user',
      'i',
      true,
    );

    const seen = requests();
    expect(seen).toHaveLength(6);
    for (const {url, headers} of seen) {
      expect(url.searchParams.has('ApiKey')).toBe(false);
      expect(url.searchParams.has('api_key')).toBe(false);
      expect(headers['X-Emby-Token']).toBe('tok-1');
      expect(headers.Authorization).toContain('Token="tok-1"');
    }
  });

  it('still carries both spellings on artwork URLs, which have no headers', async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({Id: 'item-1', Name: 'Film', ImageTags: {Primary: 't'}}),
    }));
    const item = await getItemDetails(
      session.serverUrl,
      session.accessToken,
      'user',
      'item-1',
    );
    expect(params(item.imageUrl!).get('ApiKey')).toBe('tok-1');
    expect(params(item.imageUrl!).get('api_key')).toBe('tok-1');
  });
});
