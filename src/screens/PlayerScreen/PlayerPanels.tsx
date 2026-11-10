import React from 'react';
import {ActivityIndicator, Text, View} from 'react-native';

import {FocusableItem} from '../../components/FocusableItem';
import {t} from '../../i18n';
import type {JellyfinMediaItem} from '../../services/jellyfin';
import {formatDiagnosticTime} from './formatDiagnostics';
import {episodeLabel} from './playbackPolicy';
import {styles} from './styles';
import type {EndPrompt} from './types';

/**
 * The panels the player draws over the video. Each one only displays what it
 * is given and reports presses; none of them touches playback.
 */

export const SleepNotice = () => (
  <View style={styles.sleepNotice} testID="player-sleep-notice">
    <Text style={styles.settingsTitle}>{t('player.sleepEnded')}</Text>
    <Text style={styles.startupText}>{t('player.sleepResume')}</Text>
  </View>
);

interface StartupPanelProps {
  /** Why playback could not start, or null while it is still starting. */
  error: string | null;
  itemType?: string;
  onBack: () => void;
  onRetry: () => void;
  title: string;
}

export const StartupPanel = ({
  error,
  itemType,
  onBack,
  onRetry,
  title,
}: StartupPanelProps) => (
  <View style={styles.startupOverlay} testID="player-startup-state">
    <Text numberOfLines={1} style={styles.startupTitle}>
      {title}
    </Text>
    {error === null ? (
      <View style={styles.startupRow}>
        <ActivityIndicator color="#4CC9F0" size="large" />
        <Text style={styles.startupText}>{t('player.startingPlayback')}</Text>
      </View>
    ) : (
      <>
        <Text style={styles.startupText}>
          {itemType === 'Episode'
            ? t('player.couldNotStartEpisode')
            : itemType === 'Movie'
            ? t('player.couldNotStartMovie')
            : t('player.couldNotStartItem')}
        </Text>
        <Text style={styles.startupDetail}>{error}</Text>
        <View style={styles.startupButtons}>
          <FocusableItem
            focusedStyle={styles.focusedButton}
            hasTVPreferredFocus={true}
            onPress={onRetry}
            style={styles.button}
            testID="player-startup-retry">
            <Text style={styles.buttonText}>{t('common.retry')}</Text>
          </FocusableItem>
          <FocusableItem
            focusedStyle={styles.focusedButton}
            onPress={onBack}
            style={styles.button}
            testID="player-startup-back">
            <Text style={styles.buttonText}>{t('common.back')}</Text>
          </FocusableItem>
        </View>
      </>
    )}
  </View>
);

interface ControlsBarProps {
  durationSeconds: number;
  positionSeconds: number;
  seekInProgress: boolean;
  /** Where a seek in progress would land, or null when none is pending. */
  seekPreview: number | null;
  seekStepSeconds: number;
  statusText: string;
  title: string;
}

export const ControlsBar = ({
  durationSeconds,
  positionSeconds,
  seekInProgress,
  seekPreview,
  seekStepSeconds,
  statusText,
  title,
}: ControlsBarProps) => {
  const progressWidth = (
    durationSeconds > 0
      ? `${Math.min(
          100,
          Math.max(
            0,
            ((seekPreview ?? positionSeconds) / durationSeconds) * 100,
          ),
        )}%`
      : '0%'
  ) as `${number}%`;
  return (
    <View style={styles.overlay} testID="player-controls-overlay">
      <Text numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      <Text style={styles.status} testID="player-seek-preview">
        {seekPreview === null
          ? statusText
          : `${formatDiagnosticTime(seekPreview)} / ${formatDiagnosticTime(
              durationSeconds,
            )}${
              seekInProgress
                ? `  •  ${t('player.seeking')}`
                : `  •  ${t('player.seekHint', {seconds: seekStepSeconds})}`
            }`}
      </Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, {width: progressWidth}]} />
      </View>
    </View>
  );
};

