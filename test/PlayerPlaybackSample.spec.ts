import {
  collectPlaybackSample,
  heartbeatSampleFrom,
} from '../src/screens/PlayerScreen/playbackSample';
import {emptyPlaybackEventDiagnostics} from '../src/screens/PlayerScreen/types';

const videoAt = (
  currentTime: number,
  quality?: {droppedVideoFrames?: number; totalVideoFrames?: number},
) =>
  ({
    currentTime,
    videoWidth: 1280,
    videoHeight: 720,
    getVideoPlaybackQuality: () => {
      if (!quality) {
        throw new Error('unsupported');
      }
      return quality;
    },
  } as any);

const shakaWith = (stats: Record<string, unknown>) =>
  ({getDebugStats: () => stats} as any);

describe('collectPlaybackSample', () => {
  it('reads the buffer shape around the playhead', () => {
    const sample = collectPlaybackSample(
      shakaWith({
        buffered: {
          total: [
            {start: 0, end: 30},
            {start: 45, end: 90},
          ],
        },
        stats: {width: 1920, height: 1080, estimatedBandwidth: 8e6},
      }),
      videoAt(20, {droppedVideoFrames: 2, totalVideoFrames: 500}),
      {...emptyPlaybackEventDiagnostics(), waitingEventCount: 3},
    );
    expect(sample).toMatchObject({
      activeVideoWidth: 1920,
      activeVideoHeight: 1080,
      bufferedAheadSeconds: 10,
      bufferedRangeCount: 2,
      furthestBufferedAheadSeconds: 70,
      nextBufferedGapSeconds: 15,
      decodedFrames: 500,
      droppedFrames: 2,
      estimatedBandwidth: 8e6,
      waitingEventCount: 3,
    });
  });

  it('falls back to the element when Shaka has no numbers', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const sample = collectPlaybackSample(
      shakaWith({}),
      videoAt(5),
      emptyPlaybackEventDiagnostics(),
    );
    expect(sample).toMatchObject({
      activeVideoWidth: 1280,
      activeVideoHeight: 720,
      bufferedRangeCount: 0,
      bufferedAheadSeconds: undefined,
      decodedFrames: undefined,
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('heartbeatSampleFrom', () => {
  it('reports the file position and the raw clock only when they differ', () => {
    const aligned = heartbeatSampleFrom({
      sample: null,
      stream: null,
      currentTime: 12,
      timelineOffsetSeconds: 0,
      paused: false,
    });
    expect(aligned.pos).toBe(12);
    expect(aligned.mediaPos).toBeUndefined();

    const shifted = heartbeatSampleFrom({
      sample: null,
      stream: null,
      currentTime: 12,
      timelineOffsetSeconds: 600,
      paused: true,
    });
    expect(shifted.pos).toBe(612);
    expect(shifted.mediaPos).toBe(12);
    expect(shifted.paused).toBe(true);
  });

  it('marks buffering from the last event and takes the stream bitrate as a fallback', () => {
    const sample = heartbeatSampleFrom({
      sample: {
        ...emptyPlaybackEventDiagnostics(),
        lastPlaybackEvent: 'waiting',
        bufferedAheadSeconds: 4,
      },
      stream: {bitrate: 5e6, hlsSegmentTargetSeconds: 6} as any,
      currentTime: undefined,
      timelineOffsetSeconds: 0,
      paused: false,
    });
    expect(sample).toMatchObject({
      pos: undefined,
      buffering: true,
      ahead: 4,
      bitrate: 5e6,
      segmentDurationSec: 6,
    });
  });
});
