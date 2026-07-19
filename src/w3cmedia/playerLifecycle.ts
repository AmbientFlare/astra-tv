export interface UnloadablePlayer {
  unload(): Promise<void> | void;
}

export interface PlayerReference<Player extends UnloadablePlayer> {
  current: Player | null;
}

export interface PlaybackRecoveryInput {
  attempt: number;
  audioDeliveryMethod?: 'Copy' | 'Transcode' | 'Unknown';
}

export interface PlaybackRecoveryAction {
  disableAudioStreamCopy: boolean;
  forceVideoTranscode: boolean;
  nextAttempt: number;
  statusText: string;
}

/**
 * Recover the narrowest failing stream first. A copied audio codec can be
 * rejected by the physical HDMI/Vega path even when its capability probe
 * succeeds. Convert only audio on the first retry and preserve the original
 * video resolution/bitrate. Escalate to video transcoding only if that fails.
 */
export const getNextPlaybackRecovery = ({
  attempt,
  audioDeliveryMethod,
}: PlaybackRecoveryInput): PlaybackRecoveryAction | null => {
  if (attempt === 0 && audioDeliveryMethod === 'Copy') {
    return {
      disableAudioStreamCopy: true,
      forceVideoTranscode: false,
      nextAttempt: 1,
      statusText: 'Audio format failed. Retrying with audio conversion...',
    };
  }

  if (attempt < 2) {
    return {
      disableAudioStreamCopy: false,
      forceVideoTranscode: true,
      nextAttempt: 2,
      statusText: 'Playback failed. Retrying with video conversion...',
    };
  }

  return null;
};

/**
 * Detach the current player from its ref before awaiting cleanup. This keeps
 * overlapping reload/teardown paths from unloading the same player twice and
 * guarantees that a replacement is not created until cleanup has finished.
 */
export const unloadPlayer = async <Player extends UnloadablePlayer>(
  playerRef: PlayerReference<Player>,
): Promise<void> => {
  const player = playerRef.current;
  if (!player) {
    return;
  }

  playerRef.current = null;
  await player.unload();
};
