import type {MutableRefObject} from 'react';
import type {VideoPlayer} from '@amazon-devices/react-native-w3cmedia';

import type {JellyfinStreamInfo} from '../../services/jellyfin';
import type {
  PlaybackFailure,
  PlaybackHealthMonitor,
} from '../../services/playbackHealth';
import type {PlaybackSessionContext} from '../../services/playbackSession';
import type {SyncPlayPlayer} from '../../services/syncPlay';
import type {VideoSeekController} from '../../services/videoSeeking';
import type {ShakaPlayer} from '../../w3cmedia/shakaplayer/ShakaPlayer';
import type {PlaybackEventDiagnostics} from './types';

/**
 * The player's mutable state that lives outside React rendering, as one
 * object. PlayerScreen owns every ref; the pieces of the player that live in
 * their own files (source loading, media events, the watchdog) read and write
 * the same refs through this.
 */
export interface PlayerRefs {
  activeContext: MutableRefObject<PlaybackSessionContext | null>;
  controlsAwaitingProgress: MutableRefObject<boolean>;
  controlsProgressPosition: MutableRefObject<number>;
  decodedFramesThisSession: MutableRefObject<number>;
  decoderTranscodeUnusable: MutableRefObject<boolean>;
  detachPlaybackEvents: MutableRefObject<(() => void) | null>;
  finishAtEndRef: MutableRefObject<(generation: number) => void>;
  firstAvailableSeconds: MutableRefObject<number>;
  forcedDecoderTranscode: MutableRefObject<boolean>;
  forcedTranscodeReadyAtMs: MutableRefObject<number | null>;
  healthMonitor: MutableRefObject<PlaybackHealthMonitor>;
  isPausedRef: MutableRefObject<boolean>;
  lastActivePosition: MutableRefObject<number | null>;
  latestPositionTicks: MutableRefObject<number>;
  mediaTimelineOffsetSeconds: MutableRefObject<number>;
  pendingAdaptiveResumeSeconds: MutableRefObject<number | null>;
  playbackDiagnosticsStartedAt: MutableRefObject<number>;
  playbackErrorHandler: MutableRefObject<(failure: PlaybackFailure) => void>;
  playbackEventDiagnostics: MutableRefObject<PlaybackEventDiagnostics>;
  playbackGeneration: MutableRefObject<number>;
  playbackReadyAtMs: MutableRefObject<number | null>;
  playbackRecoveryAttempt: MutableRefObject<number>;
  seekController: MutableRefObject<VideoSeekController | null>;
  sessionReady: MutableRefObject<boolean>;
  shakaPlayerRef: MutableRefObject<ShakaPlayer | null>;
  sleepingRef: MutableRefObject<boolean>;
  streamInfo: MutableRefObject<JellyfinStreamInfo | null>;
  syncPlayPlayer: MutableRefObject<SyncPlayPlayer>;
  trackReloadInProgress: MutableRefObject<boolean>;
  unmountedRef: MutableRefObject<boolean>;
  videoRef: MutableRefObject<VideoPlayer | null>;
  wakeFromSleepRef: MutableRefObject<() => void>;
}
