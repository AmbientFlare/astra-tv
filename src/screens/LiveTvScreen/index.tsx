/**
 * Live TV: every channel the server's tuners provide, either as a list with
 * what is on now and next, or as a guide grid.
 *
 * Jellyfin exposes Live TV as a "livetv" view in the library list, but it is
 * not a folder of items; browsing it like one shows nothing playable. This
 * screen reads the /LiveTv endpoints instead.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {
  canManageRecordings,
  formatClockTime,
  getAvailableLiveTvFilters,
  getLiveTvChannels,
  getNextPrograms,
  LiveTvChannel,
  LiveTvFilter,
  LiveTvProgram,
  LiveTvSession,
  programProgress,
} from '../../services/jellyfin/liveTv';
import {ServerProfile} from '../../services/storage';
import type {JellyfinMediaItem} from '../../services/jellyfin/types';
import {RecordingsView} from './RecordingsView';
import {MessageKey, t, tn} from '../../i18n';
import {LiveTvGuide} from './LiveTvGuide';

interface Props {
  onBack: () => void;
  /** The channel, and the list it was picked from for channel up/down. */
  onSelectChannel?: (channel: LiveTvChannel, channels: LiveTvChannel[]) => void;
  onPlayRecording?: (item: JellyfinMediaItem) => void;
  serverProfile: ServerProfile;
}

const FILTER_LABELS: Record<LiveTvFilter, MessageKey> = {
  all: 'liveTv.filter.all',
  favorites: 'liveTv.filter.favorites',
  kids: 'liveTv.filter.kids',
  movies: 'liveTv.filter.movies',
  news: 'liveTv.filter.news',
  series: 'liveTv.filter.series',
  sports: 'liveTv.filter.sports',
};

// Often enough for the progress bars and for a finished programme to give
// way to the next one, rarely enough to cost nothing.
const CLOCK_TICK_MS = 30_000;

// The live player's banner uses it too, so it lives with the service.
export {formatClockTime};

type LiveTvView = 'channels' | 'guide' | 'recordings';

// Playing a channel leaves this screen, so coming back mounts it fresh. These
// bring the viewer back to the view and channel they left from.
let rememberedView: LiveTvView = 'guide';
let rememberedChannelId: string | undefined;

/**
 * What to show as on now. The channel list is fetched once, so a programme
 * that has since ended gives way to the next one rather than sitting there
 * stale.
 */
export const nowAndNext = (
  channel: LiveTvChannel,
  now: number,
): {current?: LiveTvProgram; next?: LiveTvProgram} => {
  const {current, next} = channel;

  if (current && current.endTime <= now && next && next.startTime <= now) {
    return {current: next, next: undefined};
  }

  return {current, next};
};

