/**
 * Top-level navigation entries for the home screen.
 *
 * Pure so the ordering and gating rules can be tested without rendering.
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

/**
 * Display order, fixed rather than following whatever order the server
 * returns. Music sits after video because this is primarily a video app;
 * playlists last because they are the least-visited.
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
  const entries = libraries.map((library) => {
    const kind = kindFor(library);

    return {
      id: library.id,
      kind,
      // Keep the server's name for anything we do not recognise, so a custom
      // library is still navigable rather than all showing as "Library".
      label: kind === 'other' ? library.name : LABELS[kind],
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
