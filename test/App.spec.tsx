import 'react-native';
import {render} from '@testing-library/react-native';
import * as React from 'react';

import {App} from '../src/App';

describe('App', () => {
  it('matches snapshot', () => {
    const screen = render(<App />);
    expect(screen).toMatchSnapshot();
  });

  it('renders all four tiles', () => {
    const screen = render(<App />);
    expect(screen.getByTestId('tile-home')).toBeTruthy();
    expect(screen.getByTestId('tile-get-started')).toBeTruthy();
    expect(screen.getByTestId('tile-debug')).toBeTruthy();
    expect(screen.getByTestId('tile-learn-more')).toBeTruthy();
  });

  it('Home tile is focused by default', () => {
    const screen = render(<App />);
    const homeTile = screen.getByTestId('tile-home');
    const flatStyle = Object.assign({}, ...[homeTile.props.style].flat());
    expect(flatStyle.backgroundColor).toBe('#FF6200');
  });

  it('sets hasTVPreferredFocus on the Home tile only', () => {
    const screen = render(<App />);
    expect(screen.getByTestId('tile-home').props.hasTVPreferredFocus).toBe(
      true,
    );
    expect(
      screen.getByTestId('tile-get-started').props.hasTVPreferredFocus,
    ).toBe(false);
  });
});
