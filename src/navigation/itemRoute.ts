/**
 * Which detail screen an item belongs on.
 *
 * A view can hand back any item type it likes — a row of episodes, a mix of
 * series and movies, whatever the server groups together — so the type on the
 * item decides the destination rather than the row it was tapped in.
 */
import {JellyfinMediaItem} from '../services/jellyfin';

export type DetailRoute = 'detail' | 'episodeDetail' | 'library';

/**
 * Item types that hold other items but have no detail screen of their own.
 * Series and Season are folders too, but the detail screen renders their
 * children itself, so they are deliberately absent.
 */
const BROWSABLE_FOLDER_TYPES = [
  'BoxSet',
  'CollectionFolder',
  'Folder',
  'UserView',
];

export const detailRouteForItem = (item: {
  isFolder?: boolean;
  type?: string;
}): DetailRoute => {
  if (item.type === 'Episode') {
    return 'episodeDetail';
  }

  // Browsing into a folder beats opening a detail screen that would have
  // nothing on it. A view can put folders at its top level, and a tap on one
  // has to go somewhere.
  if (item.type && BROWSABLE_FOLDER_TYPES.includes(item.type)) {
    return 'library';
  }

  return 'detail';
};

export const isRemoteItem = (item: Pick<JellyfinMediaItem, 'locationType'>) =>
  item.locationType === 'Remote';
