import {
  createMusicPlaylist,
  getAlbumTracks,
  getArtistAlbums,
  getArtistTopTracks,
  getAudioHlsStreamUrl,
  getAudioStreamUrl,
  getGenres,
  getMusicLibraries,
  hasMusicLibraries,
  MusicSession,
  NATIVE_AUDIO_CONTAINERS,
} from '../src/services/jellyfin/music';

const session: MusicSession = {
  accessToken: 'token-123',
  serverUrl: 'https://media.example.com',
  userId: 'user-1',
};

const mockFetch = (handler: (url: string) => unknown) => {
  const calls: string[] = [];

  global.fetch = jest.fn(async (url: string) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(handler(url)),
    };
  }) as unknown as typeof fetch;

  return calls;
};

const emptyPage = {Items: [], TotalRecordCount: 0};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('getAudioStreamUrl', () => {
  it('requests direct play and never forces a transcode', () => {
    const url = getAudioStreamUrl(session, 'track-9');

    // Spike v3: sending only a container list makes Jellyfin serve the
    // original, seekable file. Transcode hints produce an unseekable stream.
    expect(url).toContain(
      `Container=${encodeURIComponent(NATIVE_AUDIO_CONTAINERS)}`.replace(
        /%2C/g,
        '%2C',
      ),
    );
    expect(url).not.toContain('TranscodingContainer');
    expect(url).not.toContain('TranscodingProtocol');
    expect(url).not.toContain('AudioCodec');
    expect(url).not.toContain('MaxStreamingBitrate');
  });

  it('includes the track id, user and api key', () => {
    const url = getAudioStreamUrl(session, 'track-9');

    expect(url).toContain('/Audio/track-9/universal');
    expect(url).toContain('UserId=user-1');
    expect(url).toContain('api_key=token-123');
  });
});