export const LiveTvScreen = ({
  onBack,
  onPlayRecording,
  onSelectChannel,
  serverProfile,
}: Props) => {
  const [filter, setFilter] = useState<LiveTvFilter>('all');
  const [view, setView] = useState<LiveTvView>(rememberedView);
  // The guide takes focus when it is opened or returned to, but not when a
  // filter changes under it; focus stays on the filter then, as in the list.
  const guideTakesFocus = useRef(view === 'guide');
  const [filters, setFilters] = useState<LiveTvFilter[]>(['all']);
  const [channels, setChannels] = useState<LiveTvChannel[]>([]);
  const [nextPrograms, setNextPrograms] = useState<
    Record<string, LiveTvProgram>
  >({});
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [canRecord, setCanRecord] = useState(false);

  // Guards against overlapping page requests and against a late response
  // from a filter the user has already left.
  const requestToken = useRef(0);
  const loadingMore = useRef(false);

  const session: LiveTvSession = useMemo(
    () => ({
      accessToken: serverProfile.accessToken,
      serverUrl: serverProfile.serverUrl,
      userId: serverProfile.userId,
    }),
    [serverProfile],
  );

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let active = true;

    canManageRecordings(session)
      .then((allowed) => {
        if (active) {
          setCanRecord(allowed);
        }
      })
      .catch(() => {
        // Without it, the guide only tunes, as before.
      });

    getAvailableLiveTvFilters(session)
      .then((available) => {
        if (active) {
          setFilters(available);
        }
      })
      .catch(() => {
        // Without the counts, All is still there.
      });

    return () => {
      active = false;
    };
  }, [session]);

  // The next programme is a second, cheaper request per page. If it fails
  // the list still shows what is on now.
  const loadNextPrograms = useCallback(
    async (page: LiveTvChannel[], token: number) => {
      try {
        const next = await getNextPrograms(
          session,
          page.map((channel) => channel.id),
        );

        if (token === requestToken.current) {
          setNextPrograms((existing) => ({...existing, ...next}));
        }
      } catch {
        // Now-playing is enough to pick a channel.
      }
    },
    [session],
  );

  useEffect(() => {
    let active = true;
    const token = (requestToken.current += 1);

    const load = async () => {
      setLoading(true);
      setErrorText(null);
      setChannels([]);
      setTotalCount(0);

      try {
        const page = await getLiveTvChannels(session, {filter});

        if (!active || token !== requestToken.current) {
          return;
        }

        setChannels(page.items);
        setTotalCount(page.totalCount);
        loadNextPrograms(page.items, token);
      } catch (error) {
        if (active && token === requestToken.current) {
          setErrorText(
            error instanceof Error ? error.message : t('liveTv.loadFailed'),
          );
        }
      } finally {
        if (active && token === requestToken.current) {
          setLoading(false);
        }
      }
    };

    load();

    return () => {
      active = false;
    };
  }, [filter, loadNextPrograms, session]);

  const loadMore = useCallback(async () => {
    if (loadingMore.current || channels.length >= totalCount || isLoading) {
      return;
    }

    loadingMore.current = true;
    const token = requestToken.current;

    try {
      const page = await getLiveTvChannels(session, {
        filter,
        startIndex: channels.length,
      });

      // Drop the result if the filter changed while it was in flight.
      if (token !== requestToken.current) {
        return;
      }

      setChannels((existing) => {
        const seen = new Set(existing.map((channel) => channel.id));
        return [
          ...existing,
          ...page.items.filter((channel) => !seen.has(channel.id)),
        ];
      });
      setTotalCount(page.totalCount);
      loadNextPrograms(page.items, token);
    } catch {
      // A failed page is not fatal; the user can scroll again to retry.
    } finally {
      loadingMore.current = false;
    }
  }, [
    channels.length,
    filter,
    isLoading,
    loadNextPrograms,
    session,
    totalCount,
  ]);

  const withNext = useCallback(
    (channel: LiveTvChannel) => ({
      ...channel,
      next: channel.next ?? nextPrograms[channel.id],
    }),
    [nextPrograms],
  );

  const channelsWithNext = useMemo(
    () => channels.map(withNext),
    [channels, withNext],
  );

  const selectChannel = useCallback(
    (channel: LiveTvChannel) => {
      rememberedChannelId = channel.id;
      onSelectChannel?.(withNext(channel), channelsWithNext);
    },
    [channelsWithNext, onSelectChannel, withNext],
  );

  const isRecordings = view === 'recordings';

  const changeView = (next: LiveTvView) => {
    rememberedView = next;
    guideTakesFocus.current = next === 'guide';
    setView(next);
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <FocusableItem
          focusedStyle={styles.pillFocused}
          onPress={onBack}
          style={styles.pill}
          testID="livetv-back">
          <Text style={styles.pillText}>{t('common.back')}</Text>
        </FocusableItem>
        <Text style={styles.title}>{t('nav.liveTv')}</Text>
        <TVFocusGuideView style={styles.tabs}>
          {(isRecordings ? [] : filters).map((entry) => (
            <FocusableItem
              focusedStyle={styles.tabFocused}
              hasTVPreferredFocus={view === 'channels' && entry === 'all'}
              key={entry}
              onPress={() => {
                guideTakesFocus.current = false;
                setFilter(entry);
              }}
              style={[styles.tab, filter === entry && styles.tabActive]}
              testID={`livetv-filter-${entry}`}>
              <Text style={styles.tabText}>{t(FILTER_LABELS[entry])}</Text>
            </FocusableItem>
          ))}
        </TVFocusGuideView>
        <TVFocusGuideView style={styles.views}>
          {(['guide', 'channels', 'recordings'] as const).map((entry) => (
            <FocusableItem
              focusedStyle={styles.tabFocused}
              key={entry}
              onPress={() => changeView(entry)}
              style={[styles.tab, view === entry && styles.tabActive]}
              testID={`livetv-view-${entry}`}>
              <Text style={styles.tabText}>{t(`liveTv.view.${entry}`)}</Text>
            </FocusableItem>
          ))}
        </TVFocusGuideView>
      </View>

      <Text style={styles.count}>
        {totalCount && !isRecordings
          ? tn('liveTv.channelCount', totalCount)
          : ''}
      </Text>

      {view === 'recordings' ? (
        <RecordingsView
          canManage={canRecord}
          onPlay={(item) => onPlayRecording?.(item)}
          session={session}
        />
      ) : view === 'guide' ? (
        channels.length ? (
          <LiveTvGuide
            canRecord={canRecord}
            channels={channelsWithNext}
            hasTVPreferredFocus={guideTakesFocus.current}
            initialChannelId={rememberedChannelId}
            key={filter}
            now={now}
            onNeedMore={loadMore}
            onSelectChannel={selectChannel}
            session={session}
          />
        ) : null
      ) : (
        <FlatList
          contentContainerStyle={styles.listContent}
          data={channels}
          extraData={[nextPrograms, now]}
          initialNumToRender={8}
          key={filter}
          keyExtractor={(channel) => channel.id}
          maxToRenderPerBatch={8}
          onEndReached={loadMore}
          onEndReachedThreshold={0.6}
          removeClippedSubviews={true}
          renderItem={({item}) => (
            <ChannelRow
              channel={withNext(item)}
              now={now}
              onPress={() => selectChannel(item)}
            />
          )}
          windowSize={7}
        />
      )}

      {isLoading && !isRecordings ? (
        <ActivityIndicator style={styles.spinner} />
      ) : null}
      {errorText && !isRecordings ? (
        <Text style={styles.error}>{errorText}</Text>
      ) : null}
      {!isRecordings && !isLoading && !errorText && !channels.length ? (
        <Text style={styles.status}>
          {filter === 'all' ? t('liveTv.noChannels') : t('liveTv.noneInFilter')}
        </Text>
      ) : null}
    </View>
  );
};

