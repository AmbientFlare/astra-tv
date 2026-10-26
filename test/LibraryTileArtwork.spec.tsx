/**
 * Each home tile's collage comes from that library alone.
 *
 * The collage used to be chosen per kind of library, from the server's newest
 * movies or series across every library. With several movie libraries each
 * tile showed the same posters, so a private library's showed on the others.
 */
import 'react-native';
import {act, render} from '@testing-library/react-native';
import React from 'react';
import {Image} from 'react-native';
import {HomeScreen} from '../src/screens/HomeScreen';
import {
  getLatestItems,
  getLibraries,
  getLibraryArtwork,
  JellyfinMediaItem,
} from '../src/services/jellyfin';
import {ServerProfile} from '../src/services/storage';

jest.mock('@amazon-devices/react-native-kepler', () => {
  const MockReact = require('react');
  const {View} = require('react-native');

  return {
    TVFocusGuideView: (props: Record<string, unknown>) =>
      MockReact.createElement(View, props),
    useTVEventHandler: jest.fn(),
  };
});

jest.mock('../src/components/FocusableItem', () => {
  const MockReact = require('react');
  const {View} = require('react-native');

  return {
    FocusableItem: ({
      children,
      focusedStyle: _focusedStyle,
      hasTVPreferredFocus: _hasTVPreferredFocus,
      ...props
    }: Record<string, unknown>) =>
      MockReact.createElement(View, props, children),
  };
});

jest.mock('../src/services/jellyfin', () => ({
  ...jest.requireActual('../src/services/jellyfin'),
  getLatestItems: jest.fn(async () => []),
  getLatestItemsInLibrary: jest.fn(async () => []),
  getLibraries: jest.fn(async () => []),
  getLibraryArtwork: jest.fn(async () => []),
  getNextUp: jest.fn(async () => []),
  getResumeItems: jest.fn(async () => []),
}));

jest.mock('../src/services/jellyfin/music', () => ({
  ...jest.requireActual('../src/services/jellyfin/music'),
  getAlbums: jest.fn(async () => ({items: [], total: 0})),
  hasMusicLibraries: jest.fn(async () => false),
}));

jest.mock('../src/services/storage', () => ({
  ...jest.requireActual('../src/services/storage'),
  getUserPreferences: jest.fn(
    async () =>
      jest.requireActual('../src/services/storage').defaultUserPreferences,
  ),
}));

const profile: ServerProfile = {
  accessToken: 'token-123',
  id: 'server:user',
  lastUsed: 1,
  name: 'Test Server',
  serverType: 'jellyfin',
  serverUrl: 'https://media.example.com',
  userId: 'user-1',
};

const settle = async () => {
  await act(async () => {
    for (let turn = 0; turn < 12; turn += 1) {
      await Promise.resolve();
    }
  });
};

const posters = (libraryId: string, count: number) =>
  Array.from({length: count}, (_, index) => ({
    id: `${libraryId}-item-${index}`,
    imageUrl: `https://img.example.com/${libraryId}/${index}.jpg`,
    name: `${libraryId} ${index}`,
    type: 'Movie',
  })) as JellyfinMediaItem[];

const tileImages = (tile: {findAllByType: Function}) =>
  tile
    .findAllByType(Image)
    .map((image: {props: {source: {uri: string}}}) => image.props.source.uri);

beforeEach(() => {
  jest.clearAllMocks();
});

it('fills each tile with posters from that library only', async () => {
  (getLibraries as jest.Mock).mockResolvedValue([
    {id: 'films', name: 'Films', type: 'movies'},
    {id: 'private', name: 'Private', type: 'movies'},
    {id: 'shows', name: 'Shows', type: 'tvshows'},
    {
      id: 'boxsets',
      imageUrl: 'https://img.example.com/boxsets.jpg',
      name: 'Collections',
      type: 'boxsets',
    },
  ]);
  (getLibraryArtwork as jest.Mock).mockImplementation(
    async (_url, _token, _user, libraryId: string) => posters(libraryId, 3),
  );

  const screen = render(<HomeScreen serverProfile={profile} />);
  await settle();

  const [films, privateTile] = screen.getAllByTestId('home-nav-movies');
  const shows = screen.getByTestId('home-nav-tvshows');
  const boxsets = screen.getByTestId('home-nav-other');

  expect(tileImages(films)).not.toHaveLength(0);
  expect(
    tileImages(films).every((uri: string) => uri.includes('/films/')),
  ).toBe(true);
  expect(
    tileImages(privateTile).every((uri: string) => uri.includes('/private/')),
  ).toBe(true);
  expect(
    tileImages(shows).every((uri: string) => uri.includes('/shows/')),
  ).toBe(true);
  expect(tileImages(boxsets)).toEqual(['https://img.example.com/boxsets.jpg']);

  expect(getLibraryArtwork).toHaveBeenCalledWith(
    profile.serverUrl,
    profile.accessToken,
    profile.userId,
    'shows',
    'Series',
  );
  // The server-wide newest list is no longer used for tiles at all.
  expect(getLatestItems).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.anything(),
    expect.anything(),
    'Series',
  );
});

it("falls back to the library's own image when it has no posters", async () => {
  (getLibraries as jest.Mock).mockResolvedValue([
    {
      id: 'films',
      imageUrl: 'https://img.example.com/films.jpg',
      name: 'Films',
      type: 'movies',
    },
  ]);
  (getLibraryArtwork as jest.Mock).mockRejectedValue(new Error('offline'));

  const screen = render(<HomeScreen serverProfile={profile} />);
  await settle();

  expect(tileImages(screen.getByTestId('home-nav-movies'))).toEqual([
    'https://img.example.com/films.jpg',
  ]);
});
