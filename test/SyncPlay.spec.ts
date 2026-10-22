import {
  SyncPlayManager,
  parseServerDate,
  type SyncPlayApi,
  type SyncPlayOpenRequest,
  type SyncPlayPlayer,
} from '../src/services/syncPlay';
import type {ServerSocketMessage} from '../src/services/serverSocket';

// The fake server clock runs this far ahead of the device.
const OFFSET_MS = 5000;
const T0 = Date.parse('2026-10-21T12:00:00.000Z');
const serverIso = (localMs: number) =>
  new Date(localMs + OFFSET_MS).toISOString();

const fakeApi = () => {
  const api = {
    list: jest.fn(async () => []),
    join: jest.fn(async () => undefined),
    leave: jest.fn(async () => undefined),
    pause: jest.fn(async () => undefined),
    unpause: jest.fn(async () => undefined),
    buffering: jest.fn(async () => undefined),
    ready: jest.fn(async () => undefined),
    ping: jest.fn(async () => undefined),
    utcTime: jest.fn(async () => {
      const server = Date.now() + OFFSET_MS;
      return {received: server, sent: server};
    }),
  };
  return api as typeof api & SyncPlayApi;
};

const fakePlayer = (itemId = 'item-1') => {
  let paused = false;
  let ticks = 0;
  const player = {
    itemId,
    getPositionTicks: jest.fn(() => ticks),
    isPaused: jest.fn(() => paused),
    play: jest.fn(() => {
      paused = false;
    }),
    pause: jest.fn(() => {
      paused = true;
    }),
    seekTicks: jest.fn(async (target: number) => {
      ticks = target;
    }),
    release: jest.fn(async () => undefined),
    exit: jest.fn(),
    setTicks: (next: number) => {
      ticks = next;
    },
  };
  return player as typeof player & SyncPlayPlayer;
};

const harness = () => {
  let listener: ((message: ServerSocketMessage) => void) | null = null;
  const api = fakeApi();
  const manager = new SyncPlayManager(
    {
      onMessage: (next) => {
        listener = next;
        return () => {
          listener = null;
        };
      },
    },
    () => api,
  );
  manager.setServer({serverUrl: 'http://server', accessToken: 'tok'});
  const opens: SyncPlayOpenRequest[] = [];
  manager.onOpenRequest((request) => opens.push(request));
  const send = (MessageType: string, Data: unknown) =>
    listener?.({MessageType, Data});
  const groupUpdate = (Type: string, Data?: unknown) =>
    send('SyncPlayGroupUpdate', {GroupId: 'g1', Type, Data});
  const command = (
    Command: string,
    whenLocalMs: number,
    PositionTicks: number,
    PlaylistItemId = 'pl-1',
  ) =>
    send('SyncPlayCommand', {
      GroupId: 'g1',
      PlaylistItemId,
      When: serverIso(whenLocalMs),
      PositionTicks,
      Command,
      EmittedAt: serverIso(Date.now()),
    });
  return {api, manager, opens, groupUpdate, command};
};

const flush = async () => {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve();
  }
};

/** Joins, receives a playing queue, and opens a started, paused player. */
const joinedAndReady = async () => {
  const h = harness();
  await h.manager.join('g1');
  h.groupUpdate('GroupJoined', {
    GroupId: 'g1',
    GroupName: 'Movie night',
    State: 'Waiting',
    Participants: ['levi'],
    LastUpdatedAt: serverIso(Date.now()),
  });
  h.groupUpdate('PlayQueue', {
    Reason: 'NewPlaylist',
    LastUpdate: serverIso(Date.now()),
    Playlist: [{ItemId: 'item-1', PlaylistItemId: 'pl-1'}],
    PlayingItemIndex: 0,
    StartPositionTicks: 0,
    IsPlaying: false,
  });
  const player = fakePlayer();
  h.manager.attachPlayer(player);
  h.manager.notifyPlayerStarted(player);
  await flush();
  h.api.ready.mockClear();
  return {...h, player};
};

describe('parseServerDate', () => {
  it('reads the seven-digit fractions .NET writes', () => {
    expect(parseServerDate('2026-10-21T12:00:00.1234567Z')).toBe(
      Date.parse('2026-10-21T12:00:00.123Z'),
    );
  });
});

