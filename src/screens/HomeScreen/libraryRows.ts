/**
 * Which libraries get their own "Latest in ..." row on the home screen.
 *
 * Pure so the classification can be tested without rendering or a server.
 */
import {JellyfinLibrary} from '../../services/jellyfin';

/**
 * Collection types the fixed home rows already cover. A library of one of
 * these types would only repeat Latest Movies, Latest Shows or the music
 * screens, so it does not get a row of its own.
 */
const COVERED_COLLECTION_TYPES = ['movies', 'tvshows', 'music', 'playlists'];

export const isCoveredByBuiltInRows = (library: JellyfinLibrary) =>
  COVERED_COLLECTION_TYPES.includes(library.type?.toLowerCase() ?? '');

export interface ExtraLibraryRow {
  /** React key and the library id the row loads from. */
  libraryId: string;
  title: string;
}

/**
 * One row per library the fixed rows do not already cover, in the order the
 * server returned them.
 */
export const selectExtraLibraryRows = (
  libraries: JellyfinLibrary[],
): ExtraLibraryRow[] =>
  libraries
    .filter((library) => !isCoveredByBuiltInRows(library))
    .map((library) => ({
      libraryId: library.id,
      title: `Latest in ${library.name}`,
    }));
