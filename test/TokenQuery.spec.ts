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
