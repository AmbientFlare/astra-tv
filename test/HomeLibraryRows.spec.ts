/**
 * Characterization tests for "Latest in <library>" row generation.
 *
 * The fixed home rows already cover movies, shows and music. A generated row
 * for one of those would duplicate what is above it, so the classification
 * below decides which views earn a row of their own.
 */
import {
  isCoveredByBuiltInRows,
  selectExtraLibraryRows,
} from '../src/screens/HomeScreen/libraryRows';
import {JellyfinLibrary} from '../src/services/jellyfin';

const library = (id: string, name: string, type?: string): JellyfinLibrary => ({
  id,
  name,
  type,
});

describe('isCoveredByBuiltInRows', () => {
  it.each([
    ['movies', true],
    ['tvshows', true],
    ['music', true],
    ['playlists', true],
    ['homevideos', false],
    ['boxsets', false],
    ['books', false],
    ['somethingnew', false],
  ])('treats a %s library as covered=%s', (type, expected) => {
    expect(isCoveredByBuiltInRows(library('1', 'Name', type))).toBe(expected);
  });

  it('matches the collection type case-insensitively', () => {
    expect(isCoveredByBuiltInRows(library('1', 'Films', 'Movies'))).toBe(true);
    expect(isCoveredByBuiltInRows(library('2', 'Shows', 'TVShows'))).toBe(true);
  });

  it('treats a library with no type as uncovered', () => {
    expect(isCoveredByBuiltInRows(library('1', 'Mystery'))).toBe(false);
  });
});

describe('selectExtraLibraryRows', () => {
  it('generates no rows for a server with one library per type', () => {
    // The protected default: an existing user gains no new rows.
    expect(
      selectExtraLibraryRows([
        library('1', 'Movies', 'movies'),
        library('2', 'Shows', 'tvshows'),
        library('3', 'Music', 'music'),
      ]),
    ).toEqual([]);
  });

  it('generates no rows even when a type appears several times', () => {
    expect(
      selectExtraLibraryRows([
        library('1', 'Movies', 'movies'),
        library('2', 'Trending Movies', 'movies'),
      ]),
    ).toEqual([]);
  });

  it('titles a row after the library and keeps the server order', () => {
    expect(
      selectExtraLibraryRows([
        library('1', 'Movies', 'movies'),
        library('7', 'Watchlist', 'somethingnew'),
        library('8', 'Up Next', undefined),
      ]),
    ).toEqual([
      {libraryId: '7', title: 'Latest in Watchlist'},
      {libraryId: '8', title: 'Latest in Up Next'},
    ]);
  });

  it('returns nothing for a user with no libraries', () => {
    expect(selectExtraLibraryRows([])).toEqual([]);
  });
});
