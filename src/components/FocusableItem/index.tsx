import React, {PropsWithChildren, useEffect, useRef, useState} from 'react';
import {
  Animated,
  Easing,
  StyleProp,
  StyleSheet,
  TouchableOpacity,
  ViewStyle,
} from 'react-native';
import {audioIdleGate} from '../../services/audioIdleGate';
import {
  CARD_FOCUS_SCALE,
  FOCUS_BORDER_WIDTH,
  FOCUS_IN_MS,
  FOCUS_OUT_MS,
  FocusKind,
  colors,
  focusFill,
} from '../../theme';

interface FocusableItemProps {
  onBlur?: () => void;
  onFocus?: () => void;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** The shared focus look to use. See theme/focus. */
  focus?: FocusKind;
  /** Only for what the shared looks cannot express. */
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
  focus = 'control',
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
  // 0 at rest, 1 focused. Opacity and scale only, so the stick animates
  // them off the JS thread.
  const amount = useRef(new Animated.Value(0)).current;
  const running = useRef<Animated.CompositeAnimation | null>(null);

  const ease = (focused: boolean) => {
    running.current?.stop();
    running.current = Animated.timing(amount, {
      duration: focused ? FOCUS_IN_MS : FOCUS_OUT_MS,
      easing: Easing.out(Easing.quad),
      toValue: focused ? 1 : 0,
      useNativeDriver: true,
    });
    running.current.start();
  };

  useEffect(() => () => running.current?.stop(), []);

  const fill = focusFill[focus];
  const radius = fill
    ? Number(StyleSheet.flatten(style)?.borderRadius ?? 0)
    : 0;

  return (
    <TouchableOpacity
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      activeOpacity={1}
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onBlur={() => {
        setFocused(false);
        ease(false);
        onBlur?.();
      }}
      onFocus={() => {
        setFocused(true);
        ease(true);
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
        isFocused && focus !== 'none' && styles.outlined,
        isFocused && focus === 'card' && styles.cardFocused,
        focus === 'card' && {
          transform: [
            {
              scale: amount.interpolate({
                inputRange: [0, 1],
                outputRange: [1, CARD_FOCUS_SCALE],
              }),
            },
          ],
        },
        isFocused && focusedStyle,
      ]}
      ref={focusRef}
      testID={testID}>
      {fill ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.fill,
            {
              backgroundColor: fill,
              // The fill sits inside the outline, so its corners are tighter.
              borderRadius: Math.max(0, radius - FOCUS_BORDER_WIDTH),
              opacity: amount,
            },
          ]}
        />
      ) : null}
      {children}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  base: {
    borderWidth: FOCUS_BORDER_WIDTH,
    borderColor: 'transparent',
  },
  outlined: {
    borderColor: colors.border.focus,
  },
  cardFocused: {
    backgroundColor: colors.surface.control,
  },
  fill: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
});
