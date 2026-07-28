import React from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {FocusableItem} from '../FocusableItem';

interface MediaCardProps {
  imageUrl?: string;
  title: string;
  subtitle?: string;
  hasTVPreferredFocus?: boolean;
  imageScale?: number;
  onFocus?: () => void;
  onPress?: () => void;
  badgeText?: string;
}

export const formatUnplayedBadge = (count?: number) =>
  count && count > 0 ? (count > 99 ? '99+' : String(count)) : undefined;

export const MediaCard = ({
  hasTVPreferredFocus,
  badgeText,
  imageUrl,
  imageScale = 1,
  onFocus,
  onPress,
  subtitle,
  title,
}: MediaCardProps) => (
  <FocusableItem
    accessibilityLabel={title}
    focusedStyle={styles.focused}
    hasTVPreferredFocus={hasTVPreferredFocus}
    onFocus={onFocus}
    onPress={onPress}
    style={[
      styles.card,
      {
        width: Math.round(248 * imageScale),
        height: Math.round(412 * imageScale),
      },
    ]}
    testID={`media-card-${title}`}>
    {imageUrl ? (
      <Image
        resizeMode="cover"
        source={{uri: imageUrl}}
        style={[styles.image, {height: Math.round(330 * imageScale)}]}
      />
    ) : (
      <View
        style={[
          styles.imagePlaceholder,
          {height: Math.round(330 * imageScale)},
        ]}>
        <Text numberOfLines={2} style={styles.placeholderText}>
          {title}
        </Text>
      </View>
    )}
    {badgeText ? (
      <View style={styles.badge} testID={`media-card-badge-${title}`}>
        <Text style={styles.badgeText}>{badgeText}</Text>
      </View>
    ) : null}
    <View style={styles.caption}>
      <Text numberOfLines={2} style={styles.title}>
        {title}
      </Text>
      {subtitle ? (
        <Text numberOfLines={1} style={styles.subtitle}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  </FocusableItem>
);

const styles = StyleSheet.create({
  card: {
    width: 248,
    height: 412,
    borderRadius: 8,
    backgroundColor: '#24313A',
    overflow: 'hidden',
  },
  focused: {
    backgroundColor: '#24313A',
    transform: [{scale: 1.04}],
  },
  badge: {
    alignItems: 'center',
    backgroundColor: '#d6232f',
    height: 50,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    top: 0,
    width: 50,
  },
  badgeText: {color: '#fff', fontSize: 18, fontWeight: '800'},
  image: {
    width: '100%',
    height: 330,
    backgroundColor: '#182027',
  },
  imagePlaceholder: {
    width: '100%',
    height: 330,
    backgroundColor: '#1B2A30',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  placeholderText: {
    color: '#8CA1AA',
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  caption: {
    height: 82,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 23,
    fontWeight: '700',
  },
  subtitle: {
    color: '#B8C5CC',
    fontSize: 19,
    marginTop: 4,
  },
});
