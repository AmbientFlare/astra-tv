import React, {PropsWithChildren, useState} from 'react';
import {StyleProp, StyleSheet, TouchableOpacity, ViewStyle} from 'react-native';
import {audioIdleGate} from '../../services/audioIdleGate';

interface FocusableItemProps {
  onBlur?: () => void;
  onFocus?: () => void;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  focusedStyle?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  hasTVPreferredFocus?: boolean;
  /** For screens that hand focus back with requestTVFocus. */
  focusRef?: React.Ref<any>;
}

export const FocusableItem = ({
  accessibilityLabel,
  children,
  disabled,
  focusRef,
  focusedStyle,
  hasTVPreferredFocus,
  onBlur,
  onFocus,
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
      onBlur={() => {
        setFocused(false);
        onBlur?.();
      }}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onPress={() => {
        if (!audioIdleGate.consumeInput()) {
          onPress?.();
        }
      }}
      style={[
        styles.base,
        style,
        isFocused && styles.focused,
        isFocused && focusedStyle,
      ]}
      ref={focusRef}
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
