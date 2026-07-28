/**
 * Docked now-playing bar.
 *
 * Sits at the bottom of every music screen rather than taking over the display,
 * matching how Jellyfin's client behaves and leaving browsing uninterrupted.
 *
 * It also carries a diagnostics line. Vega does not surface the app's JS
 * console anywhere retrievable from the host — `vega device copy-logs` returns
 * system logs only — so when playback misbehaves, the screen is the only place
 * the reason can appear. Keep the diagnostics until music playback has been
 * stable on hardware for a while.
 */
import React, {useEffect, useState} from 'react';
import {Image, StyleSheet, Text, View} from 'react-native';
import {audioPlayback, PlaybackStatus} from '../../services/audioPlayer';
import {formatSeconds} from '../../utils/duration';
import {FocusableItem} from '../FocusableItem';

interface NowPlayingBarProps {
  /** Shows the stream URL and player readyState. */
  showDiagnostics?: boolean;
  onOpen?: () => void;
}

const READY_STATE_LABEL: Record<number, string> = {
  0: 'NOTHING',
  1: 'METADATA',
  2: 'CURRENT',
  3: 'FUTURE',
  4: 'ENOUGH',
};

export const NowPlayingBar = ({
  onOpen,
  showDiagnostics = false,
}: NowPlayingBarProps) => {
  const [status, setStatus] = useState<PlaybackStatus>(
    audioPlayback.getStatus(),
  );

  useEffect(() => audioPlayback.subscribe(setStatus), []);

  if (!status.track && !status.lastError) {
    return null;
  }

  const {durationSeconds, positionSeconds, queue} = status;
  const progress =
    durationSeconds > 0
      ? Math.min(Math.max(positionSeconds / durationSeconds, 0), 1)
      : 0;

  return (
    <FocusableItem
      accessibilityLabel={`Now playing ${status.track?.name ?? ''}. ${
        status.isPlaying ? 'Pause' : 'Play'
      }`}
      focusedStyle={styles.focused}
      onPress={onOpen ?? (() => audioPlayback.togglePlayPause())}
      style={styles.bar}
      testID="now-playing-bar">
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, {flex: progress}]} />
        <View style={{flex: 1 - progress}} />
      </View>

      <View style={styles.row}>
        {status.track?.imageUrl ? (
          <Image source={{uri: status.track.imageUrl}} style={styles.art} />
        ) : (
          <View style={[styles.art, styles.artPlaceholder]} />
        )}

        <View style={styles.text}>
          <Text numberOfLines={1} style={styles.title}>
            {status.track?.name ?? 'Nothing playing'}
          </Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            {[status.track?.artistName, status.track?.albumName]
              .filter(Boolean)
              .join('  ·  ')}
          </Text>
        </View>

        <View style={styles.state}>
          <Text style={styles.stateText}>
            {status.lastError
              ? 'ERROR'
              : status.isBuffering
              ? 'Buffering'
              : status.isPlaying
              ? 'Playing'
              : 'Paused'}
          </Text>
          <Text style={styles.time}>
            {formatSeconds(positionSeconds)}
            {durationSeconds > 0 ? ` / ${formatSeconds(durationSeconds)}` : ''}
          </Text>
          {queue.tracks.length ? (
            <Text style={styles.time}>
              {queue.cursor + 1} of {queue.order.length}
              {queue.shuffle ? '  shuffle' : ''}
              {queue.repeat !== 'off' ? `  repeat ${queue.repeat}` : ''}
            </Text>
          ) : null}
        </View>
      </View>

      {status.lastError ? (
        <Text style={styles.error}>{status.lastError}</Text>
      ) : null}

      {showDiagnostics ? (
        <Text numberOfLines={2} style={styles.diagnostics}>
          ready={READY_STATE_LABEL[status.readyState] ?? status.readyState}
          {'  '}
          {status.lastStreamUrl ?? 'no stream url'}
        </Text>
      ) : null}
    </FocusableItem>
  );
};

const styles = StyleSheet.create({
  bar: {
    backgroundColor: '#12171d',
    borderTopColor: '#232c36',
    borderTopWidth: 1,
    paddingBottom: 8,
  },
  focused: {borderColor: '#54d38a'},
  progressTrack: {backgroundColor: '#232c36', flexDirection: 'row', height: 3},
  progressFill: {backgroundColor: '#54d38a'},
  row: {alignItems: 'center', flexDirection: 'row', padding: 12},
  art: {backgroundColor: '#1d2530', borderRadius: 6, height: 54, width: 54},
  artPlaceholder: {opacity: 0.6},
  text: {flex: 1, paddingHorizontal: 14},
  title: {color: '#f4f6f8', fontSize: 18, fontWeight: '600'},
  subtitle: {color: '#8b97a5', fontSize: 14, marginTop: 2},
  state: {alignItems: 'flex-end'},
  stateText: {color: '#54d38a', fontSize: 15, fontWeight: '700'},
  time: {color: '#6f7d8c', fontSize: 13, marginTop: 2},
  error: {color: '#ff8a80', fontSize: 14, paddingHorizontal: 14},
  diagnostics: {
    color: '#4d5a67',
    fontFamily: 'monospace',
    fontSize: 11,
    paddingHorizontal: 14,
    paddingTop: 2,
  },
});
