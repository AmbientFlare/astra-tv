import React from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import {FocusableItem} from '../../components/FocusableItem';
import type {
  JellyfinMediaTrack,
  JellyfinStreamInfo,
} from '../../services/jellyfin';
import {SLEEP_TIMER_MINUTES, SleepTimerChoice} from '../../services/sleepTimer';
import {t} from '../../i18n';

// Only track selection lives in-player; quality/speed/chapters were removed
// deliberately — chapters ride the FF/RW keys, and quality is meant to be
// configured outside the playback window.
export const PlaybackSettingsOverlay = ({
  isEpisode = false,
  onSelectAudio,
  onSelectSleepTimer,
  onSelectSubtitle,
  onToggleStats,
  selectedAudioIndex,
  selectedSubtitleIndex,
  showStats,
  showTraces,
  sleepMinutesLeft,
  sleepTimer = null,
  onToggleTraces,
  streamInfo,
}: {
  isEpisode?: boolean;
  onSelectAudio: (track: JellyfinMediaTrack) => void;
  onSelectSleepTimer?: (choice: SleepTimerChoice) => void;
  onSelectSubtitle: (track: JellyfinMediaTrack | null) => void;
  onToggleStats: () => void;
  selectedAudioIndex?: number;
  selectedSubtitleIndex?: number;
  showStats: boolean;
  showTraces: boolean;
  sleepMinutesLeft?: number;
  sleepTimer?: SleepTimerChoice;
  onToggleTraces: () => void;
  streamInfo: JellyfinStreamInfo;
}) => (
  <View style={styles.settingsOverlay} testID="player-settings-overlay">
    <Text style={styles.settingsTitle}>{t('player.options')}</Text>
    <Text style={styles.settingsStreamInfo}>
      {[
        streamInfo.width && streamInfo.height
          ? `${streamInfo.width}x${streamInfo.height}`
          : undefined,
        streamInfo.bitrate
          ? `${(streamInfo.bitrate / 1000000).toFixed(1)} Mbps`
          : undefined,
        streamInfo.playMethod,
      ]
        .filter(Boolean)
        .join('  •  ')}
    </Text>
    <View style={styles.settingsGrid}>
      <SettingsColumn title={t('media.audio')}>
        {streamInfo.audioTracks.length ? (
          streamInfo.audioTracks.map((track) => (
            <SettingsButton
              key={track.id}
              label={track.title}
              onPress={() => onSelectAudio(track)}
              selected={track.index === selectedAudioIndex}
            />
          ))
        ) : (
          <Text style={styles.settingsEmpty}>{t('player.defaultAudio')}</Text>
        )}
      </SettingsColumn>
      <SettingsColumn title={t('player.subtitles')}>
        <SettingsButton
          label={t('player.off')}
          onPress={() => onSelectSubtitle(null)}
          selected={selectedSubtitleIndex === undefined}
        />
        {streamInfo.subtitleTracks.map((track) => (
          <SettingsButton
            key={track.id}
            // A release with twenty tracks mixes formats Astra draws itself
            // with picture-based ones the server has to paint into the video.
            // Those cost very different things to pick, and nothing in the
            // track title says which is which, so the badge does.
            badge={
              track.burnInRequired
                ? {label: t('player.reloads'), tone: 'reload'}
                : {label: t('player.instant'), tone: 'instant'}
            }
            label={track.title}
            onPress={() => onSelectSubtitle(track)}
            selected={track.index === selectedSubtitleIndex}
          />
        ))}
        <Text style={styles.settingsHint}>{t('player.subtitleBadgeHint')}</Text>
      </SettingsColumn>
      {onSelectSleepTimer ? (
        <SettingsColumn title={t('player.sleepTimer')}>
          <SettingsButton
            label={t('player.off')}
            onPress={() => onSelectSleepTimer(null)}
            selected={sleepTimer === null}
          />
          {SLEEP_TIMER_MINUTES.map((minutes) => (
            <SettingsButton
              key={minutes}
              label={t('player.sleepMinutes', {minutes})}
              onPress={() => onSelectSleepTimer(minutes)}
              selected={sleepTimer === minutes}
            />
          ))}
          <SettingsButton
            label={
              isEpisode
                ? t('player.sleepEndOfEpisode')
                : t('player.sleepEndOfVideo')
            }
            onPress={() => onSelectSleepTimer('endOfItem')}
            selected={sleepTimer === 'endOfItem'}
          />
          <Text style={styles.settingsHint}>
            {sleepMinutesLeft !== undefined
              ? t('player.sleepPausesIn', {minutes: sleepMinutesLeft})
              : sleepTimer === 'endOfItem'
              ? t('player.sleepPausesAtEnd')
              : t('player.sleepHint')}
          </Text>
        </SettingsColumn>
      ) : null}
      <SettingsColumn title={t('player.diagnostics')}>
        <SettingsButton
          label={`${t('settings.statsForNerds')}: ${
            showStats ? t('player.on') : t('player.off')
          }`}
          onPress={onToggleStats}
          selected={showStats}
        />
        <SettingsButton
          label={`${t('settings.statsWithLogs')}: ${
            showTraces ? t('player.on') : t('player.off')
          }`}
          onPress={onToggleTraces}
          selected={showTraces}
        />
        <Text style={styles.settingsHint}>{t('player.diagnosticsHint')}</Text>
      </SettingsColumn>
    </View>
  </View>
);

