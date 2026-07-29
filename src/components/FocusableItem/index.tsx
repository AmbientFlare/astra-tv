import React, {PropsWithChildren, useRef, useState} from 'react';
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
  onLongPress?: () => void;
  longPressDelayMs?: number;
}

export const FocusableItem = ({
  accessibilityLabel,
  children,
  disabled,
  focusedStyle,
  hasTVPreferredFocus,
  longPressDelayMs = 2000,
  onBlur,
  onFocus,
  onLongPress,
  onPress,
  style,
  testID,
}: PropsWithChildren<FocusableItemProps>) => {
  const [isFocused, setFocused] = useState(false);
  const longPressFired = useRef(false);

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
      delayLongPress={longPressDelayMs}
      onLongPress={() => {
        longPressFired.current = true;
        onLongPress?.();
      }}
      onPress={() => {
        if (longPressFired.current) {
          longPressFired.current = false;
          return;
        }
        if (!audioIdleGate.consumeInput()) {
          onPress?.();
        }
      }}
      onPressIn={() => {
        longPressFired.current = false;
      }}
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
