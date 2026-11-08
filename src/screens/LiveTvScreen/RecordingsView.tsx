import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {
  cancelRecording,
  cancelSeriesRecording,
  deleteRecording,
  formatClockTime,
  getRecordings,
  getScheduledRecordings,
  getSeriesRecordings,
  LiveTvRecording,
  LiveTvSession,
  ScheduledRecording,
  SeriesRecording,
} from '../../services/jellyfin/liveTv';
import type {JellyfinMediaItem} from '../../services/jellyfin/types';
import {getLocaleTag, t} from '../../i18n';
import {ActionPanel, PanelAction} from './ActionPanel';

type Target =
  | {kind: 'recording'; recording: LiveTvRecording}
  | {kind: 'scheduled'; scheduled: ScheduledRecording}
  | {kind: 'series'; series: SeriesRecording};

type Action = 'play' | 'stop' | 'delete' | 'cancel' | 'cancelSeries';

interface Props {
  /** Whether this user may cancel and delete recordings. */
  canManage: boolean;
  onPlay: (item: JellyfinMediaItem) => void;
  session: LiveTvSession;
}

const formatDay = (time: number) =>
  `${new Date(time).toLocaleDateString(getLocaleTag(), {
    day: 'numeric',
    month: 'short',
    weekday: 'short',
  })}, ${formatClockTime(time)}`;

const targetKey = (target: Target) =>
  target.kind === 'recording'
    ? `recording-${target.recording.id}`
    : target.kind === 'scheduled'
    ? `scheduled-${target.scheduled.id}`
    : `series-${target.series.id}`;

/** Card keys in the order the rows show them. */
const cardKeys = (
  recordings: LiveTvRecording[],
  scheduled: ScheduledRecording[],
  series: SeriesRecording[],
) => [
  ...recordings
    .filter((recording) => recording.inProgress)
    .map((recording) => `recording-${recording.id}`),
  ...recordings
    .filter((recording) => !recording.inProgress)
    .map((recording) => `recording-${recording.id}`),
  ...scheduled.map((entry) => `scheduled-${entry.id}`),
  ...series.map((entry) => `series-${entry.id}`),
];

// The card last opened, kept past the view: playing a recording unmounts this
// view, and coming back should land on the same card.
let rememberedTarget: string | undefined;

/**
 * The DVR: what is recording now, what has been recorded, and what is set to
 * record, as rows of cards like the home screen.
 */
