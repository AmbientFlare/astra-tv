/**
 * Top-level navigation entries for the home screen.
 *
 * Pure so the ordering, grouping and gating rules can be tested without
 * rendering.
 *
 * A server decides for itself how many views to expose and can add or remove
 * them at any time, so nothing here is keyed off a view's name. Everything
 * follows CollectionType, and any type the app does not recognise is still
 * rendered rather than dropped.
 */
import {JellyfinLibrary} from '../../services/jellyfin';

export type NavEntryKind =
  | 'movies'
  | 'tvshows'
  | 'music'
  | 'playlists'
  | 'other';

export interface NavEntry {
  id: string;
  kind: NavEntryKind;
  label: string;
  library: JellyfinLibrary;
}

export interface NavSection {
  /** Stable key for React; 'primary' holds the one-of-a-kind entries. */
  id: string;
  /** Absent for the primary section, which needs no heading. */
  title?: string;
  entries: NavEntry[];
}

/**
 * Display order, fixed rather than following whatever order the server
 * returns. Music sits after video because this is primarily a video app;
 * playlists last because they are the least-visited. Unrecognised types come
 * after everything the app has a name for.
 */
const KIND_ORDER: NavEntryKind[] = [
  'movies',
  'tvshows',
  'music',
  'playlists',
  'other',
];

const LABELS: Record<NavEntryKind, string> = {
  movies: 'Movies',
  music: 'Music',
  other: 'Library',
  playlists: 'Playlists',
  tvshows: 'TV Shows',
};

const SECTION_TITLES: Record<NavEntryKind, string> = {
  movies: 'Movies',
  music: 'Music',
  other: 'Libraries',
  playlists: 'Playlists',
  tvshows: 'TV Shows',
};

/**
 * Words a section heading already says. A view called "Trending Movies" under
 * a "Movies" heading reads better as "Trending".
 */
const REDUNDANT_WORDS: Record<NavEntryKind, RegExp | null> = {
  movies: /\b(?:movies?|films?)\b/gi,
  music: /\b(?:music)\b/gi,
  other: null,
  playlists: /\b(?:playlists?)\b/gi,
  tvshows: /\b(?:tv\s*shows?|shows?|series)\b/gi,
};

const kindFor = (library: JellyfinLibrary): NavEntryKind => {
  switch (library.type?.toLowerCase()) {
    case 'movies':
      return 'movies';
    case 'tvshows':
      return 'tvshows';
    case 'music':
      return 'music';
    case 'playlists':
      return 'playlists';
    default:
      return 'other';
  }
};

/**
 * Drops the words a heading already supplies. Keeps the original name if
 * trimming would leave nothing to read.
 */
export const trimRedundantTypeWords = (
  name: string,
  kind: NavEntryKind,
): string => {
  const pattern = REDUNDANT_WORDS[kind];

  if (!pattern) {
    return name;
  }

  const trimmed = name
    .replace(pattern, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—:|,]+|[\s\-–—:|,]+$/g, '');

  return trimmed.length ? trimmed : name;
};

export interface BuildNavEntriesOptions {
  /**
   * False hides both Music and Playlists. Requires the user to have a music
   * library AND to have music switched on — see useMusicAvailability.
   */
  musicAvailable: boolean;
}

export const buildNavEntries = (
  libraries: JellyfinLibrary[],
  {musicAvailable}: BuildNavEntriesOptions,
): NavEntry[] => {
  const kinds = libraries.map(kindFor);
  const countByKind = kinds.reduce<Partial<Record<NavEntryKind, number>>>(
    (counts, kind) => ({...counts, [kind]: (counts[kind] ?? 0) + 1}),
    {},
  );

  const entries = libraries.map((library, index) => {
    const kind = kinds[index];
    // With one library of a kind the app's own word for it is clearer than
    // whatever the server called it. With several, only the server's names
    // tell them apart, so they win.
    const label =
      kind === 'other' || (countByKind[kind] ?? 0) > 1
        ? library.name
        : LABELS[kind];

    return {
      id: library.id,
      kind,
      label,
      library,
    };
  });

  const visible = musicAvailable
    ? entries
    : entries.filter(
        (entry) => entry.kind !== 'music' && entry.kind !== 'playlists',
      );

  return visible.sort((left, right) => {
    const byKind =
      KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind);

    return byKind !== 0 ? byKind : left.label.localeCompare(right.label);
  });
};

/**
 * Groups the entries for display.
 *
 * A kind the server exposes only once needs no heading — it joins the leading
 * primary section, which is exactly the flat row a small library list has
 * always been. A kind with several views gets its own headed section so the
 * list stays readable however many views appear.
 */
export const buildNavSections = (
  libraries: JellyfinLibrary[],
  options: BuildNavEntriesOptions,
): NavSection[] => {
  const entries = buildNavEntries(libraries, options);
  const primary: NavEntry[] = [];
  const grouped: NavSection[] = [];

  KIND_ORDER.forEach((kind) => {
    const ofKind = entries.filter((entry) => entry.kind === kind);

    if (!ofKind.length) {
      return;
    }

    if (ofKind.length === 1) {
      primary.push(ofKind[0]);
      return;
    }

    grouped.push({
      id: kind,
      title: SECTION_TITLES[kind],
      entries: ofKind.map((entry) => ({
        ...entry,
        label: trimRedundantTypeWords(entry.label, kind),
      })),
    });
  });

  return [
    ...(primary.length ? [{id: 'primary', entries: primary}] : []),
    ...grouped,
  ];
};
