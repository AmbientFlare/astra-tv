import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type {VideoPlayer} from '@amazon-devices/react-native-w3cmedia';
import type {JellyfinStreamInfo} from '../../services/jellyfin';
import {
  getServerCapabilities,
  recordTranscodeSuccess,
} from '../../services/serverCapabilities';
import {
  HeartbeatSample,
  PlaybackHeartbeat,
} from '../../services/telemetry/heartbeat';
import type {ShakaPlayer as ShakaPlayerInstance} from '../../w3cmedia/shakaplayer/ShakaPlayer';
import {collectPlaybackSample, heartbeatSampleFrom} from './playbackSample';
import type {PlaybackDebugInfo, PlaybackEventDiagnostics} from './types';

interface PlaybackDiagnosticsDeps {
  shakaPlayerRef: MutableRefObject<ShakaPlayerInstance | null>;
  videoRef: MutableRefObject<VideoPlayer | null>;
  unmountedRef: MutableRefObject<boolean>;
  playbackEventDiagnostics: MutableRefObject<PlaybackEventDiagnostics>;
  streamInfo: MutableRefObject<JellyfinStreamInfo | null>;
  mediaTimelineOffsetSeconds: MutableRefObject<number>;
  isPausedRef: MutableRefObject<boolean>;
  /** Set while the current session is a decoder-forced server transcode. */
  forcedDecoderTranscode: MutableRefObject<boolean>;
  /** Cleared once per screen when a forced transcode has produced frames. */
  transcodeSuccessRecorded: MutableRefObject<boolean>;
  decodedFramesThisSession: MutableRefObject<number>;
  serverKey: string;
  showPlaybackStats: boolean;
}

/**
 * The player's read-only diagnostics: the telemetry heartbeat that speaks
 * during steady playback, the once-a-second sample behind the stats overlay,
 * and the last sample kept for session.end. Nothing here owns media.
 */
export const usePlaybackDiagnostics = ({
  shakaPlayerRef,
  videoRef,
  unmountedRef,
  playbackEventDiagnostics,
  streamInfo,
  mediaTimelineOffsetSeconds,
  isPausedRef,
  forcedDecoderTranscode,
  transcodeSuccessRecorded,
  decodedFramesThisSession,
  serverKey,
  showPlaybackStats,
}: PlaybackDiagnosticsDeps) => {
  const heartbeatRef = useRef<PlaybackHeartbeat | null>(null);
  // Last diagnostics sample, kept so session.end can report lifetime totals
  // without sampling a player that is already being torn down.
  const lastTelemetrySample = useRef<PlaybackDebugInfo | null>(null);
  const [playbackDebugInfo, setPlaybackDebugInfo] =
    useState<PlaybackDebugInfo | null>(null);

  const sample = useCallback((): PlaybackDebugInfo | null => {
    const shakaPlayer = shakaPlayerRef.current;
    const video = videoRef.current;
    if (!shakaPlayer || !video || unmountedRef.current) {
      return null;
    }
    return collectPlaybackSample(
      shakaPlayer,
      video,
      playbackEventDiagnostics.current,
    );
  }, [playbackEventDiagnostics, shakaPlayerRef, unmountedRef, videoRef]);

  useEffect(() => {
    // The heartbeat is the only thing that speaks during steady playback: the
    // trace() call sites all fire on transitions, so without this a two-hour
    // movie produces silence. 10s steady, 2s while starting or buffering.
    const heartbeat = new PlaybackHeartbeat((): HeartbeatSample => {
      const current = sample();
      lastTelemetrySample.current = current ?? lastTelemetrySample.current;
      decodedFramesThisSession.current = Math.max(
        decodedFramesThisSession.current,
        current?.decodedFrames ?? 0,
      );
      // A forced session that is producing frames clears a stale `unable`, so
      // a GPU that has come back is picked up without anyone visiting Settings.
      if (
        forcedDecoderTranscode.current &&
        !transcodeSuccessRecorded.current &&
        decodedFramesThisSession.current > 0
      ) {
        transcodeSuccessRecorded.current = true;
        void getServerCapabilities(serverKey)
          .then((capabilities) =>
            recordTranscodeSuccess(serverKey, capabilities.videoTranscode),
          )
          .catch(() => undefined);
      }
      return heartbeatSampleFrom({
        sample: current,
        stream: streamInfo.current,
        currentTime: videoRef.current?.currentTime,
        timelineOffsetSeconds: mediaTimelineOffsetSeconds.current,
        paused: isPausedRef.current,
      });
    });
    heartbeatRef.current = heartbeat;
    return () => {
      heartbeat.stop();
      heartbeatRef.current = null;
    };
  }, [
    decodedFramesThisSession,
    forcedDecoderTranscode,
    isPausedRef,
    mediaTimelineOffsetSeconds,
    sample,
    serverKey,
    streamInfo,
    transcodeSuccessRecorded,
    videoRef,
  ]);

  useEffect(() => {
    if (!showPlaybackStats) {
      setPlaybackDebugInfo(null);
      return;
    }

    const updateStats = () => {
      const current = sample();
      if (current) {
        lastTelemetrySample.current = current;
        setPlaybackDebugInfo(current);
      }
    };

    updateStats();
    const interval = setInterval(updateStats, 1000);
    return () => clearInterval(interval);
  }, [sample, showPlaybackStats]);

  return {heartbeatRef, lastTelemetrySample, playbackDebugInfo};
};
