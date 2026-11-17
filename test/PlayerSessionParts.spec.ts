import {releaseNativePlayer} from '../src/screens/PlayerScreen/releaseNativePlayer';
import {closeOutSessionTelemetry} from '../src/screens/PlayerScreen/sessionTelemetry';
import {emptyPlaybackEventDiagnostics} from '../src/screens/PlayerScreen/types';
import {flushTelemetry, isTelemetryArmed} from '../src/services/telemetry';
import {emitSessionEnd} from '../src/services/telemetry/playbackFacts';
import {notePlaybackSession} from '../src/services/telemetry/playbackStats';

jest.mock('../src/services/telemetry', () => ({
  flushTelemetry: jest.fn(async () => undefined),
  isTelemetryArmed: jest.fn(() => false),
}));
jest.mock('../src/services/telemetry/playbackFacts', () => ({
  emitPlaybackDecision: jest.fn(),
  emitSessionEnd: jest.fn(),
}));
jest.mock('../src/services/telemetry/playbackStats', () => ({
  notePlaybackSession: jest.fn(),
}));
jest.mock('../src/services/logging/trace', () => ({trace: jest.fn()}));

type Video = Parameters<typeof releaseNativePlayer>[0];
type Shaka = Parameters<typeof releaseNativePlayer>[1];

describe('closing out a playback session', () => {
  const closeOut = (
    overrides: Partial<Parameters<typeof closeOutSessionTelemetry>[0]> = {},
  ) => {
    const positionSec = jest.fn(() => 42);
    closeOutSessionTelemetry({
      diagnostics: {
        ...emptyPlaybackEventDiagnostics(),
        errorEventCount: 2,
        lastError: 'boom',
      },
      durationSec: 100,
      failed: false,
      positionSec,
      sample: null,
      startedMs: Date.now() - 5000,
      ...overrides,
    });
    return positionSec;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (isTelemetryArmed as jest.Mock).mockReturnValue(false);
  });

  it('records nothing for a session that never started and did not fail', () => {
    closeOut({startedMs: null});

    expect(notePlaybackSession).not.toHaveBeenCalled();
    expect(emitSessionEnd).not.toHaveBeenCalled();
  });

  it('records the failure of a session that never started', () => {
    closeOut({failed: true, startedMs: null});

    expect(notePlaybackSession).toHaveBeenCalledWith({
      failed: true,
      lastError: 'boom',
    });
    expect(emitSessionEnd).not.toHaveBeenCalled();
  });

  it('adds a started session to the summary without sending an event', () => {
    const positionSec = closeOut();

    expect(notePlaybackSession).toHaveBeenCalledWith(
      expect.objectContaining({errors: 2, failed: false, lastError: 'boom'}),
    );
    expect(emitSessionEnd).not.toHaveBeenCalled();
    // Reading the position touches the player, so it is left alone.
    expect(positionSec).not.toHaveBeenCalled();
  });

  it('sends the session-end event when telemetry is on', () => {
    (isTelemetryArmed as jest.Mock).mockReturnValue(true);

    closeOut({failed: true});

    expect(emitSessionEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        durationSec: 100,
        errorsSeen: 2,
        failed: true,
        positionSec: 42,
        reason: 'error',
      }),
    );
    expect(flushTelemetry).toHaveBeenCalledTimes(1);
  });
});

describe('releasing the native player', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  const flush = async () => {
    for (let turn = 0; turn < 10; turn++) {
      await Promise.resolve();
    }
  };
  const player = () => {
    const order: string[] = [];
    const video = {
      clearSurfaceHandle: jest.fn(() => order.push('surface')),
      deinitialize: jest.fn(async () => {
        order.push('deinitialize');
      }),
      deinitializeSync: jest.fn(() => {
        order.push('deinitializeSync');
        return 'ok';
      }),
      pause: jest.fn(() => order.push('pause')),
    };
    const shaka = {
      unload: jest.fn(async () => {
        order.push('unload');
      }),
    };
    return {order, shaka, video};
  };

  it('detaches the surface, then unloads Shaka before the video', async () => {
    const {order, shaka, video} = player();

    await releaseNativePlayer(
      video as unknown as Video,
      shaka as unknown as Shaka,
      'surface-1',
      false,
    );

    expect(video.clearSurfaceHandle).toHaveBeenCalledWith('surface-1');
    expect(order).toEqual(['surface', 'pause', 'unload', 'deinitialize']);
  });

  it('still releases the video when Shaka fails to unload', async () => {
    const {shaka, video} = player();
    shaka.unload.mockRejectedValue(new Error('unload failed'));

    await expect(
      releaseNativePlayer(
        video as unknown as Video,
        shaka as unknown as Shaka,
        null,
        false,
      ),
    ).rejects.toThrow('unload failed');

    expect(video.clearSurfaceHandle).not.toHaveBeenCalled();
    expect(video.deinitialize).toHaveBeenCalledTimes(1);
  });

  it('lets go of the decoder first when going to the background', async () => {
    const {order, shaka, video} = player();

    await releaseNativePlayer(
      video as unknown as Video,
      shaka as unknown as Shaka,
      'surface-1',
      true,
    );

    expect(order).toEqual(['surface', 'pause', 'deinitializeSync', 'unload']);
    expect(video.deinitialize).not.toHaveBeenCalled();
  });

  it('does not wait forever on a Shaka unload that never answers', async () => {
    const {shaka, video} = player();
    shaka.unload.mockReturnValue(new Promise<void>(() => undefined));
    let settled = false;

    const released = releaseNativePlayer(
      video as unknown as Video,
      shaka as unknown as Shaka,
      'surface-1',
      true,
    ).then(() => {
      settled = true;
    });
    await flush();
    jest.advanceTimersByTime(2999);
    await flush();
    expect(settled).toBe(false);
    jest.advanceTimersByTime(1);
    await released;

    expect(settled).toBe(true);
  });
});
