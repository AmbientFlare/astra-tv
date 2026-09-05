jest.mock('../src/services/telemetry/index', () => ({
  emit: jest.fn(),
  isTelemetryArmed: jest.fn(),
}));
jest.mock('../src/services/telemetry/config', () => ({
  TELEMETRY_HEARTBEAT_STEADY_MS: 10000,
  TELEMETRY_HEARTBEAT_ACTIVE_MS: 2000,
}));

import {
  HeartbeatSample,
  PlaybackHeartbeat,
} from '../src/services/telemetry/heartbeat';
import {emit, isTelemetryArmed} from '../src/services/telemetry/index';

const armed = isTelemetryArmed as jest.Mock;
const emitted = emit as jest.Mock;

describe('PlaybackHeartbeat', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    armed.mockReturnValue(true);
  });
  afterEach(() => jest.useRealTimers());

  it('emits a normalized first sample with zero deltas', () => {
    const h = new PlaybackHeartbeat(() => ({
      pos: -1,
      ahead: 3,
      decodedFrames: 10,
      droppedFrames: 2,
    }));
    h.start();
    expect(emitted).toHaveBeenCalledWith(
      'hb',
      expect.objectContaining({
        pos: 0,
        dDecoded: 0,
        dDropped: 0,
        dropRatio: 0,
        starve: 'none',
      }),
    );
  });

  it('uses active cadence while buffering and classifies starvation', () => {
    const h = new PlaybackHeartbeat(() => ({
      buffering: true,
      bwEst: 1,
      bitrate: 2,
    }));
    h.start();
    expect(emitted.mock.calls[0][1].starve).toBe('network');
    jest.advanceTimersByTime(1999);
    expect(emitted).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    expect(emitted).toHaveBeenCalledTimes(2);
  });

  it('classifies device and server hypotheses only with their evidence', () => {
    let s: HeartbeatSample = {
      buffering: true,
      ahead: 2,
      decodedFrames: 100,
      droppedFrames: 0,
    };
    const h = new PlaybackHeartbeat(() => s);
    h.start();
    s = {...s, decodedFrames: 200, droppedFrames: 10};
    jest.advanceTimersByTime(2000);
    expect(emitted.mock.calls[1][1].starve).toBe('device');
    h.stop();
    emitted.mockClear();
    s = {
      buffering: true,
      ahead: 2,
      bwEst: 3,
      bitrate: 2,
      segP95: 3000,
      segmentDurationSec: 2,
    };
    h.start();
    expect(emitted.mock.calls[0][1].starve).toBe('server');
  });

  it('does not emit while unarmed and start/stop are idempotent', () => {
    armed.mockReturnValue(false);
    const h = new PlaybackHeartbeat(() => ({pos: 1}));
    h.start();
    expect(emitted).not.toHaveBeenCalled();
    h.stop();
    jest.advanceTimersByTime(20000);
    expect(emitted).not.toHaveBeenCalled();
  });

  it('does not reschedule after stop is called by the sample', () => {
    let h!: PlaybackHeartbeat;
    h = new PlaybackHeartbeat(() => {
      h.stop();
      return {pos: 1};
    });
    h.start();
    jest.advanceTimersByTime(20000);
    expect(emitted).not.toHaveBeenCalled();
  });

  it('reports unknown when buffering evidence is insufficient', () => {
    const h = new PlaybackHeartbeat(() => ({buffering: true, ahead: 0}));
    h.start();
    expect(emitted.mock.calls[0][1].starve).toBe('unknown');
  });

  it('resets frame counter baseline after stop and restart', () => {
    let s: HeartbeatSample = {decodedFrames: 20, droppedFrames: 2};
    const h = new PlaybackHeartbeat(() => s);
    h.start();
    h.stop();
    emitted.mockClear();
    s = {decodedFrames: 5, droppedFrames: 1};
    h.start();
    expect(emitted.mock.calls[0][1]).toEqual(
      expect.objectContaining({dDecoded: 0, dDropped: 0}),
    );
  });

  it('does not schedule polling while unarmed', () => {
    armed.mockReturnValue(false);
    const h = new PlaybackHeartbeat(() => ({pos: 1}));
    h.start();
    expect(jest.getTimerCount()).toBe(0);
  });
});
