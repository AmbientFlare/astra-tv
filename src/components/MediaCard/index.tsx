import React from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {FocusableItem} from '../FocusableItem';
import {isLiveItem} from '../../services/jellyfin/liveTv';
import {t} from '../../i18n';
import {colors} from '../../theme';

interface MediaCardProps {
  imageUrl?: string;
  title: string;
  subtitle?: string;
  hasTVPreferredFocus?: boolean;
  focusRef?: React.Ref<any>;
  imageScale?: number;
  onFocus?: () => void;
  onPress?: () => void;
  badgeText?: string;
}

export const formatUnplayedBadge = (count?: number) =>
  count && count > 0 ? (count > 99 ? '99+' : String(count)) : undefined;

/**
 * A card's label for a channel plugin's items, whose API type names
 * (Video, ChannelFolderItem) mean nothing on screen. Undefined for the rest.
 */
export const channelItemLabel = (item: {type: string; tags?: string[]}) =>
  isLiveItem(item)
    ? t('liveTv.live')
    : item.type === 'ChannelFolderItem'
    ? t('library.folder')
    : undefined;

export const MediaCard = ({
  focusRef,
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
    focusRef={focusRef}
    focus="card"
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
        <Text numberOfLines={10} style={styles.placeholderText}>
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
    backgroundColor: colors.surface.control,
    overflow: 'hidden',
  },
  badge: {
    alignItems: 'center',
    backgroundColor: colors.fill.badge,
    height: 50,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    top: 0,
    width: 50,
  },
  badgeText: {color: colors.text.primary, fontSize: 18, fontWeight: '800'},
  image: {
    width: '100%',
    height: 330,
    backgroundColor: colors.surface.card,
  },
  imagePlaceholder: {
    width: '100%',
    height: 330,
    backgroundColor: colors.surface.card,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  placeholderText: {
    // A card with no artwork has the whole poster area free, so a long name
    // (a release filename, say) is shown in full rather than clipped to the
    // two lines that suit a title sitting under a poster.
    color: colors.text.muted,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
    textAlign: 'center',
  },
  caption: {
    height: 82,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  // Two title lines and the subtitle fill the caption; set line heights so
  // they fit inside it rather than running into the card's bottom edge.
  title: {
    color: colors.text.primary,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 26,
  },
  subtitle: {
    color: colors.text.secondary,
    fontSize: 18,
    lineHeight: 22,
    marginTop: 2,
  },
});