const ChannelRow = ({
  channel,
  now,
  onPress,
}: {
  channel: LiveTvChannel;
  now: number;
  onPress: () => void;
}) => {
  const {current, next} = nowAndNext(channel, now);

  return (
    <FocusableItem
      focusedStyle={styles.rowFocused}
      onPress={onPress}
      style={styles.row}
      testID={`livetv-channel-${channel.id}`}>
      <Text numberOfLines={1} style={styles.number}>
        {channel.number ?? ''}
      </Text>
      {channel.imageUrl ? (
        <Image
          resizeMode="contain"
          source={{uri: channel.imageUrl}}
          style={styles.logo}
        />
      ) : (
        <View style={[styles.logo, styles.placeholder]}>
          <Text numberOfLines={1} style={styles.placeholderText}>
            {channel.name.slice(0, 1).toUpperCase()}
          </Text>
        </View>
      )}
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={styles.channelName}>
          {channel.isFavorite ? '★ ' : ''}
          {channel.name}
        </Text>
        {current ? (
          <>
            <Text numberOfLines={1} style={styles.programName}>
              {current.episodeTitle
                ? `${current.name} · ${current.episodeTitle}`
                : current.name}
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
                />
              </View>
              <Text style={styles.time}>
                {formatClockTime(current.endTime)}
              </Text>
            </View>
          </>
        ) : (
          <Text style={styles.noGuide}>{t('liveTv.noGuide')}</Text>
        )}
      </View>
      <View style={styles.nextColumn}>
        {next ? (
          <>
            <Text style={styles.nextLabel}>
              {t('liveTv.nextAt', {time: formatClockTime(next.startTime)})}
            </Text>
            <Text numberOfLines={2} style={styles.nextName}>
              {next.name}
            </Text>
          </>
        ) : null}
      </View>
    </FocusableItem>
  );
};

const styles = StyleSheet.create({
  root: {backgroundColor: '#0b0d10', flex: 1, padding: 28},
  header: {alignItems: 'center', flexDirection: 'row', marginBottom: 10},
  title: {
    color: '#f4f6f8',
    fontSize: 24,
    fontWeight: '700',
    marginLeft: 12,
  },
  tabs: {flex: 1, flexDirection: 'row', marginHorizontal: 16},
  views: {flexDirection: 'row'},
  tab: {
    borderRadius: 8,
    marginRight: 10,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  tabActive: {backgroundColor: '#1d2530'},
  tabFocused: {backgroundColor: '#54d38a'},
  tabText: {color: '#f4f6f8', fontSize: 20, fontWeight: '600'},
  pill: {borderRadius: 8, paddingHorizontal: 18, paddingVertical: 8},
  pillFocused: {backgroundColor: '#54d38a'},
  pillText: {color: '#c8d2dc', fontSize: 18},
  count: {color: '#6f7d8c', fontSize: 15, marginBottom: 10},
  listContent: {paddingBottom: 24},
  row: {
    alignItems: 'center',
    backgroundColor: '#12161c',
    borderRadius: 10,
    flexDirection: 'row',
    marginVertical: 4,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  rowFocused: {backgroundColor: '#1d2530'},
  number: {
    color: '#8b97a5',
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'right',
    width: 64,
  },
  logo: {
    backgroundColor: '#161b22',
    borderRadius: 6,
    height: 54,
    marginHorizontal: 16,
    width: 96,
  },
  placeholder: {alignItems: 'center', justifyContent: 'center'},
  placeholderText: {color: '#54d38a', fontSize: 24, fontWeight: '700'},
  rowText: {flex: 1},
  channelName: {color: '#8b97a5', fontSize: 15},
  programName: {color: '#f4f6f8', fontSize: 19, fontWeight: '600'},
  progressRow: {alignItems: 'center', flexDirection: 'row', marginTop: 4},
  progressTrack: {
    backgroundColor: '#2a313b',
    borderRadius: 2,
    flex: 1,
    height: 4,
    marginHorizontal: 10,
    maxWidth: 360,
  },
  progressFill: {backgroundColor: '#54d38a', borderRadius: 2, height: 4},
  time: {color: '#8b97a5', fontSize: 14},
  noGuide: {color: '#6f7d8c', fontSize: 16, marginTop: 2},
  nextColumn: {marginLeft: 16, width: 280},
  nextLabel: {color: '#6f7d8c', fontSize: 14},
  nextName: {color: '#c8d2dc', fontSize: 16},
  spinner: {marginTop: 12},
  status: {color: '#8b97a5', fontSize: 18, marginTop: 12},
  error: {color: '#ff8a80', fontSize: 17, marginTop: 12},
});