describe('createMusicPlaylist', () => {
  it('posts the ordered queue to Jellyfin', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({Id: 'playlist-1'}),
    })) as unknown as typeof fetch;

    await expect(
      createMusicPlaylist(session, 'Road Trip', [
        {id: 'track-a', name: 'A'},
        {id: 'track-b', name: 'B'},
      ]),
    ).resolves.toBe('playlist-1');

    const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/Playlists');
    expect(new URL(url).searchParams.get('MediaType')).toBe('Audio');
    expect(new URL(url).searchParams.get('Ids')).toBe('track-a,track-b');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({
      Ids: ['track-a', 'track-b'],
      MediaType: 'Audio',
      Name: 'Road Trip',
      UserId: 'user-1',
    });
  });

  it('refuses empty names and queues without contacting the server', async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;

    await expect(createMusicPlaylist(session, ' ', [])).rejects.toThrow(
      /playlist name/i,
    );
    await expect(createMusicPlaylist(session, 'Empty', [])).rejects.toThrow(
      /at least one track/i,
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('getAudioHlsStreamUrl', () => {
  it('forces AAC HLS without advertising source containers', () => {
    const url = getAudioHlsStreamUrl(session, 'track-9');
    const query = new URL(url).searchParams;

    expect(query.get('Container')).toBe('aac');
    expect(query.get('TranscodingContainer')).toBe('ts');
    expect(query.get('TranscodingProtocol')).toBe('hls');
    expect(query.get('AudioCodec')).toBe('aac');
    expect(query.get('Container')).not.toContain('mp3');
    expect(query.get('Container')).not.toBe(NATIVE_AUDIO_CONTAINERS);
  });

  it('includes the track id, user and api key', () => {
    const url = getAudioHlsStreamUrl(session, 'track-9');

    expect(url).toContain('/Audio/track-9/universal');
    expect(url).toContain('UserId=user-1');
    expect(url).toContain('api_key=token-123');
  });

  it('refuses an empty track id', () => {
    expect(() => getAudioHlsStreamUrl(session, '')).toThrow(/track id/);
  });
});

describe('empty id guards', () => {
  // Verified against a live server: an empty filter value is ignored and the
  // whole library comes back (821 albums / 11,547 tracks). Refusing loudly is
  // the only safe behaviour.
  it('refuses an empty artist id rather than fetching everything', async () => {
    mockFetch(() => emptyPage);

    await expect(getArtistAlbums(session, '')).rejects.toThrow(/artist id/);
    await expect(getArtistTopTracks(session, '  ')).rejects.toThrow(
      /artist id/,
    );
  });

  it('refuses an empty album id', async () => {
    mockFetch(() => emptyPage);

    await expect(getAlbumTracks(session, '')).rejects.toThrow(/album id/);
  });

  it('refuses an empty track id when building a stream url', () => {
    expect(() => getAudioStreamUrl(session, '')).toThrow(/track id/);
  });

  it('does not issue a request when the id is missing', async () => {
    const calls = mockFetch(() => emptyPage);

    await expect(getAlbumTracks(session, '')).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe('getGenres', () => {
  it('uses the dedicated /MusicGenres endpoint', async () => {
    // /Users/{id}/Items?IncludeItemTypes=MusicGenre returns 0 on a real
    // server; only /MusicGenres works.
    const calls = mockFetch(() => ({
      Items: [{Id: 'g1', Name: 'Acid Jazz'}],
      TotalRecordCount: 1,
    }));

    const page = await getGenres(session);

    expect(calls[0]).toContain('/MusicGenres');
    expect(calls[0]).not.toContain('IncludeItemTypes=MusicGenre');
    expect(page.items[0].name).toBe('Acid Jazz');
    expect(page.totalCount).toBe(1);
  });
});

describe('pagination', () => {
  it('passes StartIndex and Limit and reports the server total', async () => {
    const calls = mockFetch(() => ({
      Items: [{Id: 'a1', Name: 'Album One', ChildCount: 11}],
      TotalRecordCount: 821,
    }));

    const page = await getArtistAlbums(session, 'artist-1', {
      limit: 60,
      startIndex: 120,
    });

    expect(calls[0]).toContain('StartIndex=120');
    expect(calls[0]).toContain('Limit=60');
    expect(page.startIndex).toBe(120);
    expect(page.totalCount).toBe(821);
    expect(page.items[0].trackCount).toBe(11);
  });
});

describe('getArtistTopTracks fallback chain', () => {
  // Jellyfin only exposes this user's own PlayCount. A freshly added library
  // has zero everywhere, so the section must not render empty.
  const trackPage = (
    items: Array<{PlayCount?: number; CommunityRating?: number; Name: string}>,
  ) => ({
    Items: items.map((item, index) => ({
      Id: `t${index}`,
      Name: item.Name,
      CommunityRating: item.CommunityRating,
      UserData: {PlayCount: item.PlayCount ?? 0},
    })),
    TotalRecordCount: items.length,
  });

  it('prefers genuinely played tracks', async () => {
    mockFetch(() => trackPage([{Name: 'Played', PlayCount: 7}]));

    const tracks = await getArtistTopTracks(session, 'artist-1');

    expect(tracks.map((track) => track.name)).toEqual(['Played']);
  });

  it('falls back to rated tracks when nothing has been played', async () => {
    let call = 0;
    mockFetch(() => {
      call += 1;
      return call === 1
        ? trackPage([{Name: 'Unplayed', PlayCount: 0}])
        : trackPage([{Name: 'Rated', CommunityRating: 8.1}]);
    });

    const tracks = await getArtistTopTracks(session, 'artist-1');

    expect(tracks.map((track) => track.name)).toEqual(['Rated']);
  });

  it('falls back to newest-album tracks when nothing is played or rated', async () => {
    let call = 0;
    mockFetch(() => {
      call += 1;

      if (call <= 2) {
        return trackPage([{Name: 'Nothing', PlayCount: 0}]);
      }

      return trackPage([{Name: 'Newest', PlayCount: 0}]);
    });

    const tracks = await getArtistTopTracks(session, 'artist-1');

    expect(tracks.map((track) => track.name)).toEqual(['Newest']);
  });

  it('returns an empty list rather than throwing for an artist with no tracks', async () => {
    mockFetch(() => emptyPage);

    await expect(getArtistTopTracks(session, 'artist-1')).resolves.toEqual([]);
  });
});

describe('music library detection', () => {
  const views = {
    Items: [
      {Id: 'v1', Name: 'Movies', CollectionType: 'movies'},
      {Id: 'v2', Name: 'Music', CollectionType: 'music'},
      {Id: 'v3', Name: 'Shows', CollectionType: 'tvshows'},
    ],
  };

  it('returns only music collections', async () => {
    mockFetch(() => views);

    const libraries = await getMusicLibraries(session);

    expect(libraries).toEqual([{id: 'v2', name: 'Music'}]);
  });

  it('uses per-user views so non-admins are not blocked', async () => {
    const calls = mockFetch(() => views);

    await getMusicLibraries(session);

    expect(calls[0]).toContain('/UserViews');
    expect(calls[0]).not.toContain('MediaFolders');
  });

  it('reports false rather than throwing when the lookup fails', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    await expect(hasMusicLibraries(session)).resolves.toBe(false);
  });

  it('reports false when the user has no music library', async () => {
    mockFetch(() => ({
      Items: [{Id: 'v1', Name: 'Movies', CollectionType: 'movies'}],
    }));

    await expect(hasMusicLibraries(session)).resolves.toBe(false);
  });
});
