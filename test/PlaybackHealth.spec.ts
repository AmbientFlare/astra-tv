import {
  isMediaFailure,
  PlaybackHealthMonitor,
  shouldForceVideoConversion,
} from '../src/services/playbackHealth';
import {
  isPrematureEnd,
  logicalDurationSeconds,
  requiresStreamReload,
} from '../src/w3cmedia/mediaTimeline';

describe('logical item timeline', () => {
  it('uses full runtime after halfway resume and keeps later chapters valid', () => {
    const duration = logicalDurationSeconds(3000 * 10000000, 1500, 1500);
    expect(duration).toBe(3000);
    expect(1500 / duration).toBe(0.5);
    expect([0, 1200, 2400].filter((time) => time < duration)).toEqual([
      0, 1200, 2400,
    ]);
  });
  it('handles unknown/infinite durations without displaying a false endpoint', () => {
    expect(logicalDurationSeconds(undefined, Infinity)).toBe(0);
    expect(logicalDurationSeconds(undefined, 100, 200)).toBe(300);
    expect(isPrematureEnd(100, undefined)).toBe(false);
    expect(isPrematureEnd(100, 300 * 10000000)).toBe(true);
    expect(isPrematureEnd(295, 300 * 10000000)).toBe(false);
  });
  it('reloads even a short backward seek outside the retained playlist', () => {
    expect(requiresStreamReload(1505, 1495, 1500)).toBe(true);
    expect(requiresStreamReload(1505, 1515, 1500)).toBe(false);
    expect(requiresStreamReload(1505, 1605, 1500)).toBe(true);
  });
});

describe('playback health', () => {
  it('detects a frozen playhead, but not steady playback or a pause', () => {
    const monitor = new PlaybackHealthMonitor();
    expect(monitor.observe(0, 10, true)).toBe(false);
    expect(monitor.observe(29000, 11, true)).toBe(false);
    expect(monitor.observe(59000, 11, true)).toBe(true);
    expect(monitor.observe(60000, 11, false)).toBe(false);
    expect(monitor.observe(120000, 11, true)).toBe(false);
  });
  it('does not change codecs for network failures or unclassified stalls', () => {
    expect(isMediaFailure({source: 'shaka', category: 1})).toBe(false);
    expect(isMediaFailure({source: 'native', code: 2})).toBe(false);
    expect(isMediaFailure({source: 'watchdog'})).toBe(false);
    expect(isMediaFailure({source: 'shaka', category: 3})).toBe(true);
  });
  it('removes subtitle conversion on Off while retaining a decoder restriction', () => {
    expect(shouldForceVideoConversion(false, true)).toBe(true);
    expect(shouldForceVideoConversion(false, false)).toBe(false);
    expect(shouldForceVideoConversion(true, false)).toBe(true);
  });
});
