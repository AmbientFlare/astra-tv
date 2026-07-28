import 'react-native';
import {render} from '@testing-library/react-native';
import React from 'react';
import {formatUnplayedBadge, MediaCard} from '../src/components/MediaCard';

describe('series unwatched badge', () => {
  it('renders as a red square on the poster', () => {
    const screen = render(<MediaCard badgeText="12" title="A Series" />);
    const badge = screen.getByTestId('media-card-badge-A Series');
    const style = Object.assign({}, ...[badge.props.style].flat());

    expect(screen.getByText('12')).toBeTruthy();
    expect(style.backgroundColor).toBe('#d6232f');
    expect(style.height).toBe(50);
    expect(style.width).toBe(50);
    expect(style.left).toBe(0);
    expect(style.top).toBe(0);
  });

  it('caps counts above 99 and hides zero', () => {
    expect(formatUnplayedBadge(1)).toBe('1');
    expect(formatUnplayedBadge(99)).toBe('99');
    expect(formatUnplayedBadge(100)).toBe('99+');
    expect(formatUnplayedBadge(135)).toBe('99+');
    expect(formatUnplayedBadge(0)).toBeUndefined();
    expect(formatUnplayedBadge()).toBeUndefined();
  });
});
