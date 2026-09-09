/**
 * Unit tests for the predicates behind dynamic-library support. The grouping
 * they feed is covered end-to-end in NavSections.spec, and routing in
 * ItemRoute.spec.
 */
import {trimRedundantTypeWords} from '../src/components/LibraryNav/entries';
import {
  hasPlayableMediaSource,
  isIncompleteSeasonList,
} from '../src/services/jellyfin';

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
