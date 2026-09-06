/**
 * Backing out of an item must land on the card it was opened from.
 *
 * The navigation stack renders only the current route, so opening an item
 * unmounts LibraryScreen and takes every piece of its state with it. These
 * tests drive that same unmount/remount cycle and assert what the user sees
 * on the way back: the same grid, no spinner, the same card focused and
 * counted, and a scroll position far enough down the list to show it.
 */
import 'react-native';
import {act, fireEvent, render} from '@testing-library/react-native';
import React from 'react';

import {
  LibraryScreen,
  resetLibrarySessions,
} from '../src/screens/LibraryScreen';
import {
  getItemDetails,
  getItems,
  JellyfinMediaItem,
} from '../src/services/jellyfin';
import {ServerProfile} from '../src/services/storage';

jest.mock('@amazon-devices/react-native-kepler', () => {
  const MockReact = require('react');
  const {View} = require('react-native');

  return {
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
  getItems: jest.fn(async () => []),
  getItemDetails: jest.fn(async () => ({})),
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

/** Enough rows that the remembered card is nowhere near the first window. */
const library = Array.from(
  {length: 60},
  (_, index) =>
    ({
      id: `movie-${index}`,
      name: `Movie ${index}`,
      type: 'Movie',
    } as JellyfinMediaItem),
);

const mockedItems = getItems as jest.MockedFunction<typeof getItems>;

const settle = async () => {
  await act(async () => {
    for (let turn = 0; turn < 8; turn += 1) {
      await Promise.resolve();
    }
  });
};

const renderLibrary = () =>
  render(
    <LibraryScreen
      libraryId="library-1"
      libraryName="Movies"
      libraryType="movies"
      menuVisible={false}
      onMenuVisibleChange={() => undefined}
      serverProfile={profile}
    />,
  );

beforeEach(() => {
  jest.clearAllMocks();
  resetLibrarySessions();
  mockedItems.mockResolvedValue(library);
  (getItemDetails as jest.Mock).mockResolvedValue({});
});

/**
 * Focus a card the way MediaCard's onFocus does, then wait out the 150ms
 * focus debounce. Real timers rather than fake ones: the screen interleaves
 * timers with promise chains, and faking only half of that pair deadlocks
 * the render tree's cleanup.
 */
const focusCard = async (screen: ReturnType<typeof render>, index: number) => {
  fireEvent(screen.getByTestId(`media-card-Movie ${index}`), 'focus');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 220));
  });
  await settle();
};

describe('LibraryScreen session restore', () => {
  it('comes back to the card the user left, without a spinner', async () => {
    const first = renderLibrary();
    await settle();
    await focusCard(first, 27);

    expect(first.getByText('28 | 60')).toBeTruthy();
    first.unmount();

    const second = renderLibrary();

    // Before any request resolves: the grid is already drawn and the count
    // already reads the remembered card, so there is nothing to wait behind.
    expect(second.queryByText('Loading items...')).toBeNull();
    expect(second.getByText('28 | 60')).toBeTruthy();
  });

  it('hands first focus to the remembered card rather than the first one', async () => {
    const first = renderLibrary();
    await settle();
    await focusCard(first, 27);
    first.unmount();

    const second = renderLibrary();
    await settle();

    expect(
      second.getByTestId('media-card-Movie 27').props.hasTVPreferredFocus,
    ).toBe(true);
    // The first card is not even rendered: the list opened its window around
    // the remembered row instead of at the top, which is what makes the
    // preferred focus above reachable at all.
    expect(second.queryByTestId('media-card-Movie 0')).toBeNull();
  });

  it('refreshes behind the restored grid and keeps the position', async () => {
    const first = renderLibrary();
    await settle();
    await focusCard(first, 27);
    first.unmount();

    const second = renderLibrary();
    await settle();

    expect(mockedItems).toHaveBeenCalledTimes(2);
    expect(second.getByText('28 | 60')).toBeTruthy();
  });

  it('leaves the remembered grid up when the refresh fails', async () => {
    const first = renderLibrary();
    await settle();
    await focusCard(first, 27);
    first.unmount();

    mockedItems.mockRejectedValueOnce(new Error('server unreachable'));
    const second = renderLibrary();
    await settle();

    expect(second.queryByText('server unreachable')).toBeNull();
    expect(second.getByText('28 | 60')).toBeTruthy();
  });

  it('clamps to the last card when the library shrank while away', async () => {
    const first = renderLibrary();
    await settle();
    await focusCard(first, 27);
    first.unmount();

    mockedItems.mockResolvedValue(library.slice(0, 10));
    const second = renderLibrary();
    await settle();

    expect(second.getByText('10 | 10')).toBeTruthy();
  });

  it('starts at the top for a library it has never seen', async () => {
    const screen = renderLibrary();

    expect(screen.getByText('Loading items...')).toBeTruthy();
    await settle();
    expect(screen.getByText('1 | 60')).toBeTruthy();
  });
});
