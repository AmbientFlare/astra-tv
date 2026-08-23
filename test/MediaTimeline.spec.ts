import {
  calibrateTimelineOffset,
  logicalToMediaTime,
  mediaToLogicalTime,
} from '../src/w3cmedia/mediaTimeline';

describe('server-positioned HLS timeline', () => {
  it('maps a shortened media timeline back to absolute movie time', () => {
    const offset = calibrateTimelineOffset(2696.192, 10.083);

    expect(mediaToLogicalTime(10.083, offset)).toBeCloseTo(2696.192);
    expect(mediaToLogicalTime(70.083, offset)).toBeCloseTo(2756.192);
  });

  it('maps logical seeks into the shortened playlist', () => {
    const offset = calibrateTimelineOffset(2696.192, 10.083);

    expect(logicalToMediaTime(2756.192, offset)).toBeCloseTo(70.083);
  });

  it('clamps requests before the shortened playlist to its beginning', () => {
    expect(logicalToMediaTime(100, 200)).toBe(0);
  });
});
