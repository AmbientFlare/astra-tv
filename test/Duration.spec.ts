import {
  formatSeconds,
  formatTotalRuntime,
  formatTrackDuration,
  metaLine,
  TICKS_PER_SECOND,
  ticksToSeconds,
} from '../src/utils/duration';

const ticks = (seconds: number) => seconds * TICKS_PER_SECOND;

describe('formatTrackDuration', () => {
  it('formats a normal track length', () => {
    expect(formatTrackDuration(ticks(204))).toBe('3:24');
  });

  it('pads seconds but not leading minutes', () => {
    expect(formatTrackDuration(ticks(65))).toBe('1:05');
    expect(formatTrackDuration(ticks(9))).toBe('0:09');
  });

  it('adds an hour component for long tracks', () => {
    expect(formatTrackDuration(ticks(3735))).toBe('1:02:15');
  });

  it('shows a placeholder rather than 0:00 for unknown lengths', () => {
    // Some sources report no duration; "--:--" reads as unknown, "0:00" reads
    // as an empty track.
    expect(formatTrackDuration(undefined)).toBe('--:--');
    expect(formatTrackDuration(0)).toBe('--:--');
  });
});

describe('formatTotalRuntime', () => {
  it('writes hours and minutes the way a listener would say it', () => {
    expect(formatTotalRuntime(ticks(4800))).toBe('1 hr 20 min');
  });

  it('omits minutes on an exact hour', () => {
    expect(formatTotalRuntime(ticks(3600))).toBe('1 hr');
  });

  it('uses minutes alone under an hour', () => {
    expect(formatTotalRuntime(ticks(2820))).toBe('47 min');
  });

  it('falls back to seconds for very short totals', () => {
    expect(formatTotalRuntime(ticks(38))).toBe('38 sec');
  });

  it('returns an empty string when unknown, so it can be omitted', () => {
    expect(formatTotalRuntime(undefined)).toBe('');
    expect(formatTotalRuntime(0)).toBe('');
  });
});

describe('formatSeconds', () => {
  it('formats live playback position', () => {
    expect(formatSeconds(0)).toBe('0:00');
    expect(formatSeconds(75.6)).toBe('1:15');
    expect(formatSeconds(3661)).toBe('1:01:01');
  });

  it('guards against NaN and negatives', () => {
    // The player reports NaN duration for some sources.
    expect(formatSeconds(NaN)).toBe('0:00');
    expect(formatSeconds(-5)).toBe('0:00');
  });
});

describe('ticksToSeconds', () => {
  it('converts and treats missing or negative values as zero', () => {
    expect(ticksToSeconds(ticks(10))).toBe(10);
    expect(ticksToSeconds(undefined)).toBe(0);
    expect(ticksToSeconds(-1)).toBe(0);
  });
});

describe('metaLine', () => {
  it('joins present parts and drops empty ones', () => {
    expect(metaLine('21 tracks', '1 hr 20 min', 2016)).toBe(
      '21 tracks  ·  1 hr 20 min  ·  2016',
    );
    expect(metaLine('21 tracks', '', undefined, null)).toBe('21 tracks');
    expect(metaLine()).toBe('');
  });
});
