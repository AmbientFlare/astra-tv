/**
 * Characterization tests for detail-screen routing.
 *
 * Every media card in the app routes through detailRouteForItem, so a change
 * here silently moves taps across the whole app. The table below is the
 * contract: it records where each item type goes today, including the types
 * that reach a screen with little to show. Change a row only on purpose.
 */
import {detailRouteForItem, DetailRoute} from '../src/navigation/itemRoute';

describe('detailRouteForItem: every type the API can return', () => {
  // [name, expected route, item] so the generated test titles read cleanly.
  const cases: Array<
    [string, DetailRoute, {isFolder?: boolean; type?: string}]
  > = [
    // Video items with a detail screen of their own.
    ['Movie', 'detail', {type: 'Movie'}],
    ['Series', 'detail', {type: 'Series', isFolder: true}],
    ['Season', 'detail', {type: 'Season', isFolder: true}],
    ['Video', 'detail', {type: 'Video'}],
    ['MusicVideo', 'detail', {type: 'MusicVideo'}],
    ['Trailer', 'detail', {type: 'Trailer'}],

    // The one type with a dedicated screen.
    ['Episode', 'episodeDetail', {type: 'Episode'}],

    // Containers with no detail screen: browse into them instead.
    ['Folder', 'library', {type: 'Folder', isFolder: true}],
    ['CollectionFolder', 'library', {type: 'CollectionFolder', isFolder: true}],
    ['UserView', 'library', {type: 'UserView', isFolder: true}],
    ['BoxSet', 'library', {type: 'BoxSet', isFolder: true}],

    // Music and photos are reached through their own screens, so these
    // fall through to the generic detail screen. Recorded, not endorsed —
    // see the note below this table.
    ['MusicAlbum', 'detail', {type: 'MusicAlbum', isFolder: true}],
    ['MusicArtist', 'detail', {type: 'MusicArtist', isFolder: true}],
    ['Audio', 'detail', {type: 'Audio'}],
    ['Playlist', 'detail', {type: 'Playlist', isFolder: true}],
    ['Photo', 'detail', {type: 'Photo'}],
    ['PhotoAlbum', 'detail', {type: 'PhotoAlbum', isFolder: true}],

    // Anything the app has never heard of still has somewhere to go.
    ['unknown type', 'detail', {type: 'SomethingNew'}],
    ['no type at all', 'detail', {}],
    ['undefined type', 'detail', {type: undefined}],
  ];

  it.each(cases)('routes %s to the %s screen', (_name, expected, item) => {
    expect(detailRouteForItem(item)).toBe(expected);
  });

  it('never returns anything outside the known route set', () => {
    const routes = new Set(cases.map(([, , item]) => detailRouteForItem(item)));

    routes.forEach((route) => {
      expect(['detail', 'episodeDetail', 'library']).toContain(route);
    });
  });

  it('ignores isFolder on its own — the type decides', () => {
    // Series and Season are folders that must NOT browse as libraries; a
    // plain Folder must. Only the type separates them.
    expect(detailRouteForItem({type: 'Series', isFolder: true})).toBe('detail');
    expect(detailRouteForItem({type: 'Folder', isFolder: true})).toBe(
      'library',
    );
    expect(detailRouteForItem({type: 'Folder', isFolder: false})).toBe(
      'library',
    );
  });
});
