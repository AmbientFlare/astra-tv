import {
  closeLeftoverSession,
  noteSessionClosed,
  noteSessionOpen,
  resetOpenSessionForTests,
} from '../src/services/playbackSession/openSession';
import {getItem, removeItem, setItem} from '../src/services/storageAdapter';

jest.mock('../src/services/storageAdapter', () => {
  const store = new Map<string, string>();
  return {
    getItem: jest.fn(async (key: string) => store.get(key) ?? null),
    removeItem: jest.fn(async (key: string) => {
      store.delete(key);
    }),
    setItem: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
});

const KEY = 'astra.openPlaybackSession.v1';
const owner = {serverUrl: 'http://server:8096', userId: 'user-1'};
const report = {
  itemId: 'item-1',
  mediaSourceId: 'source-1',
  playSessionId: 'play-1',
  positionTicks: 1000,
};

describe('a playback session left open on the server', () => {
  beforeEach(async () => {
    resetOpenSessionForTests();
    await removeItem(KEY);
    jest.clearAllMocks();
  });

  /** As if the app had been ended and started again. */
  const restartApp = () => resetOpenSessionForTests();

  it('is closed at the next launch, at the last position reported', async () => {
    await noteSessionOpen(owner, report);
    await noteSessionOpen(owner, {...report, positionTicks: 5000});
    restartApp();
    const sendStop = jest.fn(async () => undefined);

    await expect(closeLeftoverSession(owner, sendStop)).resolves.toBe(true);

    expect(sendStop).toHaveBeenCalledWith({...report, positionTicks: 5000});
    await expect(getItem(KEY)).resolves.toBeNull();
  });

  it('is not reported again after a session that stopped normally', async () => {
    await noteSessionOpen(owner, report);
    await noteSessionClosed('play-1');
    restartApp();
    const sendStop = jest.fn(async () => undefined);

    await expect(closeLeftoverSession(owner, sendStop)).resolves.toBe(false);

    expect(sendStop).not.toHaveBeenCalled();
  });

  it('keeps the note when the server cannot be reached', async () => {
    await noteSessionOpen(owner, report);
    restartApp();

    await expect(
      closeLeftoverSession(owner, async () => {
        throw new Error('offline');
      }),
    ).rejects.toThrow('offline');

    await expect(getItem(KEY)).resolves.not.toBeNull();
  });

  it('leaves a note that belongs to another user or server', async () => {
    await noteSessionOpen(owner, report);
    restartApp();
    const sendStop = jest.fn(async () => undefined);

    await closeLeftoverSession({...owner, userId: 'user-2'}, sendStop);
    await closeLeftoverSession({...owner, serverUrl: 'http://other'}, sendStop);

    expect(sendStop).not.toHaveBeenCalled();
    await expect(getItem(KEY)).resolves.not.toBeNull();
  });

  it('does not stop the session that is playing now', async () => {
    await noteSessionOpen(owner, report);
    const sendStop = jest.fn(async () => undefined);

    await expect(closeLeftoverSession(owner, sendStop)).resolves.toBe(false);

    expect(sendStop).not.toHaveBeenCalled();
  });

  it('ignores a stop for a session that has since been replaced', async () => {
    await noteSessionOpen(owner, report);
    await noteSessionOpen(owner, {...report, playSessionId: 'play-2'});
    await noteSessionClosed('play-1');

    expect(removeItem).not.toHaveBeenCalled();
  });

  it('records nothing for a report without a play session', async () => {
    await noteSessionOpen(owner, {itemId: 'item-1'});

    expect(setItem).not.toHaveBeenCalled();
  });

  it('survives storage failing and a note it cannot read', async () => {
    (setItem as jest.Mock).mockRejectedValueOnce(new Error('disk'));
    await expect(noteSessionOpen(owner, report)).resolves.toBeUndefined();
    await setItem(KEY, '{not json');
    restartApp();

    await expect(
      closeLeftoverSession(
        owner,
        jest.fn(async () => undefined),
      ),
    ).resolves.toBe(false);
  });
});
