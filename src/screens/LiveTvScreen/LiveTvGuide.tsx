/**
 * The Live TV guide grid: channels down the side, time across the top.
 *
 * The grid is one focus target, and the remote moves a cursor through it in
 * code. Rows that each scroll sideways on their own fall out of line with
 * each other on a TV, and native focus picks odd neighbours between cells of
 * different widths. The header above keeps ordinary focus; Up from the first
 * row goes back to it.
 */
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Image, LayoutChangeEvent, StyleSheet, Text, View} from 'react-native';
import {TVFocusGuideView} from '@amazon-devices/react-native-kepler';
import {FocusableItem} from '../../components/FocusableItem';
import {RemoteAction, useRemoteInput} from '../../hooks/useRemoteInput';
import {
  cancelRecording,
  cancelSeriesRecording,
  formatClockTime,
  getGuidePrograms,
  getProgram,
  LiveTvChannel,
  LiveTvProgram,
  LiveTvSession,
  recordProgram,
} from '../../services/jellyfin/liveTv';
import {t} from '../../i18n';
import {RecordAction, RecordPanel} from './RecordPanel';
import {
  cellIndexAt,
  firstVisibleRowFor,
  floorToSlot,
  GUIDE_HORIZON_MS,
  GUIDE_WINDOW_MS,
  GuideCell,
  moveHorizontally,
  rowBlocks,
  rowCells,
  slotMarks,
  windowFor,
} from './guideLayout';

interface Props {
  /** Whether selecting a programme that has not started offers to record it. */
  canRecord?: boolean;
  channels: LiveTvChannel[];
  hasTVPreferredFocus?: boolean;
  /** The channel to start on, such as the one last watched. */
  initialChannelId?: string;
  now: number;
  /** Asks the list for its next page when the cursor nears the end. */
  onNeedMore: () => void;
  onSelectChannel: (channel: LiveTvChannel) => void;
  session: LiveTvSession;
}

const CHANNEL_COLUMN = 220;
const ROW_HEIGHT = 76;
const RULER_HEIGHT = 36;

// Guide data is fetched a block of hours at a time, aligned to the clock so
// the blocks line up whatever time the guide opens.
const TIME_BLOCK_MS = 6 * 60 * 60 * 1000;
const CHANNELS_PER_REQUEST = 20;

// How many rows past the screen to fetch ahead, and how close to the end of
// the loaded channels the cursor gets before the next page is asked for.
const ROW_PREFETCH = 4;
const PAGE_AHEAD_ROWS = 10;

// The key press that moves focus into the grid can reach the grid as well.
// Ignore arrows for a moment after it gains focus so it does not also move.
const FOCUS_SETTLE_MS = 300;

// A block that fails to load is asked for again after each of these waits. A
// server that is briefly unreachable then fills in on its own; one that stays
// down is given up on, and shown as having no guide information.
const RETRY_DELAYS_MS = [4000, 15000];
// A block that was given up on is asked for once more when the viewer moves
// in the guide with it in view this much later.
const GIVEN_UP_RETRY_MS = 60000;

// Guide data is kept only for channels this many rows either side of the
// screen. Further away it is dropped and fetched again on the way back, so a
// long lineup scrolled end to end does not hold every channel's day in memory.
const KEEP_ROWS = 60;

type BlockState =
  | {status: 'loading'; attempts: number}
  | {status: 'done'}
  /** Failed; asked for again once `retryAt` passes. */
  | {status: 'retrying' | 'givenUp'; attempts: number; retryAt: number};

const blockKey = (channelId: string, blockStart: number) =>
  `${channelId}:${blockStart}`;

const channelOfBlock = (key: string) => key.slice(0, key.lastIndexOf(':'));

const mergePrograms = (
  existing: LiveTvProgram[] | undefined,
  incoming: LiveTvProgram[],
) => {
  const byId = new Map(
    (existing ?? []).map((program) => [program.id, program]),
  );
  incoming.forEach((program) => byId.set(program.id, program));

  return [...byId.values()].sort((a, b) => a.startTime - b.startTime);
};

