import 'react-native';
import {render, fireEvent} from '@testing-library/react-native';
import * as React from 'react';

import {Tile} from '../src/components/Tile';

const mockIcon = {uri: 'mock-icon'};

const defaultProps = {
  label: 'Test Tile',
  icon: mockIcon,
  isFocused: false,
  onFocus: jest.fn(),
  testID: 'test-tile',
};

describe('Tile component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the label text', () => {
    const screen = render(<Tile {...defaultProps} />);
    expect(screen.getByText('Test Tile')).toBeTruthy();
  });

  it('applies default style when not focused', () => {
    const screen = render(<Tile {...defaultProps} isFocused={false} />);
    const touchable = screen.getByTestId('test-tile');
    const flatStyle = Object.assign({}, ...[touchable.props.style].flat());
    expect(flatStyle.backgroundColor).toBe('#0074B8');
  });

  it('applies focused style when focused', () => {
    const screen = render(<Tile {...defaultProps} isFocused={true} />);
    const touchable = screen.getByTestId('test-tile');
    const flatStyle = Object.assign({}, ...[touchable.props.style].flat());
    expect(flatStyle.backgroundColor).toBe('#FF6200');
    expect(flatStyle.transform).toEqual([{scale: 1.1}]);
  });

  it('calls onFocus when focused', () => {
    const onFocus = jest.fn();
    const screen = render(<Tile {...defaultProps} onFocus={onFocus} />);
    fireEvent(screen.getByTestId('test-tile'), 'focus');
    expect(onFocus).toHaveBeenCalledTimes(1);
  });

  it('calls onBlur when blurred', () => {
    const onBlur = jest.fn();
    const screen = render(<Tile {...defaultProps} onBlur={onBlur} />);
    fireEvent(screen.getByTestId('test-tile'), 'blur');
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});
