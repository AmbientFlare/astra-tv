import React from 'react';
import {ActivityIndicator, Text, View} from 'react-native';

import {FocusableItem} from '../../components/FocusableItem';
import {t} from '../../i18n';
import type {JellyfinMediaItem} from '../../services/jellyfin';
import {formatDiagnosticTime} from './formatDiagnostics';
import {episodeLabel} from './playbackPolicy';
import {styles} from './styles';
import type {EndPrompt} from './types';
import {colors} from '../../theme';

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
        <ActivityIndicator color={colors.text.accent} size="large" />
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
            hasTVPreferredFocus={true}
            onPress={onRetry}
            style={styles.button}
            testID="player-startup-retry">
            <Text style={styles.buttonText}>{t('common.retry')}</Text>
          </FocusableItem>
          <FocusableItem
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
  /** A second line under the title: the episode, or the year. */
  subtitle?: string;
  title: string;
  /** False while a panel occupies the top of the screen. */
  titleVisible?: boolean;
}

/** 1:02:03, or 2:03 for anything under an hour. */
const clockTime = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, '0');
  return whole >= 3600
    ? `${Math.floor(whole / 3600)}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${minutes}:${rest}`;
};

export const ControlsBar = ({
  durationSeconds,
  positionSeconds,
  seekInProgress,
  seekPreview,
  seekStepSeconds,
  statusText,
  subtitle,
  title,
  titleVisible = true,
}: ControlsBarProps) => {
  const shown = seekPreview ?? positionSeconds;
  const progress = (
    durationSeconds > 0
      ? `${Math.min(100, Math.max(0, (shown / durationSeconds) * 100))}%`
      : '0%'
  ) as `${number}%`;
  const seeking = seekPreview !== null;
  return (
    <View
      pointerEvents="none"
      style={styles.controls}
      testID="player-controls-overlay">
      {titleVisible ? (
        <View>
          <View style={styles.controlsTopText}>
            <Text numberOfLines={1} style={styles.title}>
              {title}
            </Text>
            {subtitle ? (
              <Text numberOfLines={1} style={styles.subtitle}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          <View style={styles.fadeMid} />
          <View style={styles.fadeFar} />
        </View>
      ) : (
        <View />
      )}
      <View>
        <View style={styles.fadeFar} />
        <View style={styles.fadeMid} />
        <View style={styles.controlsBottom}>
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
          <View style={styles.scrubRow}>
            <Text style={[styles.clock, seeking && styles.clockSeeking]}>
              {clockTime(shown)}
            </Text>
            <View style={styles.scrubber}>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, {width: progress}]} />
              </View>
              <View style={[styles.thumbRail, {width: progress}]}>
                <View style={[styles.thumb, seeking && styles.thumbSeeking]} />
              </View>
            </View>
            <Text style={[styles.clock, styles.clockEnd]}>
              {durationSeconds > 0 ? clockTime(durationSeconds) : ''}
            </Text>
          </View>
        </View>
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
        hasTVPreferredFocus={true}
        onPress={onStay}
        style={styles.button}
        testID="player-exit-stay">
        <Text style={styles.buttonText}>{t('player.stay')}</Text>
      </FocusableItem>
      <FocusableItem
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
        hasTVPreferredFocus={true}
        onPress={onSkip}
        style={styles.button}
        testID="player-skip-credits">
        <Text style={styles.buttonText}>{t('player.skipCredits')}</Text>
      </FocusableItem>
      {onNextEpisode ? (
        <FocusableItem
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
