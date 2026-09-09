const mockEmit = jest.fn();
const mockScrubUrl = (value: string): string => `SCRUBBED:${value}`;

jest.mock('../src/services/telemetry/index', () => ({
  emit: mockEmit,
  scrubUrl: mockScrubUrl,
}));

import {emitPlaybackDecision} from '../src/services/telemetry/playbackFacts';

describe('emitPlaybackDecision delivery facts', () => {
  beforeEach(() => mockEmit.mockClear());

  it('reports Unknown for contrasting SDR and HDR codec/reason combinations', () => {
    emitPlaybackDecision({
      itemId: 'sdr',
      videoCodec: 'h264',
      outputVideoCodec: 'h264',
      transcodeReasons: ['DirectPlayError'],
    });
    const sdr = mockEmit.mock.calls[0][1];

    emitPlaybackDecision({
      itemId: 'hdr',
      videoCodec: 'hevc',
      outputVideoCodec: 'hevc',
      transcodeReasons: [
        'VideoRangeTypeNotSupported',
        'AudioCodecNotSupported',
      ],
    });
    const hdr = mockEmit.mock.calls[1][1];

    expect(sdr.videoDeliveryMethod).toBe('Unknown');
    expect(sdr.audioDeliveryMethod).toBe('Unknown');
    expect(sdr.videoDeliveryEvidence).toMatch(/no effective video/i);
    expect(sdr.audioDeliveryEvidence).toMatch(/TranscodingUrl is a request/);
    expect(hdr.videoDeliveryMethod).toBe('Unknown');
    expect(hdr.audioDeliveryMethod).toBe('Unknown');
  });

  it('does not infer copy from permissions or matching codecs', () => {
    const decision = {
      videoCodec: 'h264',
      outputVideoCodec: 'h264',
      audioCodec: 'aac',
      outputAudioCodec: 'aac',
      transcodeUrl:
        'https://jellyfin.test/videos/1/master.m3u8?AllowVideoStreamCopy=true&AllowAudioStreamCopy=true&VideoCodec=h264&AudioCodec=aac',
    };

    emitPlaybackDecision(decision);
    const detail = mockEmit.mock.calls[0][1];
    expect(mockEmit.mock.calls[0][0]).toBe('playback.decision');
    expect(detail.videoDeliveryMethod).toBe('Unknown');
    expect(detail.audioDeliveryMethod).toBe('Unknown');
  });

  it('forwards both playback URLs through the scrubber', () => {
    emitPlaybackDecision({
      streamUrl:
        'https://jellyfin.test/stream?api_key=secret&MediaSourceId=source',
      transcodeUrl: 'https://jellyfin.test/videos/1/master.m3u8?apiKey=secret',
    });

    const detail = mockEmit.mock.calls[0][1];
    expect(detail.streamUrl).toContain('SCRUBBED:');
    expect(detail.transcodeUrl).toContain('SCRUBBED:');
  });
});
