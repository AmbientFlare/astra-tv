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
import {t} from '../../i18n';
import {colors} from '../../theme';

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

  const {durationSeconds, positionSeconds} = status;
  const progress =
    durationSeconds > 0
      ? Math.min(Math.max(positionSeconds / durationSeconds, 0), 1)
      : 0;

  return (
    <FocusableItem
      accessibilityLabel={t('nowPlaying.barLabel', {
        name: status.track?.name ?? '',
        action: status.isPlaying ? t('player.pause') : t('player.play'),
      })}
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
            {status.track?.name ?? t('nowPlaying.nothingPlaying')}
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
              ? t('nowPlaying.error')
              : status.isBuffering
              ? t('nowPlaying.buffering')
              : status.isPlaying
              ? t('nowPlaying.playing')
              : t('nowPlaying.paused')}
          </Text>
          <Text style={styles.time}>
            {formatSeconds(positionSeconds)}
            {durationSeconds > 0 ? ` / ${formatSeconds(durationSeconds)}` : ''}
          </Text>
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
    backgroundColor: colors.surface.sunken,
    borderTopColor: colors.border.subtle,
    borderTopWidth: 1,
    paddingBottom: 8,
  },
  focused: {borderColor: colors.border.focus},
  progressTrack: {
    backgroundColor: colors.fill.trackSolid,
    flexDirection: 'row',
    height: 3,
  },
  progressFill: {backgroundColor: colors.fill.accent},
  row: {alignItems: 'center', flexDirection: 'row', padding: 12},
  art: {
    backgroundColor: colors.surface.raised,
    borderRadius: 6,
    height: 54,
    width: 54,
  },
  artPlaceholder: {opacity: 0.6},
  text: {flex: 1, paddingHorizontal: 14},
  title: {color: colors.text.primary, fontSize: 18, fontWeight: '600'},
  subtitle: {color: colors.text.muted, fontSize: 14, marginTop: 2},
  state: {alignItems: 'flex-end'},
  stateText: {color: colors.text.accent, fontSize: 15, fontWeight: '700'},
  time: {color: colors.text.faint, fontSize: 13, marginTop: 2},
  error: {color: colors.text.error, fontSize: 14, paddingHorizontal: 14},
  diagnostics: {
    color: colors.text.faint,
    fontFamily: 'monospace',
    fontSize: 11,
    paddingHorizontal: 14,
    paddingTop: 2,
  },
});
