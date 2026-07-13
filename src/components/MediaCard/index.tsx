import React, {memo} from 'react';
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
  // Number of unwatched child episodes for a series; a badge shows when > 0.
  unplayedCount?: number | null;
}

export const MediaCard = memo(
  ({
    hasTVPreferredFocus,
    imageUrl,
    imageScale = 1,
    onFocus,
    onPress,
    subtitle,
    title,
    unplayedCount,
  }: MediaCardProps) => (
    <FocusableItem
      accessibilityLabel={
        unplayedCount ? `${title}, ${unplayedCount} unplayed` : title
      }
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
      {unplayedCount ? (
        <View style={styles.unplayedBadge} testID="media-card-unplayed-badge">
          <Text style={styles.unplayedBadgeText}>
            {unplayedCount > 99 ? '99+' : unplayedCount}
          </Text>
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
  ),
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
  image: {
    width: '100%',
    height: 330,
    backgroundColor: '#182027',
  },
  // Unwatched-episode count, TOP-LEFT of the poster. Deliberately a red
  // square — distinct from Jellyfin's own top-right light-blue circle so the
  // two read as separate at a glance. Dark outline keeps it legible on any
  // artwork.
  unplayedBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    minWidth: 34,
    height: 34,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: '#E5342E',
    borderWidth: 2,
    borderColor: '#0B1418',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unplayedBadgeText: {
    color: '#FFFFFF',
    fontSize: 19,
    fontWeight: '800',
    textAlign: 'center',
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
