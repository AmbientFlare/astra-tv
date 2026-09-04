/**
 * Regression tests for the shared loading/empty/error component and the
 * screens that adopted it.
 *
 * Standardising these states is only safe if no screen quietly lost the
 * message it used to show. Each screen below asserts the state a user sees
 * when the server answers with nothing.
 */
import 'react-native';
import {act, fireEvent, render} from '@testing-library/react-native';
import React from 'react';

import {LoadingOrError} from '../src/components/LoadingOrError';
import {HomeScreen} from '../src/screens/HomeScreen';
import {LibraryScreen} from '../src/screens/LibraryScreen';
import {getItems, getLibraries} from '../src/services/jellyfin';
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
  getItems: jest.fn(async () => []),
  getLatestItems: jest.fn(async () => []),
  getLatestItemsInLibrary: jest.fn(async () => []),
  getLibraries: jest.fn(async () => []),
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
  getDisplayPreferences: jest.fn(async () => ({
    imageSize: 'medium',
    imageType: 'Primary',
  })),
  getUserPreferences: jest.fn(
    async () =>
      jest.requireActual('../src/services/storage').defaultUserPreferences,
  ),
  setDisplayPreferences: jest.fn(async () => undefined),
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
    for (let turn = 0; turn < 8; turn += 1) {
      await Promise.resolve();
    }
  });
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('LoadingOrError precedence', () => {
  it('shows loading ahead of everything else', () => {
    const screen = render(
      <LoadingOrError
        emptyText="Nothing here"
        errorText="Broke"
        isEmpty={true}
        isLoading={true}
        loadingText="Working"
      />,
    );

    expect(screen.getByText('Working')).toBeTruthy();
    expect(screen.queryByText('Broke')).toBeNull();
    expect(screen.queryByText('Nothing here')).toBeNull();
  });

  it('shows an error ahead of an empty state', () => {
    const screen = render(
      <LoadingOrError
        emptyText="Nothing here"
        errorText="Broke"
        isEmpty={true}
      />,
    );

    expect(screen.getByText('Broke')).toBeTruthy();
    expect(screen.queryByText('Nothing here')).toBeNull();
  });

  it('renders nothing at all once there is content', () => {
    const screen = render(
      <LoadingOrError emptyText="Nothing here" isEmpty={false} />,
    );

    expect(screen.toJSON()).toBeNull();
  });

  it('offers Retry on both the error and empty states', () => {
    const onRetry = jest.fn();
    const errored = render(
      <LoadingOrError errorText="Broke" onRetry={onRetry} testID="s" />,
    );

    fireEvent.press(errored.getByTestId('s-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);

    const empty = render(
      <LoadingOrError
        emptyText="Nothing here"
        isEmpty={true}
        onRetry={onRetry}
        testID="e"
      />,
    );

    fireEvent.press(empty.getByTestId('e-retry'));
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('omits Retry when the caller has no way to retry', () => {
    const screen = render(<LoadingOrError errorText="Broke" testID="s" />);

    expect(screen.queryByTestId('s-retry')).toBeNull();
  });
});

describe('screens still say something when the server returns nothing', () => {
  it('the library screen explains an empty grid', async () => {
    (getItems as jest.Mock).mockResolvedValue([]);

    const screen = render(
      <LibraryScreen
        libraryId="view-1"
        libraryName="Watchlist"
        menuVisible={false}
        onMenuVisibleChange={jest.fn()}
        serverProfile={profile}
      />,
    );
    await settle();

    expect(screen.getByTestId('library-status-empty')).toBeTruthy();
  });

  it('the library screen offers a retry after a failed load', async () => {
    (getItems as jest.Mock).mockRejectedValue(new Error('Server said no'));

    const screen = render(
      <LibraryScreen
        libraryId="view-1"
        libraryName="Watchlist"
        menuVisible={false}
        onMenuVisibleChange={jest.fn()}
        serverProfile={profile}
      />,
    );
    await settle();

    expect(screen.getByText('Server said no')).toBeTruthy();

    (getItems as jest.Mock).mockResolvedValue([]);
    fireEvent.press(screen.getByTestId('library-status-retry'));
    await settle();

    expect(screen.getByTestId('library-status-empty')).toBeTruthy();
  });

  it('the home screen explains a server with no libraries', async () => {
    (getLibraries as jest.Mock).mockResolvedValue([]);

    const screen = render(<HomeScreen serverProfile={profile} />);
    await settle();

    expect(screen.getByTestId('home-libraries-empty')).toBeTruthy();
  });
});