export const LiveTvGuide = ({
  canRecord = false,
  channels,
  hasTVPreferredFocus,
  initialChannelId,
  now,
  onNeedMore,
  onSelectChannel,
  session,
}: Props) => {
  const guideStart = floorToSlot(now);
  const guideEnd = guideStart + GUIDE_HORIZON_MS;

  const [size, setSize] = useState({height: 0, width: 0});
  const [isFocused, setFocused] = useState(false);
  const focusedAt = useRef(0);
  const [cursor, setCursor] = useState(() => ({
    anchor: now,
    firstRow: 0,
    row: Math.max(
      0,
      channels.findIndex((channel) => channel.id === initialChannelId),
    ),
    windowStart: guideStart,
  }));
  const [programs, setPrograms] = useState<Record<string, LiveTvProgram[]>>({});
  // Which channel and time blocks have been asked for, and which answered.
  const blocks = useRef(new Map<string, BlockState>());
  const [, setBlocksVersion] = useState(0);
  // Bumped to fetch the rows on screen again: after a recording change, and
  // when a failed block is due another try.
  const [refreshCount, setRefreshCount] = useState(0);
  const retryTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const timers = retryTimers.current;

    return () => {
      mounted.current = false;
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);
  const [recordTarget, setRecordTarget] = useState<{
    channel: LiveTvChannel;
    program: LiveTvProgram;
  } | null>(null);
  const gridRef = useRef<any>(null);

  const visibleRows = Math.max(
    1,
    Math.floor((size.height - RULER_HEIGHT) / ROW_HEIGHT),
  );
  const gridWidth = Math.max(1, size.width - CHANNEL_COLUMN);
  const pxPerMs = gridWidth / GUIDE_WINDOW_MS;

  // The clock moving on can leave the cursor or window on a past half hour.
  const anchor = Math.max(cursor.anchor, guideStart);
  const windowStart = windowFor(cursor.windowStart, anchor, guideStart);
  const row = Math.min(cursor.row, Math.max(0, channels.length - 1));
  const firstRow = firstVisibleRowFor(cursor.firstRow, row, visibleRows);
  const windowEnd = windowStart + GUIDE_WINDOW_MS;

  // A new filter is a new list: start again at the top, at now.
  const firstChannelId = channels[0]?.id;
  const listStart = useRef(firstChannelId);
  useEffect(() => {
    if (listStart.current === firstChannelId) {
      return;
    }

    listStart.current = firstChannelId;
    setCursor({
      anchor: Date.now(),
      firstRow: 0,
      row: 0,
      windowStart: floorToSlot(Date.now()),
    });
  }, [firstChannelId]);

  const programsFor = useCallback(
    (channel: LiveTvChannel) => {
      const loaded = programs[channel.id];

      if (loaded) {
        return loaded;
      }

      // The channel list already knows now and next; show those until the
      // guide answers.
      return [channel.current, channel.next].filter(
        (program): program is LiveTvProgram => Boolean(program),
      );
    },
    [programs],
  );

  const timeBlocks = useMemo(() => {
    const starts: number[] = [];

    for (
      let start = Math.floor(windowStart / TIME_BLOCK_MS) * TIME_BLOCK_MS;
      start < windowEnd;
      start += TIME_BLOCK_MS
    ) {
      starts.push(start);
    }

    return starts;
  }, [windowEnd, windowStart]);

  // Fetch the guide for the rows on screen and a few past them.
  useEffect(() => {
    const rows = channels.slice(
      Math.max(0, firstRow - ROW_PREFETCH),
      firstRow + visibleRows + ROW_PREFETCH,
    );

    const due = (id: string, blockStart: number) => {
      const state = blocks.current.get(blockKey(id, blockStart));

      return (
        !state ||
        ((state.status === 'retrying' || state.status === 'givenUp') &&
          Date.now() >= state.retryAt)
      );
    };

    timeBlocks.forEach((blockStart) => {
      const missing = rows
        .map((channel) => channel.id)
        .filter((id) => due(id, blockStart));

      for (
        let index = 0;
        index < missing.length;
        index += CHANNELS_PER_REQUEST
      ) {
        const ids = missing.slice(index, index + CHANNELS_PER_REQUEST);
        // Each request is one state object shared by its channels, so a
        // block that was dropped or asked for again in the meantime is told
        // apart from this one when the answer comes.
        const loading: BlockState = {
          status: 'loading',
          attempts: Math.max(
            ...ids.map((id) => {
              const state = blocks.current.get(blockKey(id, blockStart));
              return state && 'attempts' in state ? state.attempts : 0;
            }),
          ),
        };
        ids.forEach((id) =>
          blocks.current.set(blockKey(id, blockStart), loading),
        );
        const settle = (state: BlockState) => {
          ids.forEach((id) => {
            const key = blockKey(id, blockStart);
            if (blocks.current.get(key) === loading) {
              blocks.current.set(key, state);
            }
          });
        };

        getGuidePrograms(session, ids, blockStart, blockStart + TIME_BLOCK_MS)
          .then((result) => {
            if (!mounted.current) {
              return;
            }
            // Channels dropped for being far off screen stay dropped.
            const wanted = ids.filter(
              (id) => blocks.current.get(blockKey(id, blockStart)) === loading,
            );
            settle({status: 'done'});
            setPrograms((existing) => {
              const next = {...existing};
              wanted.forEach((id) => {
                next[id] = mergePrograms(existing[id], result[id] ?? []);
              });
              return next;
            });
          })
          .catch((error) => {
            console.warn('[Astra] Unable to load the guide:', error);
            if (!mounted.current) {
              return;
            }
            const attempts = loading.attempts + 1;
            const delay = RETRY_DELAYS_MS[attempts - 1];

            if (delay === undefined) {
              // Shown as no guide information rather than retried in a loop.
              settle({
                status: 'givenUp',
                attempts,
                retryAt: Date.now() + GIVEN_UP_RETRY_MS,
              });
              return;
            }

            settle({status: 'retrying', attempts, retryAt: Date.now() + delay});
            const timer = setTimeout(() => {
              retryTimers.current.delete(timer);
              setRefreshCount((count) => count + 1);
            }, delay);
            retryTimers.current.add(timer);
          })
          .finally(() => {
            if (mounted.current) {
              setBlocksVersion((version) => version + 1);
            }
          });
      }
    });
  }, [channels, firstRow, refreshCount, session, timeBlocks, visibleRows]);

  // Drop the guide for channels far from the screen.
  useEffect(() => {
    const keep = new Set(
      channels
        .slice(
          Math.max(0, firstRow - KEEP_ROWS),
          firstRow + visibleRows + KEEP_ROWS,
        )
        .map((channel) => channel.id),
    );

    blocks.current.forEach((_state, key) => {
      if (!keep.has(channelOfBlock(key))) {
        blocks.current.delete(key);
      }
    });
    setPrograms((existing) => {
      const ids = Object.keys(existing);

      if (ids.every((id) => keep.has(id))) {
        return existing;
      }

      const next: Record<string, LiveTvProgram[]> = {};
      ids.forEach((id) => {
        if (keep.has(id)) {
          next[id] = existing[id];
        }
      });
      return next;
    });
  }, [channels, firstRow, visibleRows]);

  useEffect(() => {
    if (channels.length && row >= channels.length - PAGE_AHEAD_ROWS) {
      onNeedMore();
    }
  }, [channels.length, onNeedMore, row]);

  const cellsFor = useCallback(
    (channel: LiveTvChannel) =>
      rowCells(programsFor(channel), guideStart, guideEnd),
    [guideEnd, guideStart, programsFor],
  );

  const move = useCallback(
    (action: RemoteAction) => {
      const channel = channels[row];

      if (!channel) {
        return;
      }

      const next = {anchor, firstRow, row, windowStart};

      switch (action) {
        case 'up':
          next.row = Math.max(0, row - 1);
          break;
        case 'down':
          next.row = Math.min(channels.length - 1, row + 1);
          break;
        case 'left':
        case 'right':
          next.anchor = moveHorizontally(
            cellsFor(channel),
            anchor,
            action === 'right' ? 1 : -1,
            guideStart,
          );
          next.windowStart = windowFor(windowStart, next.anchor, guideStart);
          break;
        default:
          return;
      }

      next.firstRow = firstVisibleRowFor(firstRow, next.row, visibleRows);
      setCursor(next);
    },
    [
      anchor,
      cellsFor,
      channels,
      firstRow,
      guideStart,
      row,
      visibleRows,
      windowStart,
    ],
  );

  useRemoteInput(
    (action) => {
      if (Date.now() - focusedAt.current < FOCUS_SETTLE_MS) {
        return;
      }

      move(action);
    },
    {allowWhileDisabled: [], enabled: isFocused && !recordTarget},
  );

  const closeRecordPanel = useCallback(() => {
    setRecordTarget(null);
    // Focus does not come back to the grid on its own.
    setTimeout(() => gridRef.current?.requestTVFocus?.(), 120);
  }, []);

  const runRecordAction = useCallback(
    async (action: RecordAction) => {
      if (!recordTarget) {
        return;
      }

      const {channel, program} = recordTarget;

      if (action === 'watch') {
        setRecordTarget(null);
        onSelectChannel(channel);
        return;
      }

      if (action === 'record' || action === 'recordSeries') {
        await recordProgram(session, program.id, action === 'recordSeries');
      } else if (action === 'cancel' && program.timerId) {
        await cancelRecording(session, program.timerId);
      } else if (action === 'cancelSeries' && program.seriesTimerId) {
        await cancelSeriesRecording(session, program.seriesTimerId);
      }

      const updated = await getProgram(session, program.id).catch(
        () => undefined,
      );

      if (updated) {
        setPrograms((existing) =>
          existing[channel.id]
            ? {
                ...existing,
                [channel.id]: mergePrograms(existing[channel.id], [updated]),
              }
            : existing,
        );
      }

      // A series change reaches its other airings too, so fetch again.
      blocks.current.clear();
      setRefreshCount((count) => count + 1);
      closeRecordPanel();
    },
    [closeRecordPanel, onSelectChannel, recordTarget, session],
  );

  const focusedChannel = channels[row];
  const focusedCells = focusedChannel ? cellsFor(focusedChannel) : [];
  const focusedCell = focusedCells[cellIndexAt(focusedCells, anchor)];

  const onLayout = (event: LayoutChangeEvent) => {
    const {height, width} = event.nativeEvent.layout;
    setSize({height, width});
  };

  // A block that was given up on counts as loaded: there is nothing more
  // coming for it, so the row says it has no guide information.
  const isRowLoaded = (channelId: string) =>
    timeBlocks.every((blockStart) => {
      const status = blocks.current.get(
        blockKey(channelId, blockStart),
      )?.status;

      return status === 'done' || status === 'givenUp';
    });

  const nowX = (now - windowStart) * pxPerMs;

  return (
    <View style={styles.root}>
      <ProgramDetails
        cell={focusedCell}
        channel={focusedChannel}
        loaded={focusedChannel ? isRowLoaded(focusedChannel.id) : false}
      />
      <TVFocusGuideView
        style={styles.gridArea}
        trapFocusDown
        trapFocusLeft
        trapFocusRight
        trapFocusUp={row > 0}>
        <FocusableItem
          focusedStyle={styles.gridFocused}
          hasTVPreferredFocus={hasTVPreferredFocus}
          onBlur={() => setFocused(false)}
          onFocus={() => {
            focusedAt.current = Date.now();
            setFocused(true);
          }}
          focusRef={gridRef}
          onPress={() => {
            const program = focusedCell?.program;

            if (!focusedChannel) {
              return;
            }

            if (canRecord && program && program.startTime > Date.now()) {
              setRecordTarget({channel: focusedChannel, program});
            } else {
              onSelectChannel(focusedChannel);
            }
          }}
          style={styles.grid}
          testID="livetv-guide">
          <View onLayout={onLayout} style={styles.gridInner}>
            <View style={styles.ruler}>
              {slotMarks(windowStart).map((mark) => (
                <Text
                  key={mark}
                  numberOfLines={1}
                  style={[
                    styles.rulerText,
                    {left: CHANNEL_COLUMN + (mark - windowStart) * pxPerMs},
                  ]}>
                  {formatClockTime(mark)}
                </Text>
              ))}
            </View>
            {channels
              .slice(firstRow, firstRow + visibleRows)
              .map((channel, index) => {
                const rowIndex = firstRow + index;
                const cells = cellsFor(channel);
                const focusedIndex =
                  isFocused && rowIndex === row
                    ? cellIndexAt(cells, anchor)
                    : -1;
                const loaded = isRowLoaded(channel.id);
                const span = (range: {start: number; end: number}) => ({
                  left:
                    (Math.max(range.start, windowStart) - windowStart) *
                    pxPerMs,
                  width:
                    (Math.min(range.end, windowEnd) -
                      Math.max(range.start, windowStart)) *
                    pxPerMs,
                });

                return (
                  <View
                    key={channel.id}
                    style={styles.row}
                    testID={`livetv-guide-row-${channel.id}`}>
                    <ChannelLabel
                      channel={channel}
                      isCurrent={rowIndex === row}
                    />
                    <View style={styles.cells}>
                      {rowBlocks(cells).map((block) => {
                        if (
                          block.end <= windowStart ||
                          block.start >= windowEnd
                        ) {
                          return null;
                        }

                        const cursorCell = cells[focusedIndex];
                        const focusedHere =
                          focusedIndex >= 0 &&
                          cursorCell.start < block.end &&
                          block.start < cursorCell.end;

                        return (
                          <GuideCellView
                            clippedStart={
                              (block.program?.startTime ?? block.start) <
                              windowStart
                            }
                            emptyText={loaded ? channel.name : ''}
                            isFocused={focusedHere && Boolean(block.program)}
                            isOnNow={block.start <= now && now < block.end}
                            key={`${block.start}`}
                            program={block.program}
                            {...span(block)}
                          />
                        );
                      })}
                      {/* An empty stretch is one bar; the half hour the
                          cursor is on is lit on top of it. */}
                      {focusedIndex >= 0 &&
                      !cells[focusedIndex].program &&
                      cells[focusedIndex].end > windowStart &&
                      cells[focusedIndex].start < windowEnd ? (
                        <GuideCellView
                          clippedStart={false}
                          emptyText={loaded ? channel.name : ''}
                          isFocused
                          isOnNow={false}
                          {...span(cells[focusedIndex])}
                        />
                      ) : null}
                    </View>
                  </View>
                );
              })}
            {nowX >= 0 && nowX <= gridWidth ? (
              <View
                pointerEvents="none"
                style={[styles.nowLine, {left: CHANNEL_COLUMN + nowX}]}
              />
            ) : null}
          </View>
        </FocusableItem>
      </TVFocusGuideView>
      {recordTarget ? (
        <RecordPanel
          channel={recordTarget.channel}
          onAction={runRecordAction}
          onClose={closeRecordPanel}
          program={recordTarget.program}
        />
      ) : null}
    </View>
  );
};

