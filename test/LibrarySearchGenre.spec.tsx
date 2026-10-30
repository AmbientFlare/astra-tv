/**
 * Searching and filtering by genre inside an open library (#50).
 *
 * Both are server-side: the grid pages through a library too big to hold, so
 * a filter has to go into the request, not run over the items on screen.
 * These tests drive the toolbar and panels the way the remote does and check
 * what the grid then asks the server for.
 */
import 'react-native';
import {act, fireEvent, render} from '@testing-library/react-native';
import React from 'react';

import {
  LibraryScreen,
  librarySearchTerm,
  resetLibrarySessions,
} from '../src/screens/LibraryScreen';
import {
  getItemsPage,
  getLibraryGenres,
  JellyfinMediaItem,
} from '../src/services/jellyfin';
import {ServerProfile} from '../src/services/storage';

jest.mock('@amazon-devices/react-native-kepler', () => {
  const MockReact = require('react');
  const {TextInput, View} = require('react-native');

  return {
    TextInput: MockReact.forwardRef(
      (props: Record<string, unknown>, ref: unknown) =>
        MockReact.createElement(TextInput, {...props, ref}),
    ),
    TVFocusGuideView: (props: Record<string, unknown>) =>
      MockReact.createElement(View, props),
    useTVEventHandler: () => undefined,
  };
});

jest.mock('../src/components/FocusableItem', () => {
  const MockReact = require('react');
  const {View} = require('react-native');

  return {
    FocusableItem: ({
      children,
      focusedStyle: _focusedStyle,
      ...props
    }: Record<string, unknown>) =>
      MockReact.createElement(View, props, children),
  };
});

jest.mock('../src/services/storage', () => ({
  ...jest.requireActual('../src/services/storage'),
  getDisplayPreferences: jest.fn(async () => ({
    imageSize: 'medium',
    imageType: 'Primary',
  })),
  setDisplayPreferences: jest.fn(async () => undefined),
}));

