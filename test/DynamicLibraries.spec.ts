import {
  buildNavSections,
  trimRedundantTypeWords,
} from '../src/components/LibraryNav/entries';
import {detailRouteForItem} from '../src/navigation/itemRoute';
import {
  hasPlayableMediaSource,
  isIncompleteSeasonList,
  JellyfinLibrary,
} from '../src/services/jellyfin';

const library = (id: string, name: string, type?: string): JellyfinLibrary => ({
  id,
  name,
  type,
});

describe('nav labels when a server exposes several views of one type', () => {
  it('keeps the app label while a type appears once', () => {
    const [section] = buildNavSections(
      [library('1', 'Films', 'movies'), library('2', 'Shows', 'tvshows')],
      {musicAvailable: false},
    );

    expect(section.title).toBeUndefined();
    expect(section.entries.map((entry) => entry.label)).toEqual([
      'Movies',
      'TV Shows',
    ]);
  });

  it('falls back to server names once a type appears more than once', () => {
    const sections = buildNavSections(
      [
        library('1', 'Movies', 'movies'),
        library('2', 'Trending Movies', 'movies'),
        library('3', 'Shows', 'tvshows'),
      ],
      {musicAvailable: false},
    );

    // The single tvshows view still needs no heading.
    expect(sections[0]).toEqual({
      id: 'primary',
      entries: [expect.objectContaining({label: 'TV Shows'})],
    });
    expect(sections[1].title).toBe('Movies');
    expect(sections[1].entries.map((entry) => entry.label)).toEqual([
      'Movies',
      'Trending',
    ]);
  });

  it('groups unrecognised collection types under one heading', () => {
    const sections = buildNavSections(
      [
        library('1', 'Movies', 'movies'),
        library('8', 'Watchlist', 'somethingnew'),
        library('9', 'Up Next', undefined),
      ],
      {musicAvailable: false},
    );

    expect(sections[1].title).toBe('Libraries');
    expect(sections[1].entries.map((entry) => entry.label)).toEqual([
      'Up Next',
      'Watchlist',
    ]);
  });

  it('renders every view the server returns', () => {
    const libraries = Array.from({length: 9}, (_, index) =>
      library(String(index), `View ${index}`, index % 2 ? 'movies' : 'tvshows'),
    );
    const sections = buildNavSections(libraries, {musicAvailable: false});
    const rendered = sections.flatMap((section) => section.entries);

    expect(rendered).toHaveLength(libraries.length);
  });

  it('returns nothing for a user with no libraries', () => {
    expect(buildNavSections([], {musicAvailable: true})).toEqual([]);
  });
});

describe('trimRedundantTypeWords', () => {
  it('drops the word the heading already says', () => {
    expect(trimRedundantTypeWords('Trending Movies', 'movies')).toBe(
      'Trending',
    );
    expect(trimRedundantTypeWords('Anime Shows', 'tvshows')).toBe('Anime');
    expect(trimRedundantTypeWords('Recommended - Films', 'movies')).toBe(
      'Recommended',
    );
  });

  it('keeps the name when trimming would leave nothing', () => {
    expect(trimRedundantTypeWords('Movies', 'movies')).toBe('Movies');
    expect(trimRedundantTypeWords('Shows', 'tvshows')).toBe('Shows');
  });

  it('leaves unrecognised types alone', () => {
    expect(trimRedundantTypeWords('Movie Night', 'other')).toBe('Movie Night');
  });
});

describe('detailRouteForItem', () => {
  it('sends an episode to the episode screen wherever it was tapped', () => {
    expect(detailRouteForItem({type: 'Episode'})).toBe('episodeDetail');
  });

  it('sends movies and series to the detail screen', () => {
    expect(detailRouteForItem({type: 'Movie'})).toBe('detail');
    expect(detailRouteForItem({type: 'Series'})).toBe('detail');
    expect(detailRouteForItem({type: 'Season'})).toBe('detail');
  });

  it('browses into a folder rather than opening an empty detail screen', () => {
    expect(detailRouteForItem({type: 'Folder'})).toBe('library');
    expect(detailRouteForItem({type: 'BoxSet'})).toBe('library');
    expect(detailRouteForItem({type: 'CollectionFolder'})).toBe('library');
  });

  it('has a destination for an item of an unknown type', () => {
    expect(detailRouteForItem({})).toBe('detail');
    expect(detailRouteForItem({type: 'SomethingNew'})).toBe('detail');
  });
});

describe('isIncompleteSeasonList', () => {
  it('treats no seasons as unfinished', () => {
    expect(isIncompleteSeasonList([])).toBe(true);
  });

  it('treats a lone empty season as unfinished', () => {
    expect(isIncompleteSeasonList([{childCount: 0}])).toBe(true);
    expect(isIncompleteSeasonList([{childCount: null}])).toBe(true);
  });

  it('accepts a lone season that has episodes', () => {
    expect(isIncompleteSeasonList([{childCount: 8}])).toBe(false);
  });

  it('accepts several seasons', () => {
    expect(isIncompleteSeasonList([{childCount: 0}, {childCount: 0}])).toBe(
      false,
    );
  });
});

describe('hasPlayableMediaSource', () => {
  it('rejects a response with no media sources', () => {
    expect(hasPlayableMediaSource({})).toBe(false);
    expect(hasPlayableMediaSource({MediaSources: []})).toBe(false);
  });

  it('rejects a placeholder source with nothing to stream', () => {
    expect(hasPlayableMediaSource({MediaSources: [{Id: 'pending'}]})).toBe(
      false,
    );
  });

  it('accepts a source the server can deliver', () => {
    expect(
      hasPlayableMediaSource({MediaSources: [{TranscodingUrl: '/video.m3u8'}]}),
    ).toBe(true);
    expect(
      hasPlayableMediaSource({MediaSources: [{SupportsTranscoding: true}]}),
    ).toBe(true);
    expect(
      hasPlayableMediaSource({MediaSources: [{SupportsDirectStream: true}]}),
    ).toBe(true);
  });
});
