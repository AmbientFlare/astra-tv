import React, {useEffect, useState} from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {
  formatClockTime,
  getChannelSchedule,
  LiveTvChannel,
  LiveTvProgram,
  LiveTvSession,
  programProgress,
} from '../../services/jellyfin/liveTv';
import {t} from '../../i18n';

interface Props {
  /** From the channel list when there is one; shown until the guide answers. */
  channel?: LiveTvChannel;
  channelId: string;
  name: string;
  session: LiveTvSession;
  /** Up and Down change channel, so say so. */
  showChannelHint: boolean;
}

const CLOCK_TICK_MS = 30_000;

/**
 * The live player's info bar: which channel this is, what is on, how far in,
 * and what comes next. It takes the place of the seek bar, which a live
 * channel does not have.
 */
export const LiveChannelBanner = ({
  channel,
  channelId,
  name,
  session,
  showChannelHint,
}: Props) => {
  const [schedule, setSchedule] = useState<{
    current?: LiveTvProgram;
    next?: LiveTvProgram;
  }>({current: channel?.current, next: channel?.next});
  const [now, setNow] = useState(() => Date.now());
  const currentEnd = schedule.current?.endTime;
  // Fetch again once the programme on screen has ended.
  const stale = currentEnd !== undefined && currentEnd <= now;

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;

    getChannelSchedule(session, channelId)
      .then((result) => {
        if (active) {
          setSchedule(result);
        }
      })
      .catch((error) => {
        console.warn('[Astra] Unable to load the channel guide:', error);
      });

    return () => {
      active = false;
    };
  }, [channelId, session, stale]);

  const {current, next} = schedule;

  return (
    <View style={styles.banner} testID="live-channel-banner">
      <View style={styles.channelRow}>
        {channel?.imageUrl ? (
          <Image
            resizeMode="contain"
            source={{uri: channel.imageUrl}}
            style={styles.logo}
          />
        ) : null}
        {channel?.number ? (
          <Text style={styles.number}>{channel.number}</Text>
        ) : null}
        <Text numberOfLines={1} style={styles.channelName}>
          {name}
        </Text>
        <View style={styles.liveBadge}>
          <Text style={styles.liveText}>{t('liveTv.live')}</Text>
        </View>
      </View>
      {current ? (
        <>
          <Text numberOfLines={1} style={styles.programme}>
            {[current.name, current.episodeTitle].filter(Boolean).join(' · ')}
          </Text>
          <View style={styles.progressRow}>
            <Text style={styles.time}>
              {formatClockTime(current.startTime)}
            </Text>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.round(
                      programProgress(current, now) * 100,
                    )}%`,
                  },
                ]}
                testID="live-channel-progress"
              />
            </View>
            <Text style={styles.time}>{formatClockTime(current.endTime)}</Text>
          </View>
        </>
      ) : (
        <Text style={styles.programme}>{t('liveTv.noGuide')}</Text>
      )}
      <View style={styles.footer}>
        <Text numberOfLines={1} style={styles.next}>
          {next
            ? `${t('liveTv.nextAt', {
                time: formatClockTime(next.startTime),
              })}  ${next.name}`
            : ''}
        </Text>
        {showChannelHint ? (
          <Text style={styles.hint}>{t('liveTv.changeChannelHint')}</Text>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    backgroundColor: 'rgba(0,0,0,0.72)',
    bottom: 0,
    left: 0,
    paddingBottom: 44,
    paddingHorizontal: 72,
    paddingTop: 28,
    position: 'absolute',
    right: 0,
  },
  channelName: {
    color: '#FFFFFF',
    flexShrink: 1,
    fontSize: 32,
    fontWeight: '800',
  },
  channelRow: {alignItems: 'center', flexDirection: 'row'},
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  hint: {color: '#8C99A3', fontSize: 20, marginLeft: 24},
  liveBadge: {
    backgroundColor: '#D7263D',
    borderRadius: 4,
    marginLeft: 18,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  liveText: {color: '#FFFFFF', fontSize: 18, fontWeight: '800'},
  logo: {height: 56, marginRight: 18, width: 96},
  next: {color: '#B8C5CC', flexShrink: 1, fontSize: 22},
  number: {color: '#B8C5CC', fontSize: 30, fontWeight: '700', marginRight: 16},
  programme: {color: '#E6EDF2', fontSize: 26, fontWeight: '600', marginTop: 12},
  progressFill: {backgroundColor: '#54d38a', borderRadius: 3, height: 6},
  progressRow: {alignItems: 'center', flexDirection: 'row', marginTop: 10},
  progressTrack: {
    backgroundColor: 'rgba(255,255,255,0.24)',
    borderRadius: 3,
    flex: 1,
    height: 6,
    marginHorizontal: 14,
    overflow: 'hidden',
  },
  time: {color: '#B8C5CC', fontSize: 20},
});
