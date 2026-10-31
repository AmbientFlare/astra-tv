import React from 'react';
import {render, waitFor} from '@testing-library/react-native';

import {ProfileSwitcher} from '../src/components/ProfileSwitcher';

jest.mock('../src/services/storage', () => ({
  getUserPreferences: jest.fn(async () => ({accountSortBy: 'lastUsed'})),
  readServerProfiles: jest.fn(async () => [
    {id: 'a', name: 'Home', username: 'Levi', accessToken: 't', lastUsed: 2},
    {id: 'b', name: 'Home', username: 'Myron', accessToken: 't', lastUsed: 1},
  ]),
}));

describe('profile switcher', () => {
  it('keeps the remote inside the menu instead of the screen behind it', async () => {
    const screen = render(
      <ProfileSwitcher
        currentProfileId="a"
        onAddUser={jest.fn()}
        onClose={jest.fn()}
        onSelect={jest.fn()}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId('profile-switcher-b')).toBeTruthy(),
    );

    const dialog = screen.getByText("Who's watching?").parent;
    expect(dialog?.props).toMatchObject({
      trapFocusDown: true,
      trapFocusLeft: true,
      trapFocusRight: true,
      trapFocusUp: true,
    });
  });
});
