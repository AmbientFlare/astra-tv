import {
  assessDecoderRisk,
  shouldAbandonForcedDecoderTranscode,
  shouldForceVideoConversion,
  shouldTranscodeForDecoder,
  shouldTripForcedDecoderTranscode,
  shouldWarnAboutDecoderRisk,
} from '../src/services/playbackHealth';

describe('assessDecoderRisk', () => {
  it('flags the high-bitrate Dolby Vision source that dropped frames', () => {
    // Central Intelligence: 3840x1600 HEVC Main 10, DV Profile 8.1.
    expect(
      assessDecoderRisk({bitRate: 24_196_532, videoRangeType: 'DOVIWithHDR10'}),
    ).toEqual({risk: 'heavy', reason: 'dynamic-range'});
  });

  it('leaves clean high-bitrate SDR alone', () => {
    // A 30.5 Mbps SDR title played with zero dropped frames, so bitrate on
    // its own must not trigger a re-encode.
    expect(
      assessDecoderRisk({bitRate: 30_500_000, videoRangeType: 'SDR'}),
    ).toEqual({risk: 'easy', reason: 'none'});
  });

  it('leaves 4K HDR10 and modest Dolby Vision alone', () => {
    expect(
      assessDecoderRisk({bitRate: 6_390_308, videoRangeType: 'HDR10'}).risk,
    ).toBe('easy');
    expect(
      assessDecoderRisk({bitRate: 8_000_000, videoRangeType: 'DOVI'}).risk,
    ).toBe('easy');
  });

  it('keeps a backstop above anything in a normal library', () => {
    expect(assessDecoderRisk({bitRate: 45_000_000}).reason).toBe('bitrate');
  });

  it('treats missing metadata as easy', () => {
    expect(assessDecoderRisk(undefined).risk).toBe('easy');
    expect(assessDecoderRisk({}).risk).toBe('easy');
    expect(assessDecoderRisk({videoRangeType: 'DOVI'}).risk).toBe('easy');
  });
});

describe('heavy-title routing', () => {
  it('re-encodes when the server may, warns when it may not', () => {
    expect(shouldTranscodeForDecoder('heavy', true)).toBe(true);
    expect(shouldWarnAboutDecoderRisk('heavy', true)).toBe(false);

    expect(shouldTranscodeForDecoder('heavy', false)).toBe(false);
    expect(shouldWarnAboutDecoderRisk('heavy', false)).toBe(true);
  });

  it('never warns or re-encodes for an easy title', () => {
    for (const canTranscode of [true, false]) {
      expect(shouldTranscodeForDecoder('easy', canTranscode)).toBe(false);
      expect(shouldWarnAboutDecoderRisk('easy', canTranscode)).toBe(false);
    }
  });

  it('feeds the existing conversion gate without changing its other inputs', () => {
    expect(shouldForceVideoConversion(false, false, true)).toBe(true);
    expect(shouldForceVideoConversion(false, false, false)).toBe(false);
    expect(shouldForceVideoConversion(false, false)).toBe(false);
    expect(shouldForceVideoConversion(true, false)).toBe(true);
  });
});

describe('shouldAbandonForcedDecoderTranscode', () => {
  it('abandons the force when the NAS never produced a frame', () => {
    // Run 2, 2026-09-07: three forced sessions against the GPU-less lab server, each
    // with no manifest, zero buffered ranges and zero decoded frames.
    expect(shouldAbandonForcedDecoderTranscode(true, false, 0)).toBe(true);
  });

  it('keeps the force when the session decoded frames before failing', () => {
    expect(shouldAbandonForcedDecoderTranscode(true, false, 2582)).toBe(false);
  });

  it('does not fire twice, so the fallback cannot loop', () => {
    expect(shouldAbandonForcedDecoderTranscode(true, true, 0)).toBe(false);
  });

  it('leaves unforced sessions to the normal retry path', () => {
    expect(shouldAbandonForcedDecoderTranscode(false, false, 0)).toBe(false);
  });

  it('warns once the force has been abandoned', () => {
    // The abandoned server is treated as unable, so the viewer gets the
    // warning the policy flag wrongly suppressed.
    expect(shouldWarnAboutDecoderRisk('heavy', false)).toBe(true);
    expect(shouldTranscodeForDecoder('heavy', false)).toBe(false);
  });
});

describe('shouldTripForcedDecoderTranscode', () => {
  // Both fixtures are the same file on the GPU-less lab server, 2026-09-08, one forced
  // session that died and one that played, measured from session-ready.
  it('trips the dead forced start before the stall watchdog would', () => {
    expect(shouldTripForcedDecoderTranscode(true, false, 0, 0, 10_000)).toBe(
      true,
    );
  });

  it('leaves a healthy session alone: it had a range at 4.6s', () => {
    expect(shouldTripForcedDecoderTranscode(true, false, 0, 1, 30_000)).toBe(
      false,
    );
  });

  it('waits out a slow start rather than tripping immediately', () => {
    expect(shouldTripForcedDecoderTranscode(true, false, 0, 0, 6_000)).toBe(
      false,
    );
  });

  it('leaves a session that decoded frames to the normal retry path', () => {
    expect(shouldTripForcedDecoderTranscode(true, false, 24, 0, 30_000)).toBe(
      false,
    );
  });

  it('cannot trip a second time, or an unforced session', () => {
    expect(shouldTripForcedDecoderTranscode(true, true, 0, 0, 30_000)).toBe(
      false,
    );
    expect(shouldTripForcedDecoderTranscode(false, false, 0, 0, 30_000)).toBe(
      false,
    );
  });
});
