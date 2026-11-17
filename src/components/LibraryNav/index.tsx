/**
 * Top-level library navigation.
 *
 * Sits at the top of the home screen rather than as a row of cards partway
 * down the page, so the primary sections are the first thing focus lands on.
 *
 * Every section shares one rail that scrolls sideways, each under its own
 * caption, so the rows of things to watch start on the first screen however
 * many libraries the server has.
 */
import React from 'react';
import {Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../FocusableItem';
import {JellyfinLibrary} from '../../services/jellyfin';
import {
  buildNavEntries,
  buildNavSections,
  NavEntry,
  NavSection,
} from './entries';
import {colors} from '../../theme';

interface LibraryNavProps {
  /** Poster URLs per library id; a library without any shows its own image. */
  artworkByLibrary?: Record<string, string[]>;
  hasTVPreferredFocus?: boolean;
  libraries: JellyfinLibrary[];
  musicAvailable: boolean;
  onSelect: (entry: NavEntry) => void;
}

export const LibraryNav = ({
  artworkByLibrary = {},
  hasTVPreferredFocus = false,
  libraries,
  musicAvailable,
  onSelect,
}: LibraryNavProps) => {
  const sections = buildNavSections(libraries, {musicAvailable});

  if (!sections.length) {
    return null;
  }

  return (
    <ScrollView horizontal={true} style={styles.rail}>
      <TVFocusGuideView style={styles.sections}>
        {sections.map((section, sectionIndex) => (
          <View key={section.id}>
            {/* An untitled section keeps the line, so the tiles line up. */}
            <Text numberOfLines={1} style={styles.sectionTitle}>
              {section.title ?? ' '}
            </Text>
            <View style={styles.row}>
              {section.entries.map((entry, index) => (
                <FocusableItem
                  focus="outline"
                  hasTVPreferredFocus={
                    hasTVPreferredFocus && sectionIndex === 0 && index === 0
                  }
                  key={entry.id}
                  onPress={() => onSelect(entry)}
                  style={styles.item}
                  testID={`home-nav-${entry.kind}`}>
                  <View style={styles.collage}>
                    {(artworkByLibrary[entry.library.id]?.length
                      ? artworkByLibrary[entry.library.id]
                      : [entry.library.imageUrl]
                    )
                      .filter((url): url is string => Boolean(url))
                      .slice(0, 6)
                      .map((url, artIndex) =>
                        // Channel logos are wide and often transparent, so
                        // fit them whole instead of cropping them like posters.
                        entry.kind === 'livetv' ? (
                          <View
                            key={`${url}-${artIndex}`}
                            style={styles.logoCell}>
                            <Image source={{uri: url}} style={styles.logo} />
                          </View>
                        ) : (
                          <Image
                            key={`${url}-${artIndex}`}
                            source={{uri: url}}
                            style={styles.art}
                          />
                        ),
                      )}
                  </View>
                  <View style={styles.scrim} />
                  <Text numberOfLines={1} style={styles.label}>
                    {entry.label}
                  </Text>
                </FocusableItem>
              ))}
            </View>
          </View>
        ))}
      </TVFocusGuideView>
    </ScrollView>
  );
};

export {buildNavEntries, buildNavSections};
export type {NavEntry, NavSection};

const styles = StyleSheet.create({
  // Room on every side for the focus ring, which the scroller would clip.
  rail: {
    flexGrow: 0,
    marginBottom: 14,
    marginHorizontal: -6,
  },
  sections: {
    flexDirection: 'row',
    gap: 36,
    paddingBottom: 6,
    paddingHorizontal: 6,
  },
  row: {
    flexDirection: 'row',
    gap: 18,
  },
  sectionTitle: {
    color: colors.text.secondary,
    fontSize: 20,
    fontWeight: '700',
    height: 28,
    marginBottom: 8,
  },
  item: {
    backgroundColor: colors.surface.card,
    borderRadius: 12,
    height: 158,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    width: 256,
  },
  collage: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  art: {
    height: '50%',
    resizeMode: 'cover',
    width: '33.333%',
  },
  logoCell: {
    height: '50%',
    padding: 12,
    width: '33.333%',
  },
  logo: {
    flex: 1,
    resizeMode: 'contain',
  },
  scrim: {
    backgroundColor: colors.scrim.hero,
    bottom: 0,
    height: 58,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  label: {
    color: colors.text.primary,
    fontSize: 24,
    fontWeight: '800',
    paddingBottom: 13,
    paddingHorizontal: 16,
  },
});
