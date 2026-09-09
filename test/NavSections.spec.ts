/**
 * Golden-output tests for home-screen library grouping.
 *
 * These assert the WHOLE section structure, not a property of it, because the
 * point of the grouping change was that a server which looked a certain way
 * before must still look exactly that way.
 */
import {
  buildNavSections,
  NavSection,
} from '../src/components/LibraryNav/entries';
import {JellyfinLibrary} from '../src/services/jellyfin';

const library = (id: string, name: string, type?: string): JellyfinLibrary => ({
  id,
  name,
  type,
});

/** The shape a test cares about: headings and the labels under them. */
const outline = (sections: NavSection[]) =>
  sections.map((section) => ({
    id: section.id,
    title: section.title,
    labels: section.entries.map((entry) => entry.label),
  }));

describe('(a) a server with one library per type', () => {
  // This is the layout every existing user has today. It must not gain a
  // heading, lose a label, or reorder.
  const smallServer = [
    library('3', 'Shows', 'tvshows'),
    library('1', 'Movies', 'movies'),
    library('2', 'Music', 'music'),
  ];

  it('produces a single unheaded section in the legacy order', () => {
    expect(
      outline(buildNavSections(smallServer, {musicAvailable: true})),
    ).toEqual([
      {
        id: 'primary',
        title: undefined,
        labels: ['Movies', 'TV Shows', 'Music'],
      },
    ]);
  });

  it('still hides music when the user has it switched off', () => {
    expect(
      outline(buildNavSections(smallServer, {musicAvailable: false})),
    ).toEqual([
      {id: 'primary', title: undefined, labels: ['Movies', 'TV Shows']},
    ]);
  });

  it('carries the original library through on each entry', () => {
    const [section] = buildNavSections(smallServer, {musicAvailable: true});

    expect(section.entries[0].library).toBe(smallServer[1]);
    expect(section.entries[0].id).toBe('1');
    expect(section.entries[0].kind).toBe('movies');
  });
});

describe('(b) several views of the same type', () => {
  it('heads the group and trims the word the heading already says', () => {
    const sections = buildNavSections(
      [
        library('1', 'Movies', 'movies'),
        library('2', 'Trending Movies', 'movies'),
        library('3', 'Recommended Films', 'movies'),
        library('4', 'Shows', 'tvshows'),
      ],
      {musicAvailable: false},
    );

    expect(outline(sections)).toEqual([
      {id: 'primary', title: undefined, labels: ['TV Shows']},
      {
        id: 'movies',
        title: 'Movies',
        labels: ['Movies', 'Recommended', 'Trending'],
      },
    ]);
  });

  it('keeps single-view types unheaded alongside a headed group', () => {
    const sections = buildNavSections(
      [
        library('1', 'Movies', 'movies'),
        library('4', 'Shows', 'tvshows'),
        library('5', 'Anime Shows', 'tvshows'),
      ],
      {musicAvailable: false},
    );

    expect(outline(sections)).toEqual([
      {id: 'primary', title: undefined, labels: ['Movies']},
      {id: 'tvshows', title: 'TV Shows', labels: ['Anime', 'Shows']},
    ]);
  });
});

describe('(c) collection types the app does not recognise', () => {
  it('gathers them under one Libraries heading, alphabetically', () => {
    const sections = buildNavSections(
      [
        library('1', 'Movies', 'movies'),
        library('7', 'Watchlist', 'somethingnew'),
        library('8', 'Up Next', undefined),
        library('9', 'Home Videos', 'homevideos'),
      ],
      {musicAvailable: false},
    );

    expect(outline(sections)).toEqual([
      {id: 'primary', title: undefined, labels: ['Movies']},
      {
        id: 'other',
        title: 'Libraries',
        labels: ['Home Videos', 'Up Next', 'Watchlist'],
      },
    ]);
  });

  it('never trims an unrecognised name', () => {
    // "Movie Night" under a generic heading keeps its own word.
    const sections = buildNavSections(
      [
        library('1', 'Movie Night', 'somethingnew'),
        library('2', 'Show Case', 'somethingelse'),
      ],
      {musicAvailable: false},
    );

    expect(outline(sections)).toEqual([
      {id: 'other', title: 'Libraries', labels: ['Movie Night', 'Show Case']},
    ]);
  });

  it('shows a lone unrecognised library with no heading', () => {
    expect(
      outline(
        buildNavSections([library('7', 'Watchlist', 'somethingnew')], {
          musicAvailable: false,
        }),
      ),
    ).toEqual([{id: 'primary', title: undefined, labels: ['Watchlist']}]);
  });
});

describe('(d) nothing to show', () => {
  it('produces no sections for an empty view list', () => {
    expect(buildNavSections([], {musicAvailable: true})).toEqual([]);
  });

  it('produces no sections when everything is gated off', () => {
    expect(
      buildNavSections(
        [
          library('2', 'Music', 'music'),
          library('4', 'Playlists', 'playlists'),
        ],
        {musicAvailable: false},
      ),
    ).toEqual([]);
  });
});

describe('scale', () => {
  it('renders every view the server returns, once each', () => {
    const libraries = Array.from({length: 12}, (_, index) =>
      library(String(index), `View ${index}`, index % 2 ? 'movies' : 'tvshows'),
    );
    const rendered = buildNavSections(libraries, {
      musicAvailable: false,
    }).flatMap((section) => section.entries);

    expect(rendered).toHaveLength(12);
    expect(new Set(rendered.map((entry) => entry.id)).size).toBe(12);
  });
});
