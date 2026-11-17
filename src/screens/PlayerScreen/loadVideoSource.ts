import type {VideoPlayer} from '@amazon-devices/react-native-w3cmedia';

import type {JellyfinStreamInfo} from '../../services/jellyfin';
import {trace} from '../../services/logging/trace';
import {getHdrSupport} from '../../services/mediaCapabilities/hdr';
import {preferredVideoHdrLevel} from '../../services/mediaCapabilities/hdrPreference';
import {
  computeBufferBudget,
  formatPlaybackFailure,
  liveBufferBudget,
  PlaybackFailure,
  shakaFailure,
} from '../../services/playbackHealth';
import type {PlaybackSessionContext} from '../../services/playbackSession';
import {UNPROBED_SOURCE_ATTRIBUTES} from '../../w3cmedia/hlsUnprobedVariant';
import {unloadPlayer} from '../../w3cmedia/playerLifecycle';
import {
  isAdaptiveStream,
  shouldUseHlsSequenceMode,
  shouldUseSequenceModeForMidFileStart,
} from './playbackPolicy';
import type {PlayerRefs} from './playerRefs';

interface LoadVideoSourceOptions {
  isLive: boolean;
  isPluginLive: boolean;
  refs: Pick<
    PlayerRefs,
    | 'firstAvailableSeconds'
    | 'mediaTimelineOffsetSeconds'
    | 'pendingAdaptiveResumeSeconds'
    | 'playbackErrorHandler'
    | 'shakaPlayerRef'
  >;
}

/**
 * Points a video element at a resolved stream: a plain file goes straight to
 * the element, an HLS or DASH stream goes through a new Shaka player. Any
 * earlier Shaka player is unloaded first.
 */
export const loadVideoSource = async (
  {isLive, isPluginLive, refs}: LoadVideoSourceOptions,
  video: VideoPlayer,
  stream: JellyfinStreamInfo,
  startTimeSeconds?: number,
  context?: PlaybackSessionContext,
) => {
  const {
    firstAvailableSeconds,
    mediaTimelineOffsetSeconds,
    pendingAdaptiveResumeSeconds,
    playbackErrorHandler,
    shakaPlayerRef,
  } = refs;
  context?.assertCurrent();
  if (!isAdaptiveStream(stream.url)) {
    pendingAdaptiveResumeSeconds.current = null;
    mediaTimelineOffsetSeconds.current = 0;
    await unloadPlayer(shakaPlayerRef);
    context?.assertCurrent();
    video.src = stream.url;
    video.load();
    return;
  }

  const {ShakaPlayer} = await import('../../w3cmedia/shakaplayer/ShakaPlayer');
  context?.assertCurrent();
  const sequenceMode =
    shouldUseHlsSequenceMode(stream.outputContainer) ||
    shouldUseSequenceModeForMidFileStart(
      stream.outputContainer,
      startTimeSeconds,
    ) ||
    isPluginLive;
  trace(
    'shaka.mode',
    `${sequenceMode ? 'sequence' : 'segments'} container=${
      stream.outputContainer ?? '?'
    } start=${(startTimeSeconds ?? 0).toFixed(0)}s`,
  );
  const hdrSupport = await getHdrSupport();
  context?.assertCurrent();
  // stream.bitrate is the server's figure for the delivered stream. It is
  // the closest thing available before the manifest is parsed; the goals
  // only need to be right to within a segment.
  const bufferBudget = liveBufferBudget(
    computeBufferBudget(stream.bitrate),
    isLive,
  );
  trace(
    'shaka.buffer',
    `ahead=${bufferBudget.bufferingGoal}s resume=${
      bufferBudget.rebufferingGoal
    }s behind=${bufferBudget.bufferBehind}s bitrate=${stream.bitrate ?? '?'}`,
  );
  const settings = {
    bufferingGoalSeconds: bufferBudget.bufferingGoal,
    rebufferingGoalSeconds: bufferBudget.rebufferingGoal,
    bufferBehindSeconds: bufferBudget.bufferBehind,
    preferredVideoHdrLevel: preferredVideoHdrLevel(
      hdrSupport,
      stream.sourceVideoRangeType,
    ),
    secure: stream.url.startsWith('https://'),
    abrEnabled: false,
    abrMaxWidth: 3840,
    abrMaxHeight: 2160,
    // Physical testing rejected sequence mode for MPEG-TS because A/V
    // drift still accumulated over an hour. Retain the accepted
    // segments-mode path while evaluating W3C Media 2.2 in isolation.
    hlsSequenceMode: sequenceMode,
    hlsIgnoreManifestTimestampsInSegmentsMode: !sequenceMode,
    // Only a source Jellyfin knows nothing about lacks codecs, and its
    // fallback encode is always H.264 and AAC.
    hlsUnprobedAttributes: UNPROBED_SOURCE_ATTRIBUTES,
    hlsResumePositionSeconds:
      startTimeSeconds && startTimeSeconds > 0 ? startTimeSeconds : undefined,
    onError: (failure: PlaybackFailure) => {
      if (context?.isCurrent()) {
        playbackErrorHandler.current(failure);
      }
    },
    onTimelineReady: ({skippedSeconds}: {skippedSeconds: number}) => {
      if (!context?.isCurrent()) {
        return;
      }
      firstAvailableSeconds.current = skippedSeconds;
      pendingAdaptiveResumeSeconds.current = skippedSeconds;
    },
  };

  await unloadPlayer(shakaPlayerRef);
  context?.assertCurrent();
  pendingAdaptiveResumeSeconds.current =
    startTimeSeconds && startTimeSeconds > 0 ? startTimeSeconds : null;
  mediaTimelineOffsetSeconds.current = 0;
  const shakaPlayer = new ShakaPlayer(video, settings);
  shakaPlayerRef.current = shakaPlayer;
  const cancel = () => {
    void shakaPlayer.cancelLoad().catch(() => undefined);
  };
  context?.signal.addEventListener('abort', cancel, {once: true});
  try {
    await shakaPlayer.load(
      {
        uri: stream.url,
        format: stream.url.includes('.mpd') ? 'DASH' : 'HLS',
        secure: settings.secure,
        drm_scheme: '',
        drm_license_uri: '',
        // Jellyfin's dynamic HLS URL is already positioned at the saved
        // movie time. Passing that absolute time again makes Shaka append
        // every shortened-playlist segment until it reaches the same
        // number. Start at the playlist edge and map its relative media
        // clock back to logical movie time once playback begins.
        startTime: 0,
      },
      false,
    );
    context?.assertCurrent();
  } catch (error) {
    // Shaka rejects with shaka.util.Error, which is not an Error
    // instance — without this it surfaces as a blank "Unable to start
    // playback" with no diagnostic trail.
    const shakaError = shakaFailure(error);
    const failureDetail = formatPlaybackFailure(shakaError);
    trace('shaka.load.error', failureDetail);
    console.error('[Astra] Shaka load failed:', failureDetail);
    throw error instanceof Error
      ? error
      : new Error(`Stream engine error: ${failureDetail}`);
  } finally {
    context?.signal.removeEventListener('abort', cancel);
  }
};
