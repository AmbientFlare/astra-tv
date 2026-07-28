import {buildNavEntries} from '../src/components/LibraryNav/entries';
import {JellyfinLibrary} from '../src/services/jellyfin';

const library = (id: string, name: string, type?: string): JellyfinLibrary => ({
  id,
  name,
  type,
});

// Mirrors what a real server returns, deliberately in an unhelpful order.
const allLibraries = [
  library('3', 'Shows', 'tvshows'),
  library('4', 'Playlists', 'playlists'),
  library('1', 'Movies', 'movies'),
  library('2', 'Music', 'music'),
];

describe('buildNavEntries ordering', () => {
  it('orders Movies, TV Shows, Music, Playlists regardless of server order', () => {
    const entries = buildNavEntries(allLibraries, {musicAvailable: true});

    expect(entries.map((entry) => entry.label)).toEqual([
      'Movies',
      'TV Shows',
      'Music',
      'Playlists',
    ]);
  });

  it('normalizes labels rather than using server names', () => {
    // The server calls it "Shows"; the nav should read "TV Shows".
    const entries = buildNavEntries([library('3', 'Shows', 'tvshows')], {
      musicAvailable: true,
    });

    expect(entries[0].label).toBe('TV Shows');
  });

  it('keeps the server name for unrecognised library types', () => {
    const entries = buildNavEntries(
      [library('9', 'Home Videos', 'homevideos')],
      {musicAvailable: true},
    );

    expect(entries[0].label).toBe('Home Videos');
    expect(entries[0].kind).toBe('other');
  });

  it('sorts unrecognised libraries last, alphabetically', () => {
    const entries = buildNavEntries(
      [
        library('9', 'Zed Videos', 'homevideos'),
        library('8', 'Adult Swim', 'homevideos'),
        library('1', 'Movies', 'movies'),
      ],
      {musicAvailable: true},
    );

    expect(entries.map((entry) => entry.label)).toEqual([
      'Movies',
      'Adult Swim',
      'Zed Videos',
    ]);
  });
});

describe('buildNavEntries music gating', () => {
  it('hides both Music and Playlists when music is unavailable', () => {
    const entries = buildNavEntries(allLibraries, {musicAvailable: false});

    expect(entries.map((entry) => entry.label)).toEqual(['Movies', 'TV Shows']);
  });

  it('never leaks a music entry through when gated off', () => {
    const entries = buildNavEntries(allLibraries, {musicAvailable: false});

    expect(entries.some((entry) => entry.kind === 'music')).toBe(false);
    expect(entries.some((entry) => entry.kind === 'playlists')).toBe(false);
  });

  it('shows music entries when available', () => {
    const entries = buildNavEntries(allLibraries, {musicAvailable: true});

    expect(entries.some((entry) => entry.kind === 'music')).toBe(true);
    expect(entries.some((entry) => entry.kind === 'playlists')).toBe(true);
  });

  it('returns nothing for a user with no libraries', () => {
    expect(buildNavEntries([], {musicAvailable: true})).toEqual([]);
  });

  it('handles a library with no type at all', () => {
    const entries = buildNavEntries([library('7', 'Mystery')], {
      musicAvailable: true,
    });

    expect(entries[0].kind).toBe('other');
    expect(entries[0].label).toBe('Mystery');
  });
});