describe('SyncPlayManager', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(T0);
  });
  afterEach(() => jest.useRealTimers());

  it('measures the server clock before joining and keeps the fastest sample', async () => {
    const h = harness();
    let call = 0;
    h.api.utcTime.mockImplementation(async () => {
      call += 1;
      // The third reply is the quickest round trip and the honest one.
      const networkMs = call === 3 ? 10 : 300;
      const server = Date.now() + OFFSET_MS + networkMs / 2;
      jest.setSystemTime(Date.now() + networkMs);
      return {received: server, sent: server};
    });
    await h.manager.join('g1');
    expect(h.api.join).toHaveBeenCalledWith('g1');
    expect(h.manager.getSnapshot()).toMatchObject({
      clockOffsetMs: OFFSET_MS,
      pingMs: 10,
    });
    expect(h.api.ping).toHaveBeenCalledWith(10);
  });

  it('opens the group item where a playing group has got to', async () => {
    const h = harness();
    await h.manager.join('g1');
    h.groupUpdate('GroupJoined', {
      GroupId: 'g1',
      GroupName: 'Movie night',
      State: 'Playing',
      Participants: ['levi'],
      LastUpdatedAt: serverIso(Date.now()),
    });
    const queue = {
      Reason: 'NewPlaylist',
      // Stamped three seconds ago at one minute in.
      LastUpdate: serverIso(Date.now() - 3000),
      Playlist: [{ItemId: 'item-1', PlaylistItemId: 'pl-1'}],
      PlayingItemIndex: 0,
      StartPositionTicks: 60 * 1e7,
      IsPlaying: true,
    };
    h.groupUpdate('PlayQueue', queue);
    expect(h.opens).toEqual([
      {itemId: 'item-1', startPositionTicks: 63 * 1e7, nonce: 1},
    ]);
    // The same update again is not newer, so nothing reopens.
    h.groupUpdate('PlayQueue', queue);
    expect(h.opens).toHaveLength(1);
    expect(h.manager.getSnapshot()).toMatchObject({
      state: 'Playing',
      playingItemId: 'item-1',
      lastEvent: 'Joined Movie night',
    });
  });

  it('holds a started player paused and tells the group it is ready', async () => {
    const h = harness();
    await h.manager.join('g1');
    h.groupUpdate('GroupJoined', {
      GroupId: 'g1',
      GroupName: 'Movie night',
      State: 'Waiting',
      Participants: ['levi'],
      LastUpdatedAt: serverIso(Date.now()),
    });
    h.groupUpdate('PlayQueue', {
      Reason: 'NewPlaylist',
      LastUpdate: serverIso(Date.now()),
      Playlist: [{ItemId: 'item-1', PlaylistItemId: 'pl-1'}],
      PlayingItemIndex: 0,
      StartPositionTicks: 5e7,
      IsPlaying: false,
    });
    const player = fakePlayer();
    player.setTicks(5e7);
    h.manager.attachPlayer(player);
    h.manager.notifyPlayerStarted(player);
    expect(player.pause).toHaveBeenCalled();
    expect(h.api.ready).toHaveBeenCalledWith({
      When: serverIso(Date.now()),
      PositionTicks: 5e7,
      IsPlaying: false,
      PlaylistItemId: 'pl-1',
    });
    // A reload later in the session is not a fresh start.
    h.manager.notifyPlayerStarted(player);
    expect(h.api.ready).toHaveBeenCalledTimes(1);
  });

  it('plays at the scheduled moment, moving to the position first', async () => {
    const {command, player} = await joinedAndReady();
    command('Unpause', Date.now() + 800, 2e7);
    await flush();
    expect(player.seekTicks).toHaveBeenCalledWith(2e7, false);
    expect(player.play).not.toHaveBeenCalled();
    jest.advanceTimersByTime(799);
    expect(player.play).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(player.play).toHaveBeenCalledTimes(1);
    // The server can send the same command twice.
    command('Unpause', Date.now() - 1, 2e7);
    command('Unpause', Date.now() - 1, 2e7);
    expect(player.play).toHaveBeenCalledTimes(2);
  });

  it('catches up when an unpause arrives late', async () => {
    const {command, player} = await joinedAndReady();
    command('Unpause', Date.now() - 2000, 10e7);
    await flush();
    expect(player.play).toHaveBeenCalled();
    expect(player.seekTicks).toHaveBeenCalledWith(12e7, false);
  });

  it('pauses and settles on the group position', async () => {
    const {command, player} = await joinedAndReady();
    player.setTicks(30e7);
    command('Pause', Date.now(), 30.2e7);
    await flush();
    expect(player.pause).toHaveBeenCalled();
    // Within the tolerance, so the frame on screen stays.
    expect(player.seekTicks).not.toHaveBeenCalled();
  });

  it('seeks, then reports ready from the new position', async () => {
    const {api, command, player} = await joinedAndReady();
    command('Seek', Date.now(), 90e7);
    await flush();
    expect(player.seekTicks).toHaveBeenCalledWith(90e7, true);
    expect(api.ready).toHaveBeenCalledWith(
      expect.objectContaining({PositionTicks: 90e7, IsPlaying: false}),
    );
  });

  it('ignores commands meant for another item', async () => {
    const {command, player} = await joinedAndReady();
    command('Pause', Date.now(), 0, 'pl-other');
    expect(player.pause).toHaveBeenCalledTimes(1); // only the start hold
  });

  it('stays in the group when it stops, and leaves when the viewer backs out', async () => {
    const {api, command, manager, player} = await joinedAndReady();
    command('Stop', Date.now(), 0);
    expect(player.exit).toHaveBeenCalled();
    manager.playerClosed();
    expect(api.leave).not.toHaveBeenCalled();
    manager.playerClosed();
    await flush();
    expect(api.leave).toHaveBeenCalled();
    expect(manager.isInGroup()).toBe(false);
  });

  it('keeps the group through the screensaver and reopens on return', async () => {
    const {api, command, manager, opens, player} = await joinedAndReady();
    manager.playerBackgrounded(player);
    manager.playerClosed();
    // The screen unmounts and lets go of the player.
    manager.attachPlayer(player)();
    await flush();
    expect(api.leave).not.toHaveBeenCalled();
    // The group moved on while the app was away.
    jest.advanceTimersByTime(60000);
    command('Pause', Date.now(), 42e7);
    manager.appResumed();
    expect(opens[opens.length - 1]).toMatchObject({
      itemId: 'item-1',
      startPositionTicks: 42e7,
    });
    // Coming back again without a background does nothing.
    const count = opens.length;
    manager.appResumed();
    expect(opens).toHaveLength(count);
  });

  it('reports only stalls that last, then ready once playing again', async () => {
    const {api, manager, player} = await joinedAndReady();
    manager.notifyPlayerBuffering(player);
    jest.advanceTimersByTime(500);
    manager.notifyPlayerPlaying(player);
    jest.advanceTimersByTime(1000);
    expect(api.buffering).not.toHaveBeenCalled();
    expect(api.ready).not.toHaveBeenCalled();

    player.play();
    manager.notifyPlayerBuffering(player);
    jest.advanceTimersByTime(1000);
    expect(api.buffering).toHaveBeenCalledWith(
      expect.objectContaining({IsPlaying: true, PlaylistItemId: 'pl-1'}),
    );
    manager.notifyPlayerPlaying(player);
    expect(api.ready).toHaveBeenCalledWith(
      expect.objectContaining({IsPlaying: true}),
    );
  });

  it('keeps quiet about loading while held paused', async () => {
    // Seen on a Fire TV: the stream kept loading after the start hold, and a
    // Buffering report sent the ready group back to waiting for good.
    const {api, manager, player} = await joinedAndReady();
    expect(player.isPaused()).toBe(true);
    manager.notifyPlayerBuffering(player);
    jest.advanceTimersByTime(5000);
    expect(api.buffering).not.toHaveBeenCalled();
  });

  it('routes the viewer’s play and pause through the group', async () => {
    const {api, manager} = await joinedAndReady();
    expect(manager.controlsPlayer('item-1')).toBe(true);
    expect(manager.controlsPlayer('something-else')).toBe(false);
    manager.requestPause();
    manager.requestUnpause();
    expect(api.pause).toHaveBeenCalled();
    expect(api.unpause).toHaveBeenCalled();
  });

  it('explains a refusal and forgets the group when the server drops it', async () => {
    const {groupUpdate, manager} = await joinedAndReady();
    groupUpdate('LibraryAccessDenied');
    expect(manager.getSnapshot().lastError).toMatch(/cannot see/);
    groupUpdate('NotInGroup');
    expect(manager.isInGroup()).toBe(false);
    expect(manager.controlsPlayer('item-1')).toBe(false);
  });
});
