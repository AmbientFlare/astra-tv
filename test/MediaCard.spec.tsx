import 'react-native';
import {render} from '@testing-library/react-native';
import * as React from 'react';

import {MediaCard} from '../src/components/MediaCard';

const defaultProps = {
  imageUrl: 'https://example.com/poster.jpg',
  title: 'Test Series',
};

describe('MediaCard unplayed badge', () => {
  it('shows the unplayed-episode count when greater than zero', () => {
    const screen = render(<MediaCard {...defaultProps} unplayedCount={7} />);
    expect(screen.getByTestId('media-card-unplayed-badge')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
  });

  it('caps the badge at 99+', () => {
    const screen = render(<MediaCard {...defaultProps} unplayedCount={250} />);
    expect(screen.getByText('99+')).toBeTruthy();
  });

  it('hides the badge when the count is zero', () => {
    const screen = render(<MediaCard {...defaultProps} unplayedCount={0} />);
    expect(screen.queryByTestId('media-card-unplayed-badge')).toBeNull();
  });

  it('hides the badge when there is no count (e.g. movies)', () => {
    const screen = render(<MediaCard {...defaultProps} />);
    expect(screen.queryByTestId('media-card-unplayed-badge')).toBeNull();
  });
});