export const RecordingsView = ({canManage, onPlay, session}: Props) => {
  const [recordings, setRecordings] = useState<LiveTvRecording[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledRecording[]>([]);
  const [series, setSeries] = useState<SeriesRecording[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const cardRefs = useRef(new Map<string, any>());
  const lastTarget = useRef<string | undefined>(rememberedTarget);
  // Counts finished loads; each one puts focus back on a card.
  const [loaded, setLoaded] = useState(0);

  const load = useCallback(async () => {
    const [recorded, upcoming, rules] = await Promise.allSettled([
      getRecordings(session),
      getScheduledRecordings(session),
      getSeriesRecordings(session),
    ]);

    setRecordings(recorded.status === 'fulfilled' ? recorded.value : []);
    // Users who cannot manage Live TV may be refused the schedule.
    setScheduled(upcoming.status === 'fulfilled' ? upcoming.value : []);
    setSeries(rules.status === 'fulfilled' ? rules.value : []);
    setErrorText(
      recorded.status === 'rejected'
        ? recorded.reason instanceof Error
          ? recorded.reason.message
          : String(recorded.reason)
        : null,
    );
    setLoading(false);

    setLoaded((count) => count + 1);
  }, [session]);

  // Nothing else takes focus once the cards are up: not on opening the view,
  // not on coming back from a recording, not after an action reloads the
  // rows. Land on the card last opened, or the first one. This runs after the
  // rows are committed, so the cards are registered by then.
  useEffect(() => {
    if (!loaded) {
      return undefined;
    }
    const keys = cardKeys(recordings, scheduled, series);
    const key =
      lastTarget.current && keys.includes(lastTarget.current)
        ? lastTarget.current
        : keys[0];
    const timer = setTimeout(() => {
      (key && cardRefs.current.get(key))?.requestTVFocus?.();
    }, 120);
    return () => clearTimeout(timer);
    // Only a finished load moves focus; the rows it set are read as they are.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  useEffect(() => {
    load();
  }, [load]);

  const open = (next: Target) => {
    lastTarget.current = targetKey(next);
    rememberedTarget = lastTarget.current;
    setConfirmingDelete(false);
    setTarget(next);
  };

  const close = useCallback(() => {
    setTarget(null);
    // Focus does not come back to the card on its own.
    setTimeout(() => {
      const key = lastTarget.current;
      (key && cardRefs.current.get(key))?.requestTVFocus?.();
    }, 120);
  }, []);

  const register = (key: string) => (node: any) => {
    if (node) {
      cardRefs.current.set(key, node);
    } else {
      cardRefs.current.delete(key);
    }
  };

  const runAction = async (action: Action) => {
    if (!target) {
      return;
    }

    if (action === 'play' && target.kind === 'recording') {
      setTarget(null);
      onPlay(target.recording.item);
      return;
    }

    if (action === 'delete' && target.kind === 'recording') {
      // A second press confirms; the button keeps focus between the two.
      if (!confirmingDelete) {
        setConfirmingDelete(true);
        return;
      }
      await deleteRecording(session, target.recording.id);
    } else if (action === 'stop' && target.kind === 'recording') {
      if (target.recording.timerId) {
        await cancelRecording(session, target.recording.timerId);
      }
    } else if (action === 'cancel' && target.kind === 'scheduled') {
      await cancelRecording(session, target.scheduled.id);
    } else if (action === 'cancelSeries') {
      const seriesTimerId =
        target.kind === 'series'
          ? target.series.id
          : target.kind === 'scheduled'
          ? target.scheduled.seriesTimerId
          : undefined;
      if (seriesTimerId) {
        await cancelSeriesRecording(session, seriesTimerId);
      }
    }

    // What was acted on is gone, so put focus back at the start.
    lastTarget.current = undefined;
    rememberedTarget = undefined;
    setTarget(null);
    await load();
  };

  const inProgress = recordings.filter((recording) => recording.inProgress);
  const finished = recordings.filter((recording) => !recording.inProgress);

  if (isLoading) {
    return <ActivityIndicator style={styles.spinner} />;
  }

  if (errorText) {
    return <Text style={styles.status}>{errorText}</Text>;
  }

  if (!recordings.length && !scheduled.length && !series.length) {
    return <Text style={styles.status}>{t('liveTv.recordings.empty')}</Text>;
  }

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Row title={t('liveTv.recordings.now')}>
          {inProgress.map((recording) => (
            <Card
              badge={t('liveTv.recordings.rec')}
              focusRef={register(`recording-${recording.id}`)}
              imageUrl={recording.imageUrl}
              key={recording.id}
              lines={[
                recording.episodeTitle ?? recording.channelName,
                recording.startTime && recording.endTime
                  ? `${formatClockTime(
                      recording.startTime,
                    )} – ${formatClockTime(recording.endTime)}`
                  : undefined,
              ]}
              onPress={() => open({kind: 'recording', recording})}
              testID={`recording-${recording.id}`}
              title={recording.name}
            />
          ))}
        </Row>
        <Row title={t('liveTv.recordings.done')}>
          {finished.map((recording) => (
            <Card
              focusRef={register(`recording-${recording.id}`)}
              imageUrl={recording.imageUrl}
              key={recording.id}
              lines={[
                recording.episodeTitle ?? recording.channelName,
                recording.startTime ? formatDay(recording.startTime) : '',
              ]}
              onPress={() => open({kind: 'recording', recording})}
              testID={`recording-${recording.id}`}
              title={recording.name}
            />
          ))}
        </Row>
        <Row title={t('liveTv.recordings.scheduled')}>
          {scheduled.map((entry) => (
            <Card
              focusRef={register(`scheduled-${entry.id}`)}
              imageUrl={entry.imageUrl}
              key={entry.id}
              lines={[
                entry.episodeTitle ?? entry.channelName,
                formatDay(entry.startTime),
              ]}
              onPress={() => open({kind: 'scheduled', scheduled: entry})}
              testID={`scheduled-${entry.id}`}
              title={entry.name}
            />
          ))}
        </Row>
        <Row title={t('liveTv.recordings.series')}>
          {series.map((entry) => (
            <Card
              focusRef={register(`series-${entry.id}`)}
              imageUrl={entry.imageUrl}
              key={entry.id}
              lines={[
                entry.recordNewOnly
                  ? t('liveTv.recordings.newOnly')
                  : t('liveTv.recordings.allEpisodes'),
                entry.recordAnyChannel
                  ? t('liveTv.recordings.anyChannel')
                  : entry.channelName,
              ]}
              onPress={() => open({kind: 'series', series: entry})}
              testID={`series-${entry.id}`}
              title={entry.name}
            />
          ))}
        </Row>
      </ScrollView>
      {target ? (
        <ActionPanel
          actions={panelActions(target, canManage, confirmingDelete)}
          meta={panelMeta(target)}
          onAction={runAction}
          onClose={close}
          overview={
            target.kind === 'recording' ? target.recording.overview : undefined
          }
          testID="recordings-panel"
          title={
            target.kind === 'recording'
              ? target.recording.name
              : target.kind === 'scheduled'
              ? target.scheduled.name
              : target.series.name
          }
        />
      ) : null}
    </View>
  );
};

const panelActions = (
  target: Target,
  canManage: boolean,
  confirmingDelete: boolean,
): PanelAction<Action>[] => {
  const actions: PanelAction<Action>[] = [];

  if (target.kind === 'recording') {
    actions.push({key: 'play', label: t('liveTv.recordings.play')});

    if (canManage && target.recording.inProgress && target.recording.timerId) {
      actions.push({key: 'stop', label: t('liveTv.recordings.stop')});
    }
    if (canManage && !target.recording.inProgress) {
      actions.push({
        key: 'delete',
        label: confirmingDelete
          ? t('liveTv.recordings.confirmDelete')
          : t('liveTv.recordings.delete'),
      });
    }
  } else if (target.kind === 'scheduled') {
    actions.push({key: 'cancel', label: t('liveTv.record.cancel')});

    if (target.scheduled.seriesTimerId) {
      actions.push({
        key: 'cancelSeries',
        label: t('liveTv.record.cancelSeries'),
      });
    }
  } else {
    actions.push({key: 'cancelSeries', label: t('liveTv.record.cancelSeries')});
  }

  return actions;
};

const panelMeta = (target: Target) => {
  if (target.kind === 'recording') {
    const {recording} = target;
    return [
      recording.startTime ? formatDay(recording.startTime) : '',
      recording.episodeTitle ?? '',
      recording.channelName ?? '',
    ]
      .filter(Boolean)
      .join('  ·  ');
  }

  if (target.kind === 'scheduled') {
    const {scheduled} = target;
    return [
      `${formatDay(scheduled.startTime)} – ${formatClockTime(
        scheduled.endTime,
      )}`,
      scheduled.episodeTitle ?? '',
      scheduled.channelName ?? '',
    ]
      .filter(Boolean)
      .join('  ·  ');
  }

  return target.series.channelName;
};

const Row = ({children, title}: {children: React.ReactNode[]; title: string}) =>
  children.length ? (
    <>
      <Text style={styles.rowTitle}>{title}</Text>
      <ScrollView horizontal={true} style={styles.scroller}>
        <TVFocusGuideView style={styles.row}>{children}</TVFocusGuideView>
      </ScrollView>
    </>
  ) : null;

const Card = ({
  badge,
  focusRef,
  imageUrl,
  lines,
  onPress,
  testID,
  title,
}: {
  badge?: string;
  focusRef: (node: any) => void;
  imageUrl?: string;
  lines: Array<string | undefined>;
  onPress: () => void;
  testID: string;
  title: string;
}) => (
  <FocusableItem
    accessibilityLabel={title}
    focusRef={focusRef}
    focusedStyle={styles.focused}
    onPress={onPress}
    style={styles.card}
    testID={testID}>
    <View style={styles.art}>
      <Text numberOfLines={3} style={styles.fallbackText}>
        {title}
      </Text>
      {imageUrl ? (
        <Image source={{uri: imageUrl}} style={styles.image} />
      ) : null}
      {badge ? <Text style={styles.badge}>{`● ${badge}`}</Text> : null}
    </View>
    <View style={styles.caption}>
      <Text numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      {lines.filter(Boolean).map((line) => (
        <Text key={line} numberOfLines={1} style={styles.subtitle}>
          {line}
        </Text>
      ))}
    </View>
  </FocusableItem>
);

const CARD_WIDTH = 240;

const styles = StyleSheet.create({
  root: {flex: 1},
  content: {paddingBottom: 40},
  spinner: {marginTop: 40},
  status: {color: '#c8d2dc', fontSize: 20, marginTop: 40, textAlign: 'center'},
  rowTitle: {
    color: '#FFFFFF',
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 12,
    marginTop: 12,
  },
  scroller: {flexGrow: 0, marginBottom: 18},
  row: {flexDirection: 'row', gap: 24},
  card: {
    backgroundColor: '#24313A',
    borderRadius: 8,
    overflow: 'hidden',
    width: CARD_WIDTH,
  },
  focused: {backgroundColor: '#24313A', transform: [{scale: 1.04}]},
  art: {
    alignItems: 'center',
    backgroundColor: '#182027',
    height: CARD_WIDTH,
    justifyContent: 'center',
    padding: 20,
    width: CARD_WIDTH,
  },
  fallbackText: {
    color: '#8CA1AA',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
  },
  image: {...StyleSheet.absoluteFillObject, resizeMode: 'cover'},
  badge: {
    backgroundColor: '#ff5a5f',
    borderRadius: 4,
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    left: 10,
    overflow: 'hidden',
    paddingHorizontal: 8,
    paddingVertical: 3,
    position: 'absolute',
    top: 10,
  },
  caption: {alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10},
  title: {color: '#FFFFFF', fontSize: 20, fontWeight: '700'},
  subtitle: {color: '#B8C5CC', fontSize: 16, marginTop: 3},
});
