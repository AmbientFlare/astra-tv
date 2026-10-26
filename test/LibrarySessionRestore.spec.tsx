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
import {FlatList} from 'react-native';
import {act, fireEvent, render} from '@testing-library/react-native';
import React from 'react';

import {
  LibraryScreen,
  resetLibrarySessions,
} from '../src/screens/LibraryScreen';
import {
  getItemDetails,
  getItemsPage,
  getItems,
  JellyfinMediaItem,
} from '../src/services/jellyfin';
import {trimMemory} from '../src/services/memoryTrim';
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
  // Pages whatever the getItems mock holds, the way the server pages a
  // library, so a test sets its data once through getItems.
  getItemsPage: jest.fn(async (...args: any[]) => {
    const all = await jest
      .requireMock('../src/services/jellyfin')
      .getItems(...args);
    const start = args[4]?.startIndex ?? 0;
    return {
      items: all.slice(start, start + (args[4]?.limit ?? all.length)),
      totalRecordCount: all.length,
    };
  }),
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

  it('measures and scrolls the grid in rows, not in cards', async () => {
    // FlatList hands both props straight to VirtualizedList, which counts one
    // entry per row once numColumns is set. Measuring in cards instead put
    // the restored list at a third of the intended offset -- close enough to
    // look deliberate, and always wrong.
    const first = renderLibrary();
    await settle();
    await focusCard(first, 27);
    first.unmount();

    const second = renderLibrary();
    await settle();

    const grid = second.UNSAFE_getByType(FlatList);
    // Card 27 is the first card of row 9 of a three-wide grid.
    expect(grid.props.initialScrollIndex).toBe(9);

    // 412pt card at the default scale, plus the 26pt gap between rows.
    const rowHeight = 438;
    expect(grid.props.getItemLayout(null, 9)).toEqual({
      index: 9,
      length: rowHeight,
      offset: rowHeight * 9,
    });
    expect(grid.props.getItemLayout(null, 0).offset).toBe(0);
  });

  it('starts at the top for a library it has never seen', async () => {
    const screen = renderLibrary();

    expect(screen.getByText('Loading items...')).toBeTruthy();
    await settle();
    expect(screen.getByText('1 | 60')).toBeTruthy();
  });
});

describe('LibraryScreen memory trim', () => {
  const detailCalls = () =>
    (getItemDetails as jest.Mock).mock.calls.map((call) => call[3]);

  it('drops neighbour details in the background but keeps the focused one', async () => {
    const screen = renderLibrary();
    await settle();
    await focusCard(screen, 27);
    expect(detailCalls()).toEqual(
      expect.arrayContaining(['movie-27', 'movie-28']),
    );
    (getItemDetails as jest.Mock).mockClear();

    await act(async () => trimMemory('background'));
    await focusCard(screen, 28);

    // movie-28 was fetched before the trim and is fetched again; the focused
    // card, movie-27, was kept and is not.
    expect(detailCalls()).toContain('movie-28');
    expect(detailCalls()).not.toContain('movie-27');
    expect(screen.getByText('29 | 60')).toBeTruthy();
  });

  it('keeps a remembered grid through a background trim', async () => {
    const first = renderLibrary();
    await settle();
    await focusCard(first, 27);
    first.unmount();

    trimMemory('background');
    const second = renderLibrary();

    expect(second.queryByText('Loading items...')).toBeNull();
    expect(second.getByText('28 | 60')).toBeTruthy();
  });

  it('forgets remembered grids on a memory warning', async () => {
    const first = renderLibrary();
    await settle();
    await focusCard(first, 27);
    first.unmount();

    trimMemory('critical');
    const second = renderLibrary();

    expect(second.getByText('Loading items...')).toBeTruthy();
    await settle();
    expect(second.getByText('1 | 60')).toBeTruthy();
  });
});

describe('LibraryScreen paging', () => {
  /**
   * Focus a card that may sit outside FlatList's rendered window, through the
   * same onFocus the grid gives the card it renders there.
   */
  const focusAt = async (screen: ReturnType<typeof render>, index: number) => {
    const grid = screen.UNSAFE_getByType(FlatList);
    const card = grid.props.renderItem({item: grid.props.data[index], index});
    await act(async () => {
      card.props.onFocus();
      await new Promise((resolve) => setTimeout(resolve, 220));
    });
    await settle();
  };
  const big = Array.from(
    {length: 250},
    (_, index) =>
      ({
        id: `movie-${index}`,
        name: `Movie ${index}`,
        type: 'Movie',
      } as JellyfinMediaItem),
  );
  const pages = () => getItemsPage as jest.Mock;

  beforeEach(() => {
    mockedItems.mockResolvedValue(big);
  });

  it('loads the first page only, but counts the whole library', async () => {
    const screen = renderLibrary();
    await settle();

    expect(pages()).toHaveBeenCalledTimes(1);
    expect(pages().mock.calls[0][4]).toMatchObject({startIndex: 0, limit: 100});
    expect(screen.UNSAFE_getByType(FlatList).props.data).toHaveLength(100);
    expect(screen.getByText('1 | 250')).toBeTruthy();
  });

  it('fetches the next page as focus nears the end of what is loaded', async () => {
    const screen = renderLibrary();
    await settle();

    await focusAt(screen, 30);
    expect(pages()).toHaveBeenCalledTimes(1);

    await focusAt(screen, 95);
    expect(pages()).toHaveBeenCalledTimes(2);
    expect(pages().mock.calls[1][4]).toMatchObject({
      startIndex: 100,
      limit: 100,
    });
    expect(screen.UNSAFE_getByType(FlatList).props.data).toHaveLength(200);
    expect(screen.getByText('96 | 250')).toBeTruthy();
  });

  it('drops a page that lands after the sort changed', async () => {
    const screen = renderLibrary();
    await settle();

    let releasePage!: () => void;
    pages().mockImplementationOnce(
      (...args: any[]) =>
        new Promise((resolve) => {
          releasePage = () =>
            resolve({
              items: big.slice(args[4].startIndex, args[4].startIndex + 100),
              totalRecordCount: 250,
            });
        }),
    );
    await focusAt(screen, 95);

    screen.rerender(
      <LibraryScreen
        libraryId="library-1"
        libraryName="Movies"
        libraryType="movies"
        menuVisible
        onMenuVisibleChange={() => undefined}
        serverProfile={profile}
      />,
    );
    fireEvent.press(screen.getByTestId('preference-radio-Sort by-Date Added'));
    await settle();
    await act(async () => releasePage());
    await settle();

    // The reload replaced the list; the stale second page was not appended.
    expect(screen.UNSAFE_getByType(FlatList).props.data).toHaveLength(100);
  });

  it('refreshes a restored grid as far as the remembered card', async () => {
    const first = renderLibrary();
    await settle();
    await focusAt(first, 95);
    await focusAt(first, 150);
    first.unmount();
    pages().mockClear();

    const second = renderLibrary();
    await settle();

    expect(pages().mock.calls[0][4]).toMatchObject({startIndex: 0, limit: 151});
    expect(second.getByText('151 | 250')).toBeTruthy();
  });
});
