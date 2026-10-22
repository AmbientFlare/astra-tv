import {
  getTrickplayFrame,
  getTrickplayImageSource,
  getTrickplayInfo,
  selectTrickplayInfo,
  TrickplayInfo,
} from '../src/services/jellyfin/trickplay';
import {getJson} from '../src/services/jellyfin/http';

jest.mock('../src/services/jellyfin/http', () => ({
  ...jest.requireActual('../src/services/jellyfin/http'),
  getJson: jest.fn(),
  getAuthHeaders: (token: string) => ({Authorization: `Token ${token}`}),
}));

const info: TrickplayInfo = {
  Width: 320,
  Height: 180,
  TileWidth: 10,
  TileHeight: 10,
  ThumbnailCount: 215,
  Interval: 10000,
};

describe('Jellyfin Trickplay previews', () => {
  it('selects the actual media version and accepts normalized UUIDs', () => {
    const data = {
      'aabb-ccdd': {'320': info},
      different: {'160': {...info, Width: 160, Height: 90}},
    };
    expect(selectTrickplayInfo(data, 'AABBCCDD')).toEqual(info);
    expect(selectTrickplayInfo(data, 'missing')).toBeNull();
    expect(selectTrickplayInfo(undefined, 'missing')).toBeNull();
  });

  it('prefers preview-sized sprites with a bounded decoded size', () => {
    const small = {...info, Width: 160, Height: 90};
    const huge = {...info, Width: 1920, Height: 1080};
    expect(
      selectTrickplayInfo(
        {source: {'1920': huge, '320': info, '160': small}},
        'source',
      ),
    ).toEqual(small);
    expect(selectTrickplayInfo({source: {'1920': huge}}, 'source')).toBeNull();
  });

  it.each([
    'Width',
    'Height',
    'TileWidth',
    'TileHeight',
    'ThumbnailCount',
    'Interval',
  ])('rejects malformed %s metadata', (field) => {
    expect(
      selectTrickplayInfo({source: {'320': {...info, [field]: 0}}}, 'source'),
    ).toBeNull();
    expect(
      selectTrickplayInfo(
        {source: {'320': {...info, [field]: Infinity}}},
        'source',
      ),
    ).toBeNull();
  });

  it('maps movie seconds to sprite sheets and grid positions', () => {
    expect(getTrickplayFrame(info, 0)).toEqual({sheet: 0, left: 0, top: 0});
    expect(getTrickplayFrame(info, 110)).toEqual({
      sheet: 0,
      left: 320,
      top: 180,
    });
    expect(getTrickplayFrame(info, 1000)).toEqual({sheet: 1, left: 0, top: 0});
    expect(getTrickplayFrame(info, 2140)).toEqual({
      sheet: 2,
      left: 1280,
      top: 180,
    });
    expect(getTrickplayFrame(info, 999999)).toEqual(
      getTrickplayFrame(info, 2140),
    );
    expect(getTrickplayFrame(info, -1)).toEqual(getTrickplayFrame(info, 0));
    expect(getTrickplayFrame(info, NaN)).toBeNull();
  });

  it('preserves a server base path and authenticates images with headers', () => {
    const source = getTrickplayImageSource(
      'https://server/jellyfin',
      'secret',
      'movie',
      'version',
      320,
      2,
    );
    expect(source.uri).toBe(
      'https://server/jellyfin/Videos/movie/Trickplay/320/2.jpg?mediaSourceId=version',
    );
    expect(source.uri).not.toContain('secret');
    expect(source.headers).toEqual({Authorization: 'Token secret'});
  });

  it('fetches only preview metadata with a bounded, cancellable request', async () => {
    (getJson as jest.Mock).mockResolvedValue({
      Items: [{Id: 'movie', Trickplay: {version: {'320': info}}}],
    });
    const abort = new AbortController();
    expect(
      await getTrickplayInfo(
        'https://server/jellyfin',
        'secret',
        'movie',
        'version',
        abort.signal,
        'user',
      ),
    ).toEqual(info);
    const [url, options, timeout] = (getJson as jest.Mock).mock.calls.pop();
    expect(new URL(url).pathname).toBe('/jellyfin/Items');
    expect(new URL(url).searchParams.get('Ids')).toBe('movie');
    expect(new URL(url).searchParams.get('Fields')).toBe('Trickplay');
    expect(options.signal).toBe(abort.signal);
    expect(options.headers).toEqual({Authorization: 'Token secret'});
    expect(timeout).toBe(8000);
  });
});