const SettingsColumn = ({
  children,
  title,
}: React.PropsWithChildren<{title: string}>) => (
  <View style={styles.settingsColumn}>
    <Text style={styles.settingsHeading}>{title}</Text>
    <ScrollView
      showsVerticalScrollIndicator={true}
      style={styles.settingsColumnScroller}>
      {children}
    </ScrollView>
  </View>
);

const SettingsButton = ({
  badge,
  label,
  onPress,
  selected = false,
}: {
  badge?: {label: string; tone: 'instant' | 'reload'};
  label: string;
  onPress: () => void;
  selected?: boolean;
}) => (
  <FocusableItem
    focusedStyle={styles.settingsButtonFocused}
    onPress={onPress}
    style={[styles.settingsButton, selected && styles.settingsButtonSelected]}>
    <View style={[styles.radioCircle, selected && styles.radioCircleSelected]}>
      {selected ? <View style={styles.radioDot} /> : null}
    </View>
    <Text numberOfLines={1} style={styles.settingsButtonText}>
      {label}
    </Text>
    {badge ? (
      <Text
        style={[
          styles.settingsButtonBadge,
          badge.tone === 'instant'
            ? styles.settingsButtonBadgeInstant
            : styles.settingsButtonBadgeReload,
        ]}>
        {badge.label}
      </Text>
    ) : null}
  </FocusableItem>
);

const styles = StyleSheet.create({
  settingsOverlay: {
    position: 'absolute',
    top: 44,
    left: 52,
    right: 52,
    maxHeight: 670,
    borderRadius: 8,
    backgroundColor: 'rgba(12,17,22,0.94)',
    padding: 24,
  },
  settingsTitle: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '800',
    marginBottom: 4,
  },
  settingsStreamInfo: {
    color: '#8FE3C0',
    fontSize: 22,
    marginBottom: 16,
  },
  settingsGrid: {
    flexDirection: 'row',
    gap: 18,
  },
  settingsColumn: {
    flex: 1,
    marginBottom: 18,
  },
  settingsColumnScroller: {
    maxHeight: 550,
  },
  settingsHeading: {
    color: '#89CFF0',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
  },
  settingsButton: {
    alignItems: 'center',
    borderRadius: 8,
    backgroundColor: '#25313A',
    flexDirection: 'row',
    minHeight: 44,
    marginBottom: 8,
    paddingHorizontal: 12,
  },
  settingsButtonSelected: {
    backgroundColor: '#1F3746',
  },
  settingsButtonFocused: {
    backgroundColor: '#2E5A72',
  },
  settingsButtonText: {
    color: '#FFFFFF',
    flexShrink: 1,
    fontSize: 18,
    fontWeight: '700',
  },
  settingsButtonBadge: {
    borderRadius: 4,
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 'auto',
    overflow: 'hidden',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  settingsButtonBadgeInstant: {
    backgroundColor: '#1F5133',
    color: '#7BE49B',
  },
  settingsButtonBadgeReload: {
    backgroundColor: '#5A2A20',
    color: '#FF9E80',
  },
  radioCircle: {
    alignItems: 'center',
    borderColor: '#8CA1AA',
    borderRadius: 9,
    borderWidth: 2,
    height: 18,
    justifyContent: 'center',
    marginRight: 9,
    width: 18,
  },
  radioCircleSelected: {
    borderColor: '#4CC9F0',
  },
  radioDot: {
    backgroundColor: '#4CC9F0',
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  settingsEmpty: {
    color: '#B8C5CC',
    fontSize: 18,
  },
  settingsHint: {
    color: '#B8C5CC',
    fontSize: 16,
    lineHeight: 22,
  },
});
