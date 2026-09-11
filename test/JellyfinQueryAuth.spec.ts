import {measureServerBandwidth} from '../src/services/jellyfin';
import {mapItem} from '../src/services/jellyfin/shared';

describe('Astra-generated Jellyfin query authentication', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('uses ApiKey for generated image URLs', () => {
    const item = mapItem('https://jellyfin.example', 'image-token', {
      Id: 'item-1',
      ImageTags: {Primary: 'tag-1'},
    });

    expect(new URL(item.imageUrl ?? '').searchParams.get('ApiKey')).toBe(
      'image-token',
    );
    expect(item.imageUrl).not.toContain('api_key=');
  });

  it('uses ApiKey for both bandwidth-test requests', async () => {
    global.fetch = jest.fn(async () => ({
      arrayBuffer: async () => new ArrayBuffer(1024),
      ok: true,
      status: 200,
    })) as unknown as typeof fetch;

    await measureServerBandwidth('https://jellyfin.example', 'bandwidth-token');

    const urls = (global.fetch as jest.Mock).mock.calls.map(
      ([url]) => new URL(url).searchParams,
    );
    expect(urls).toHaveLength(2);
    expect(
      urls.every((query) => query.get('ApiKey') === 'bandwidth-token'),
    ).toBe(true);
    expect(urls.every((query) => query.get('api_key') === null)).toBe(true);
  });
});