const isRecording = (program?: LiveTvProgram) =>
  Boolean(program?.timerId || program?.seriesTimerId);

const ProgramDetails = ({
  cell,
  channel,
  loaded,
}: {
  cell?: GuideCell;
  channel?: LiveTvChannel;
  loaded: boolean;
}) => {
  const program = cell?.program;

  return (
    <View style={styles.details} testID="livetv-guide-details">
      <Text numberOfLines={1} style={styles.detailsTitle}>
        {isRecording(program) ? <Text style={styles.recDot}>● </Text> : null}
        {program ? program.name : channel?.name ?? ''}
      </Text>
      <Text numberOfLines={1} style={styles.detailsMeta}>
        {[
          program
            ? `${formatClockTime(program.startTime)} – ${formatClockTime(
                program.endTime,
              )}`
            : '',
          program?.episodeTitle ?? '',
          !program && loaded ? t('liveTv.noGuide') : '',
          channel
            ? [channel.number, channel.name].filter(Boolean).join(' ')
            : '',
        ]
          .filter(Boolean)
          .join('  ·  ')}
      </Text>
      <Text numberOfLines={2} style={styles.detailsOverview}>
        {program?.overview ?? ''}
      </Text>
    </View>
  );
};

const ChannelLabel = ({
  channel,
  isCurrent,
}: {
  channel: LiveTvChannel;
  isCurrent: boolean;
}) => {
  // A server can advertise a logo it then fails to serve; show the name then.
  const [logoFailed, setLogoFailed] = useState(false);
  useEffect(() => setLogoFailed(false), [channel.imageUrl]);

  return (
    <View style={[styles.channel, isCurrent && styles.channelCurrent]}>
      <Text numberOfLines={1} style={styles.channelNumber}>
        {channel.number ?? ''}
      </Text>
      {channel.imageUrl && !logoFailed ? (
        <Image
          onError={() => setLogoFailed(true)}
          resizeMode="contain"
          source={{uri: channel.imageUrl}}
          style={styles.channelLogo}
        />
      ) : (
        <Text numberOfLines={2} style={styles.channelName}>
          {channel.name}
        </Text>
      )}
    </View>
  );
};