interface ExitConfirmProps {
  onLeave: () => void;
  onStay: () => void;
}

export const ExitConfirm = ({onLeave, onStay}: ExitConfirmProps) => (
  <View style={styles.exitOverlay} testID="player-exit-confirm">
    <Text style={styles.exitTitle}>{t('player.stopConfirm')}</Text>
    <View style={styles.exitButtons}>
      <FocusableItem
        focusedStyle={styles.focusedButton}
        hasTVPreferredFocus={true}
        onPress={onStay}
        style={styles.button}
        testID="player-exit-stay">
        <Text style={styles.buttonText}>{t('player.stay')}</Text>
      </FocusableItem>
      <FocusableItem
        focusedStyle={styles.focusedButton}
        onPress={onLeave}
        style={styles.button}
        testID="player-exit-leave">
        <Text style={styles.buttonText}>{t('player.leave')}</Text>
      </FocusableItem>
    </View>
  </View>
);

interface CreditsPromptProps {
  /** Absent when there is no next episode to offer. */
  onNextEpisode?: () => void;
  onSkip: () => void;
}

export const CreditsPrompt = ({onNextEpisode, onSkip}: CreditsPromptProps) => (
  <View style={styles.promptCard} testID="player-credits-prompt">
    <Text style={styles.promptTitle}>{t('player.credits')}</Text>
    <View style={styles.exitButtons}>
      <FocusableItem
        focusedStyle={styles.focusedButton}
        hasTVPreferredFocus={true}
        onPress={onSkip}
        style={styles.button}
        testID="player-skip-credits">
        <Text style={styles.buttonText}>{t('player.skipCredits')}</Text>
      </FocusableItem>
      {onNextEpisode ? (
        <FocusableItem
          focusedStyle={styles.focusedButton}
          onPress={onNextEpisode}
          style={styles.button}
          testID="player-next-episode">
          <Text style={styles.buttonText}>{t('detail.nextEpisode')}</Text>
        </FocusableItem>
      ) : null}
    </View>
  </View>
);

interface EndOfEpisodePromptProps {
  nextEpisode: JellyfinMediaItem;
  /** Cancels a countdown, or leaves the player from the confirm prompt. */
  onDecline: () => void;
  onPlayNext: () => void;
  prompt: EndPrompt;
}

export const EndOfEpisodePrompt = ({
  nextEpisode,
  onDecline,
  onPlayNext,
  prompt,
}: EndOfEpisodePromptProps) => {
  const countdown = prompt.kind === 'countdown';
  return (
    <View style={styles.exitOverlay} testID="player-end-prompt">
      <Text style={styles.exitTitle}>
        {countdown ? t('player.upNext') : t('player.continueWatching')}
      </Text>
      <Text numberOfLines={1} style={styles.promptSubtitle}>
        {episodeLabel(nextEpisode)}
      </Text>
      <Text style={styles.promptHint}>
        {prompt.kind === 'countdown'
          ? t('player.playingIn', {seconds: prompt.remainingSeconds})
          : t('player.pressNextEpisode')}
      </Text>
      <View style={styles.exitButtons}>
        <FocusableItem
          focusedStyle={styles.focusedButton}
          hasTVPreferredFocus={true}
          onPress={onPlayNext}
          style={styles.button}
          testID={
            countdown ? 'player-up-next-play' : 'player-continue-watching'
          }>
          <Text style={styles.buttonText}>
            {countdown ? t('player.playNow') : t('detail.nextEpisode')}
          </Text>
        </FocusableItem>
        <FocusableItem
          focusedStyle={styles.focusedButton}
          onPress={onDecline}
          style={styles.button}
          testID={countdown ? 'player-up-next-cancel' : 'player-finished-done'}>
          <Text style={styles.buttonText}>
            {countdown ? t('common.cancel') : t('player.done')}
          </Text>
        </FocusableItem>
      </View>
    </View>
  );
};
