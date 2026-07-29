import React from 'react';
import {fireEvent, render} from '@testing-library/react-native';
import {TrackActionMenu} from '../src/components/TrackActionMenu';

const track = {
  albumName: 'Abbey Road',
  artistName: 'The Beatles',
  id: 'track-1',
  name: 'Come Together',
};

describe('TrackActionMenu', () => {
  it('shows isolated actions for the focused track', () => {
    const actions = {
      onAddToQueue: jest.fn(),
      onClose: jest.fn(),
      onOpenQueue: jest.fn(),
      onPlayNext: jest.fn(),
      onPlayNow: jest.fn(),
    };
    const screen = render(<TrackActionMenu {...actions} track={track} />);

    expect(screen.getByText('Come Together')).toBeTruthy();
    expect(screen.getByText('The Beatles · Abbey Road')).toBeTruthy();

    fireEvent.press(screen.getByTestId('track-action-play-next'));
    expect(actions.onPlayNext).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('track-action-add-queue'));
    expect(actions.onAddToQueue).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('track-action-open-queue'));
    expect(actions.onOpenQueue).toHaveBeenCalledTimes(1);
  });
});
