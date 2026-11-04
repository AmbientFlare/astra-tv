import React, {useCallback, useEffect, useState} from 'react';
import {Image, ScrollView, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {
  formatClockTime,
  getOnNowPrograms,
  LiveTvSession,
  OnNowProgram,
  programProgress,
} from '../../services/jellyfin/liveTv';
import {t} from '../../i18n';

// Often enough for the progress bars, and for a finished programme to give
// way to whatever replaced it.
const CLOCK_TICK_MS = 30_000;

/**
 * What is airing now, like the On Now row on Jellyfin's own home screen.
 * Selecting a card tunes to its channel. The row hides itself when nothing is
 * on or the server will not say, so it costs nothing without Live TV.
 */
export const OnNowRow = ({
  onFocusBackdrop,
  onSelect,
  session,
}: {
  onFocusBackdrop?: (url?: string) => void;
  onSelect: (program: OnNowProgram, programs: OnNowProgram[]) => void;
  session: LiveTvSession;
}) => {
  const [programs, setPrograms] = useState<OnNowProgram[]>([]);
  const [now, setNow] = useState(Date.now);

  const load = useCallback(async () => {
    try {
      setPrograms(await getOnNowPrograms(session));
    } catch {
      setPrograms([]);
    }
    setNow(Date.now());
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const hasEnded = programs.some((program) => program.endTime <= now);

  useEffect(() => {
    if (hasEnded) {
      load();
    }
  }, [hasEnded, load]);

  if (!programs.length) {
    return null;
  }

  return (
    <>
      <Text style={styles.rowTitle}>{t('home.onNow')}</Text>
      <ScrollView horizontal={true} style={styles.scroller}>
        <TVFocusGuideView style={styles.row}>
          {programs.map((program) => (
            <OnNowCard
              key={program.id}
              now={now}
              onFocus={() =>
                onFocusBackdrop?.(program.imageUrl ?? program.channel.imageUrl)
              }
              onPress={() => onSelect(program, programs)}
              program={program}
            />
          ))}
        </TVFocusGuideView>
      </ScrollView>
    </>
  );
};

const OnNowCard = ({
  now,
  onFocus,
  onPress,
  program,
}: {
  now: number;
  onFocus: () => void;
  onPress: () => void;
  program: OnNowProgram;
}) => (
  <FocusableItem
    accessibilityLabel={`${program.name}, ${program.channel.name}`}
    focusedStyle={styles.focused}
    onFocus={onFocus}
    onPress={onPress}
    style={styles.card}
    testID={`on-now-card-${program.id}`}>
    <View style={styles.art}>
      {/* Shows through when the programme has no image, or it fails. */}
      <View style={styles.fallback}>
        {program.channel.imageUrl ? (
          <Image source={{uri: program.channel.imageUrl}} style={styles.logo} />
        ) : null}
        <Text numberOfLines={2} style={styles.fallbackText}>
          {program.channel.name}
        </Text>
      </View>
      {program.imageUrl ? (
        <Image source={{uri: program.imageUrl}} style={styles.image} />
      ) : null}
      <View style={styles.progressTrack}>
        <View
          style={[
            styles.progressFill,
            {width: `${Math.round(programProgress(program, now) * 100)}%`},
          ]}
        />
      </View>
    </View>
    <View style={styles.caption}>
      <Text numberOfLines={1} style={styles.title}>
        {program.name}
      </Text>
      <Text numberOfLines={1} style={styles.subtitle}>
        {program.episodeTitle ?? program.channel.name}
      </Text>
      <Text numberOfLines={1} style={styles.time}>
        {`${formatClockTime(program.startTime)} – ${formatClockTime(
          program.endTime,
        )}`}
      </Text>
    </View>
  </FocusableItem>
);

const CARD_WIDTH = 280;

const styles = StyleSheet.create({
  rowTitle: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '800',
    marginBottom: 14,
    marginTop: 18,
  },
  scroller: {
    flexGrow: 0,
    marginBottom: 30,
  },
  row: {
    flexDirection: 'row',
    gap: 28,
  },
  card: {
    backgroundColor: '#24313A',
    borderRadius: 8,
    overflow: 'hidden',
    width: CARD_WIDTH,
  },
  focused: {
    backgroundColor: '#24313A',
    transform: [{scale: 1.04}],
  },
  art: {
    backgroundColor: '#182027',
    height: CARD_WIDTH,
    width: CARD_WIDTH,
  },
  fallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    gap: 14,
    justifyContent: 'center',
    padding: 24,
  },
  logo: {
    height: 90,
    resizeMode: 'contain',
    width: '80%',
  },
  fallbackText: {
    color: '#8CA1AA',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    resizeMode: 'cover',
  },
  progressTrack: {
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    bottom: 0,
    height: 6,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  progressFill: {
    backgroundColor: '#54d38a',
    height: 6,
  },
  caption: {
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    color: '#B8C5CC',
    fontSize: 18,
    marginTop: 4,
  },
  time: {
    color: '#8CA1AA',
    fontSize: 17,
    marginTop: 4,
  },
});
