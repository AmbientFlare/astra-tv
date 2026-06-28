import React from 'react';
import {
  Image,
  ImageSourcePropType,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

export interface TileProps {
  label: string;
  icon: ImageSourcePropType;
  isFocused: boolean;
  onFocus: () => void;
  onBlur?: () => void;
  testID?: string;
  accessibilityLabel?: string;
  hasTVPreferredFocus?: boolean;
}

export const Tile = ({
  label,
  icon,
  isFocused,
  onFocus,
  onBlur,
  testID,
  accessibilityLabel,
  hasTVPreferredFocus,
}: TileProps) => {
  return (
    <TouchableOpacity
      style={[styles.tile, isFocused ? styles.focused : styles.default]}
      onFocus={onFocus}
      onBlur={onBlur}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hasTVPreferredFocus={hasTVPreferredFocus}
      activeOpacity={1}>
      <View style={styles.topHalf}>
        <Image
          source={icon}
          style={styles.icon}
          resizeMode="contain"
          accessible={false}
        />
      </View>
      <View style={styles.bottomHalf}>
        <Text style={styles.label}>{label}</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  tile: {
    width: 320,
    height: 320,
    borderRadius: 44,
    overflow: 'hidden',
    padding: 20,
  },
  topHalf: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomHalf: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  default: {
    backgroundColor: '#0074B8',
  },
  focused: {
    backgroundColor: '#FF6200',
    transform: [{scale: 1.1}],
    opacity: 1,
  },
  icon: {
    width: 80,
    height: 80,
    tintColor: '#FFFFFF',
  },
  label: {
    color: '#FFFFFF',
    fontSize: 52,
    fontWeight: 'bold',
    textAlign: 'center',
    lineHeight: 52,
    includeFontPadding: false,
  },
});
