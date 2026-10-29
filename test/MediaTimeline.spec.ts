import {
  calibrateTimelineOffset,
  isFrozenAtEnd,
  isStalledAtEnd,
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

describe('end of stream without an ended event', () => {
  const runTime = 3000 * 10000000;

  it('counts a stall in the last ten seconds as the end', () => {
    expect(isStalledAtEnd(2995, runTime)).toBe(true);
    expect(isStalledAtEnd(2989, runTime)).toBe(false);
    expect(isStalledAtEnd(2995, undefined)).toBe(false);
  });

  it('spots a picture frozen in the last two seconds', () => {
    expect(isFrozenAtEnd(2999, 2999.1, runTime)).toBe(true);
    expect(isFrozenAtEnd(2999, 2996, runTime)).toBe(false);
    expect(isFrozenAtEnd(2997, 2997, runTime)).toBe(false);
    expect(isFrozenAtEnd(2999, null, runTime)).toBe(false);
    expect(isFrozenAtEnd(2999, 2999, undefined)).toBe(false);
  });
});
