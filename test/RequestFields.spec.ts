/**
 * Guards the Fields parameter against unrecognised names.
 *
 * Fields is bound server-side as an array of the ItemFields enum. One name
 * outside that enum rejects the entire request with 400 rather than being
 * ignored, so a single stray entry takes out every screen that browses.
 *
 * The list below is Jellyfin's ItemFields enum. Item properties that are NOT
 * in it — ratings, production year, user data — arrive on every item anyway
 * and must never be requested by name.
 */
import {itemFields} from '../src/services/jellyfin';
import {musicItemFields} from '../src/services/jellyfin/music';

const ITEM_FIELDS = [
  'AirTime',
  'CanDelete',
  'CanDownload',
  'ChannelImage',
  'ChannelInfo',
  'Chapters',
  'ChildCount',
  'CumulativeRunTimeTicks',
  'CustomRating',
  'DateCreated',
  'DateLastMediaAdded',
  'DateLastRefreshed',
  'DateLastSaved',
  'DisplayPreferencesId',
  'EnableMediaSourceDisplay',
  'Etag',
  'ExternalUrls',
  'ExtraIds',
  'Genres',
  'Height',
  'IsHD',
  'ItemCounts',
  'LocalTrailerCount',
  'MediaSourceCount',
  'MediaSources',
  'MediaStreams',
  'OriginalTitle',
  'Overview',
  'ParentId',
  'Path',
  'People',
  'PlayAccess',
  'PrimaryImageAspectRatio',
  'ProductionLocations',
  'ProviderIds',
  'RecursiveItemCount',
  'RefreshState',
  'RemoteTrailers',
  'SeasonUserData',
  'SeriesStudio',
  'Settings',
  'SortName',
  'SpecialEpisodeNumbers',
  'SpecialFeatureCount',
  'Studios',
  'Taglines',
  'Tags',
  'Trickplay',
  'Width',
];

/** Properties that look like fields but are not, and must stay out. */
const NOT_FIELDS = [
  'OfficialRating',
  'CommunityRating',
  'ProductionYear',
  'UserData',
  'CriticRating',
];

describe.each([
  ['itemFields', itemFields],
  ['musicItemFields', musicItemFields],
])('%s', (_name, fields) => {
  const requested = fields.split(',');

  it('asks only for names the server recognises', () => {
    expect(requested.filter((field) => !ITEM_FIELDS.includes(field))).toEqual(
      [],
    );
  });

  it('never asks for a plain item property by name', () => {
    expect(requested.filter((field) => NOT_FIELDS.includes(field))).toEqual([]);
  });

  it('has no blanks or duplicates', () => {
    expect(requested.filter((field) => !field.trim())).toEqual([]);
    expect(new Set(requested).size).toBe(requested.length);
  });
});
