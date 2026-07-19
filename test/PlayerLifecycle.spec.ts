import {
  getNextPlaybackRecovery,
  unloadPlayer,
} from '../src/w3cmedia/playerLifecycle';

describe('getNextPlaybackRecovery', () => {
  it('converts only copied audio on the first failure', () => {
    expect(
      getNextPlaybackRecovery({attempt: 0, audioDeliveryMethod: 'Copy'}),
    ).toMatchObject({
      disableAudioStreamCopy: true,
      forceVideoTranscode: false,
      nextAttempt: 1,
    });
  });

  it('escalates to video conversion without imposing a bitrate cap', () => {
    expect(
      getNextPlaybackRecovery({attempt: 1, audioDeliveryMethod: 'Transcode'}),
    ).toMatchObject({
      disableAudioStreamCopy: false,
      forceVideoTranscode: true,
      nextAttempt: 2,
    });
  });

  it('stops retrying after both narrow recovery paths fail', () => {
    expect(
      getNextPlaybackRecovery({attempt: 2, audioDeliveryMethod: 'Transcode'}),
    ).toBeNull();
  });
});

describe('unloadPlayer', () => {
  it('waits for asynchronous cleanup before resolving', async () => {
    let finishUnload: (() => void) | undefined;
    const unload = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishUnload = resolve;
        }),
    );
    const player = {unload};
    const playerRef = {current: player};

    let resolved = false;
    const cleanup = unloadPlayer(playerRef).then(() => {
      resolved = true;
    });

    expect(playerRef.current).toBeNull();
    expect(unload).toHaveBeenCalledTimes(1);
    expect(resolved).toBe(false);

    finishUnload?.();
    await cleanup;

    expect(resolved).toBe(true);
  });

  it('does not unload the same player twice', async () => {
    const unload = jest.fn(async () => undefined);
    const playerRef = {current: {unload}};

    await Promise.all([unloadPlayer(playerRef), unloadPlayer(playerRef)]);

    expect(unload).toHaveBeenCalledTimes(1);
  });
});
