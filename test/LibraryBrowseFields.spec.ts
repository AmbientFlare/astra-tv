/**
 * The library grid asks the server for a deliberately small field set. The
 * fields it leaves out are what made a whole-library request slow: measured
 * against a 90-movie library, `People` alone accounted for 2.5s of a 2.7s
 * response, and MediaSources/MediaStreams/Chapters for 1.7MB of a 2MB
 * payload -- none of it drawn on a card. They arrive one item at a time
 * instead, as focus settles, which is what `detailPrefetchIds` orders.
 */
jest.mock('../src/services/deviceIdentity', () => ({
  initializeDeviceIdentity: jest.fn(async () => 'test-installation'),
  getDeviceId: () => 'test-installation',
  getDeviceName: () => 'FireTV',
}));

import {browseItemFields, getItems, itemFields} from '../src/services/jellyfin';
import {detailPrefetchIds} from '../src/screens/LibraryScreen';

const mockFetch = () => {
  const calls: string[] = [];

  global.fetch = jest.fn(async (url: string) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({Items: [], TotalRecordCount: 0}),
    };
  }) as unknown as typeof fetch;

  return calls;
};

afterEach(() => {
  jest.restoreAllMocks();
});

const fieldsOf = (url: string) =>
  decodeURIComponent(
    new RegExp('[?&]Fields=([^&]*)').exec(url)?.[1] ?? '',
  ).split(',');

describe('browseItemFields', () => {
  it('leaves out the fields that make a whole-library request expensive', () => {
    const browse = browseItemFields.split(',');

    for (const heavy of [
      'People',
      'MediaSources',
      'MediaStreams',
      'Chapters',
    ]) {
      expect(browse).not.toContain(heavy);
      // The detail request is where they belong, and still asks for them.
      expect(itemFields.split(',')).toContain(heavy);
    }
  });

  it('still carries what a card and the panel first pass render', () => {
    const browse = browseItemFields.split(',');

    for (const needed of [
      'Overview',
      'Genres',
      'ChildCount',
      'RecursiveItemCount',
      'PrimaryImageAspectRatio',
    ]) {
      expect(browse).toContain(needed);
    }
  });
});

describe('getItems', () => {
  it('requests the browse field set, not the full one', async () => {
    const calls = mockFetch();

    await getItems(
      'https://media.example.com',
      'token-123',
      'library-1',
      'user-1',
    );

    expect(calls).toHaveLength(1);
    expect(fieldsOf(calls[0])).toEqual(browseItemFields.split(','));
    expect(fieldsOf(calls[0])).not.toContain('People');
  });
});

describe('detailPrefetchIds', () => {
  const items = Array.from({length: 20}, (_, index) => ({
    id: `item-${index}`,
  })) as Parameters<typeof detailPrefetchIds>[0];

  it('asks for the focused card before any of its neighbours', () => {
    expect(detailPrefetchIds(items, 8)[0]).toBe('item-8');
  });

  it('walks outward, forward before backward', () => {
    expect(detailPrefetchIds(items, 8).slice(0, 5)).toEqual([
      'item-8',
      'item-9',
      'item-7',
      'item-10',
      'item-6',
    ]);
  });

  it('does not run off either end of the list', () => {
    expect(detailPrefetchIds(items, 0)).toEqual([
      'item-0',
      'item-1',
      'item-2',
      'item-3',
      'item-4',
      'item-5',
      'item-6',
    ]);
    expect(detailPrefetchIds(items, 19).every(Boolean)).toBe(true);
    expect(detailPrefetchIds([], 0)).toEqual([]);
  });
});
