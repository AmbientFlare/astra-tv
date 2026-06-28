import React, {PropsWithChildren, useState} from 'react';
import {StyleProp, StyleSheet, TouchableOpacity, ViewStyle} from 'react-native';

interface FocusableItemProps {
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  focusedStyle?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  hasTVPreferredFocus?: boolean;
}

export const FocusableItem = ({
  accessibilityLabel,
  children,
  disabled,
  focusedStyle,
  hasTVPreferredFocus,
  onPress,
  style,
  testID,
}: PropsWithChildren<FocusableItemProps>) => {
  const [isFocused, setFocused] = useState(false);

  return (
    <TouchableOpacity
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      activeOpacity={1}
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onBlur={() => setFocused(false)}
      onFocus={() => setFocused(true)}
      onPress={onPress}
      style={[
        styles.base,
        style,
        isFocused && styles.focused,
        isFocused && focusedStyle,
      ]}
      testID={testID}>
      {children}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  base: {
    borderWidth: 3,
    borderColor: 'transparent',
  },
  focused: {
    borderColor: '#4CC9F0',
  },
});