jest.mock('../src/services/jellyfin', () => ({
  ...jest.requireActual('../src/services/jellyfin'),
  getItemsPage: jest.fn(),
  getItemDetails: jest.fn(async () => ({})),
  getLibraryGenres: jest.fn(),
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

const movie = (name: string) =>
  ({id: name.toLowerCase(), name, type: 'Movie'} as JellyfinMediaItem);

const mockedPage = getItemsPage as jest.MockedFunction<typeof getItemsPage>;
const mockedGenres = getLibraryGenres as jest.MockedFunction<
  typeof getLibraryGenres
>;

const settle = async () => {
  await act(async () => {
    for (let turn = 0; turn < 8; turn += 1) {
      await Promise.resolve();
    }
  });
};

const wait = async (ms: number) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
  await settle();
};

/**
 * The navigator owns menuVisible; this stands in for it so opening a panel
 * from the toolbar and closing it with a pick behave as they do in the app.
 */
const Harness = () => {
  const [menuVisible, setMenuVisible] = React.useState(false);
  return (
    <LibraryScreen
      libraryId="library-1"
      libraryName="Movies"
      libraryType="movies"
      menuVisible={menuVisible}
      onMenuVisibleChange={setMenuVisible}
      serverProfile={profile}
    />
  );
};

const lastRequest = () =>
  mockedPage.mock.calls[mockedPage.mock.calls.length - 1][4] ?? {};

beforeEach(() => {
  jest.clearAllMocks();
  resetLibrarySessions();
  mockedPage.mockImplementation(async (_url, _token, _library, _user, opts) => {
    const all = [movie('Dune'), movie('Heat'), movie('Western Star')];
    const term = opts?.searchTerm?.toLowerCase();
    const items = term
      ? all.filter((item) => item.name.toLowerCase().includes(term))
      : opts?.genreIds?.length
      ? all.slice(2)
      : all;
    return {items, totalRecordCount: items.length};
  });
  mockedGenres.mockResolvedValue([
    {id: 'g-horror', name: 'Horror'},
    {id: 'g-western', name: 'Western'},
  ]);
});

describe('librarySearchTerm', () => {
  it('ignores a single letter and surrounding spaces', () => {
    expect(librarySearchTerm('')).toBe('');
    expect(librarySearchTerm(' d ')).toBe('');
    expect(librarySearchTerm('  du ')).toBe('du');
  });
});

describe('LibraryScreen search and genre filter', () => {
  it('starts unfiltered', async () => {
    const screen = render(<Harness />);
    await settle();

    expect(lastRequest().searchTerm).toBe('');
    expect(lastRequest().genreIds).toBeUndefined();
    expect(screen.getByText('Search')).toBeTruthy();
    expect(screen.getByText('All genres')).toBeTruthy();
  });

  it('searches the library after a typing pause', async () => {
    const screen = render(<Harness />);
    await settle();

    fireEvent.press(screen.getByTestId('library-search-button'));
    fireEvent.changeText(screen.getByTestId('library-search-input'), 'dun');
    await wait(500);

    expect(lastRequest()).toMatchObject({searchTerm: 'dun', startIndex: 0});
    expect(screen.getByTestId('media-card-Dune')).toBeTruthy();
    expect(screen.queryByTestId('media-card-Heat')).toBeNull();
    expect(screen.getByText('Search: dun')).toBeTruthy();
  });

  it('clearing the search shows the whole library again', async () => {
    const screen = render(<Harness />);
    await settle();

    fireEvent.press(screen.getByTestId('library-search-button'));
    fireEvent.changeText(screen.getByTestId('library-search-input'), 'dun');
    await wait(500);
    fireEvent.press(screen.getByTestId('library-search-clear'));
    await settle();

    expect(lastRequest().searchTerm).toBe('');
    expect(screen.getByTestId('media-card-Heat')).toBeTruthy();
  });

  it('filters by a genre picked from the library', async () => {
    const screen = render(<Harness />);
    await settle();

    fireEvent.press(screen.getByTestId('library-genre-button'));
    await settle();

    expect(mockedGenres).toHaveBeenCalledWith(
      profile.serverUrl,
      profile.accessToken,
      'library-1',
      profile.userId,
      'Movie',
    );

    fireEvent.press(screen.getByTestId('library-genre-g-western'));
    await settle();

    expect(lastRequest().genreIds).toEqual(['g-western']);
    expect(screen.getByText('Genre: Western')).toBeTruthy();
    expect(screen.queryByTestId('library-genre-g-western')).toBeNull();

    fireEvent.press(screen.getByTestId('library-genre-button'));
    fireEvent.press(screen.getByTestId('library-genre-all'));
    await settle();

    expect(lastRequest().genreIds).toBeUndefined();
    // Asked for once and kept for the life of the screen.
    expect(mockedGenres).toHaveBeenCalledTimes(1);
  });

  it('says nothing matches rather than that the library is empty', async () => {
    const screen = render(<Harness />);
    await settle();

    fireEvent.press(screen.getByTestId('library-search-button'));
    fireEvent.changeText(screen.getByTestId('library-search-input'), 'zzz');
    await wait(500);

    expect(screen.getByText('Nothing in this library matches.')).toBeTruthy();
  });

  it('offers Retry when the genres cannot be loaded', async () => {
    mockedGenres.mockRejectedValueOnce(new Error('offline'));
    const screen = render(<Harness />);
    await settle();

    fireEvent.press(screen.getByTestId('library-genre-button'));
    await settle();
    expect(screen.getByText('Unable to load genres.')).toBeTruthy();

    fireEvent.press(screen.getByTestId('library-genres-retry'));
    await settle();
    expect(screen.getByTestId('library-genre-g-horror')).toBeTruthy();
  });

  it('keeps the search and genre when the library is reopened', async () => {
    const first = render(<Harness />);
    await settle();
    fireEvent.press(first.getByTestId('library-genre-button'));
    await settle();
    fireEvent.press(first.getByTestId('library-genre-g-western'));
    await settle();
    first.unmount();

    const second = render(<Harness />);
    await settle();

    expect(second.getByText('Genre: Western')).toBeTruthy();
    expect(lastRequest().genreIds).toEqual(['g-western']);
  });
});