const GuideCellView = ({
  clippedStart,
  emptyText,
  isFocused,
  isOnNow,
  left,
  program,
  width,
}: {
  clippedStart: boolean;
  /** What a stretch without guide data says: the channel's own name. */
  emptyText: string;
  isFocused: boolean;
  isOnNow: boolean;
  left: number;
  program?: LiveTvProgram;
  width: number;
}) => (
  <View
    style={[
      styles.cell,
      isOnNow && styles.cellOnNow,
      !program && styles.cellEmpty,
      isFocused && styles.cellFocused,
      {left, width},
    ]}>
    <Text
      numberOfLines={1}
      style={[
        styles.cellTitle,
        !program && styles.cellEmptyText,
        isFocused && styles.cellTitleFocused,
      ]}>
      {isRecording(program) ? <Text style={styles.recDot}>● </Text> : null}
      {program ? `${clippedStart ? '‹ ' : ''}${program.name}` : emptyText}
    </Text>
    {program?.episodeTitle ? (
      <Text
        numberOfLines={1}
        style={[styles.cellSub, isFocused && styles.cellTitleFocused]}>
        {program.episodeTitle}
      </Text>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  root: {flex: 1},
  details: {height: 118, justifyContent: 'flex-start', paddingBottom: 8},
  detailsTitle: {color: '#f4f6f8', fontSize: 26, fontWeight: '700'},
  detailsMeta: {color: '#8b97a5', fontSize: 16, marginTop: 4},
  detailsOverview: {color: '#c8d2dc', fontSize: 16, marginTop: 6},
  gridArea: {flex: 1},
  grid: {borderRadius: 10, flex: 1},
  gridFocused: {borderColor: 'transparent'},
  gridInner: {flex: 1, overflow: 'hidden'},
  ruler: {height: RULER_HEIGHT},
  rulerText: {
    color: '#8b97a5',
    fontSize: 15,
    position: 'absolute',
    top: 8,
  },
  row: {flexDirection: 'row', height: ROW_HEIGHT},
  channel: {
    alignItems: 'center',
    backgroundColor: '#12161c',
    borderRadius: 8,
    flexDirection: 'row',
    marginBottom: 4,
    marginRight: 4,
    paddingHorizontal: 10,
    width: CHANNEL_COLUMN - 4,
  },
  channelCurrent: {backgroundColor: '#1d2530'},
  channelNumber: {
    color: '#8b97a5',
    fontSize: 16,
    fontWeight: '600',
    width: 52,
  },
  channelLogo: {flex: 1, height: 48},
  channelName: {color: '#c8d2dc', flex: 1, fontSize: 15},
  cells: {flex: 1},
  cell: {
    backgroundColor: '#12161c',
    borderColor: '#0b0d10',
    borderRadius: 6,
    borderWidth: 2,
    bottom: 4,
    justifyContent: 'center',
    paddingHorizontal: 10,
    position: 'absolute',
    top: 0,
  },
  cellOnNow: {backgroundColor: '#1f3a2c', borderColor: '#2c5a40'},
  cellEmpty: {backgroundColor: '#0f1217'},
  cellFocused: {backgroundColor: '#54d38a', borderColor: '#54d38a'},
  cellTitle: {color: '#f4f6f8', fontSize: 17, fontWeight: '600'},
  cellSub: {color: '#8b97a5', fontSize: 14, marginTop: 2},
  cellTitleFocused: {color: '#0b0d10'},
  cellEmptyText: {color: '#6f7d8c', fontWeight: '400'},
  recDot: {color: '#ff5a5f'},
  nowLine: {
    backgroundColor: '#ff5a5f',
    bottom: 0,
    position: 'absolute',
    top: RULER_HEIGHT - 4,
    width: 2,
  },
});
