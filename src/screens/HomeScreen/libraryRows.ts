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

/**
 * How many generated rows the home screen will render.
 *
 * Every row is a horizontal list that loads and lays out on startup, and this
 * runs on modest TV hardware. A server free to expose any number of views
 * could otherwise turn the home screen into dozens of them. The libraries
 * past the cap are still one press away on the Libraries navigation.
 */
export const MAX_EXTRA_LIBRARY_ROWS = 4;

export interface ExtraLibraryRow {
  /** React key and the library id the row loads from. */
  libraryId: string;
  title: string;
}

/**
 * One row per library the fixed rows do not already cover, in the order the
 * server returned them, capped at MAX_EXTRA_LIBRARY_ROWS.
 */
export const selectExtraLibraryRows = (
  libraries: JellyfinLibrary[],
): ExtraLibraryRow[] =>
  libraries
    .filter((library) => !isCoveredByBuiltInRows(library))
    .slice(0, MAX_EXTRA_LIBRARY_ROWS)
    .map((library) => ({
      libraryId: library.id,
      title: `Latest in ${library.name}`,
    }));
