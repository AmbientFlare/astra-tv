/**
 * SyncPlay, as a follower: joins a group someone else made and keeps this
 * device's player in step with it.
 *
 * The server runs the group. It pushes the play queue and timed commands
 * over the live socket; this side opens the right item, holds it paused until
 * the server says go, and reports when it is ready or buffering. Commands
 * carry a server timestamp, so the server clock offset is measured first and
 * every command is scheduled on the local clock.
 *
 * The behaviour follows jellyfin-web's SyncPlay client, so Astra and a browser
 * in the same group agree on what each message means.
 */
import {
  type ServerSocketMessage,
  serverSocket as defaultSocket,
} from '../serverSocket';
import * as storageAdapter from '../storageAdapter';
import {
  type SyncPlayApi,
  type SyncPlayCommand,
  type SyncPlayGroupInfo,
  type SyncPlayGroupState,
  type SyncPlayGroupUpdate,
  type SyncPlayQueueUpdate,
  createSyncPlayApi,
  parseServerDate,
} from './api';

export * from './api';

const TICKS_PER_MS = 10000;
/** Off by less than this, a command plays from where the player already is. */
const SEEK_TOLERANCE_TICKS = 400 * TICKS_PER_MS;
/** A stall shorter than this is not worth stopping the whole group for. */
const BUFFERING_REPORT_DELAY_MS = 1000;
const TIME_SYNC_SAMPLES = 5;
const TIME_SYNC_INTERVAL_MS = 60000;
const MEMBERSHIP_KEY = 'astra.syncPlay.membership';
/** A group left behind longer ago than this is not rejoined on its own. */
const REJOIN_WINDOW_MS = 12 * 60 * 60 * 1000;

/** What SyncPlay needs from the player on screen. */
export interface SyncPlayPlayer {
  itemId: string;
  getPositionTicks(): number;
  isPaused(): boolean;
  play(): void;
  pause(): void;
  /**
   * Moves without starting playback; resolves once the frame is there. A
   * move the loaded stream cannot reach needs a full reload, which takes
   * seconds; without allowReload such a move is skipped.
   */
  seekTicks(ticks: number, allowReload: boolean): Promise<void>;
  /** Releases the media without leaving the screen, ahead of a new item. */
  release(): Promise<void>;
  /** Stops and leaves the player screen. */
  exit(): void;
}

export interface SyncPlayOpenRequest {
  itemId: string;
  startPositionTicks: number;
  /** Changes for every request so a re-sent item still reopens. */
  nonce: number;
}

export interface SyncPlaySnapshot {
  group: SyncPlayGroupInfo | null;
  state: SyncPlayGroupState | null;
  /** The last thing the group did, for the status line. */
  lastEvent: string | null;
  lastError: string | null;
  /** Server clock minus local clock, ms; null before the first sync. */
  clockOffsetMs: number | null;
  pingMs: number | null;
  playingItemId: string | null;
}

interface Timers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

interface SocketSource {
  onMessage(listener: (message: ServerSocketMessage) => void): () => void;
  onStateChange?(listener: (snapshot: {status: string}) => void): () => void;
  getSnapshot?(): {status: string};
}

interface MembershipStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** The group this device was last in, kept so a restart can rejoin it. */
interface SavedMembership {
  serverUrl: string;
  userId?: string;
  groupId: string;
  groupName: string;
  savedAtMs: number;
}

interface SyncPlayTarget {
  serverUrl: string;
  accessToken: string;
  userId?: string;
}

const defaultTimers: Timers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (handler, ms) => setInterval(handler, ms),
  clearInterval: (handle) =>
    clearInterval(handle as ReturnType<typeof setInterval>),
};

const emptySnapshot = (): SyncPlaySnapshot => ({
  group: null,
  state: null,
  lastEvent: null,
  lastError: null,
  clockOffsetMs: null,
  pingMs: null,
  playingItemId: null,
});

const GROUP_ERRORS: Record<string, string> = {
  GroupDoesNotExist: 'That group has ended.',
  CreateGroupDenied: 'This account may not create SyncPlay groups.',
  JoinGroupDenied: 'This account may not join SyncPlay groups.',
  LibraryAccessDenied:
    'This account cannot see everything the group is playing.',
  SyncPlayIsDisabled: 'SyncPlay is turned off for this account.',
};

export class SyncPlayManager {
  private api: SyncPlayApi | null = null;
  private snapshot = emptySnapshot();
  private player: SyncPlayPlayer | null = null;
  private playlistItemId: string | null = null;
  private lastQueueUpdateMs = 0;
  private lastCommandKey: string | null = null;
  private lastCommand: SyncPlayCommand | null = null;
  /** Set between opening an item and telling the server it is ready. */
  private awaitingStart = false;
  /** Our own seeks fire buffering events the group must not hear about. */
  private applyingCommand = false;
  private commandTimer: unknown = null;
  private bufferingTimer: unknown = null;
  private reportedBuffering = false;
  private exitByCommand = false;
  /** The player went away with the app; reopen the group item on return. */
  private reopenOnResume = false;
  private inBackground = false;
  private lastQueue: SyncPlayQueueUpdate | null = null;
  private timeSyncTimer: unknown = null;
  private openNonce = 0;
  private readonly listeners = new Set<(snapshot: SyncPlaySnapshot) => void>();
  private readonly openListeners = new Set<
    (request: SyncPlayOpenRequest) => void
  >();
  private unsubscribeSocket: (() => void) | null = null;
  private target: SyncPlayTarget | null = null;
  private pendingRejoin: SavedMembership | null = null;
  private rejoining = false;

  constructor(
    private readonly socket: SocketSource = defaultSocket,
    private readonly makeApi: (
      serverUrl: string,
      accessToken: string,
    ) => SyncPlayApi = createSyncPlayApi,
    private readonly now: () => number = Date.now,
    private readonly timers: Timers = defaultTimers,
    private readonly store: MembershipStore = storageAdapter,
  ) {}

  /** Points SyncPlay at the signed-in server; null on sign-out. */
  setServer(target: SyncPlayTarget | null): void {
    this.reset();
    this.unsubscribeSocket?.();
    this.unsubscribeSocket = null;
    this.target = target;
    this.pendingRejoin = null;
    this.api = target
      ? this.makeApi(target.serverUrl, target.accessToken)
      : null;
    if (this.api) {
      const offMessage = this.socket.onMessage((message) =>
        this.handleMessage(message),
      );
      // The server answers a join on the socket, so a rejoin waits for it.
      const offState = this.socket.onStateChange?.((snapshot) => {
        if (snapshot.status === 'open') {
          void this.tryRejoin();
        }
      });
      this.unsubscribeSocket = () => {
        offMessage();
        offState?.();
      };
      void this.loadMembership(target as SyncPlayTarget);
    }
  }

  /**
   * A device that was in a group when the app closed without leaving (the
   * system ended it, or an update replaced it) goes back in when it starts,
   * as long as the group is still running. Leaving on purpose forgets it.
   */
  private async loadMembership(target: SyncPlayTarget): Promise<void> {
    let saved: SavedMembership | null = null;
    try {
      const raw = await this.store.getItem(MEMBERSHIP_KEY);
      saved = raw ? (JSON.parse(raw) as SavedMembership) : null;
    } catch {
      return;
    }
    if (
      this.target !== target ||
      !saved?.groupId ||
      saved.serverUrl !== target.serverUrl ||
      (saved.userId ?? null) !== (target.userId ?? null) ||
      this.now() - saved.savedAtMs > REJOIN_WINDOW_MS
    ) {
      return;
    }
    this.pendingRejoin = saved;
    await this.tryRejoin();
  }

  private async tryRejoin(): Promise<void> {
    const saved = this.pendingRejoin;
    const api = this.api;
    if (
      !saved ||
      !api ||
      this.rejoining ||
      this.snapshot.group ||
      (this.socket.getSnapshot && this.socket.getSnapshot().status !== 'open')
    ) {
      return;
    }
    this.rejoining = true;
    try {
      const groups = await api.list();
      if (this.api !== api || this.pendingRejoin !== saved) {
        return;
      }
      this.pendingRejoin = null;
      if (!groups.some((group) => group.GroupId === saved.groupId)) {
        this.forgetMembership();
        return;
      }
      this.update({lastEvent: `Rejoining ${saved.groupName}`});
      await this.join(saved.groupId);
    } catch {
      // Left pending: the next time the socket opens tries again.
    } finally {
      this.rejoining = false;
    }
  }

  private saveMembership(group: SyncPlayGroupInfo): void {
    if (!this.target) {
      return;
    }
    const saved: SavedMembership = {
      serverUrl: this.target.serverUrl,
      userId: this.target.userId,
      groupId: group.GroupId,
      groupName: group.GroupName,
      savedAtMs: this.now(),
    };
    this.store
      .setItem(MEMBERSHIP_KEY, JSON.stringify(saved))
      .catch(() => undefined);
  }

  private forgetMembership(): void {
    this.pendingRejoin = null;
    this.store.removeItem(MEMBERSHIP_KEY).catch(() => undefined);
  }

  isInGroup(): boolean {
    return this.snapshot.group !== null;
  }

  getSnapshot(): SyncPlaySnapshot {
    return {...this.snapshot};
  }

  onChange(listener: (snapshot: SyncPlaySnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The navigator listens here to open the group's item. */
  onOpenRequest(listener: (request: SyncPlayOpenRequest) => void): () => void {
    this.openListeners.add(listener);
    return () => this.openListeners.delete(listener);
  }

  listGroups(): Promise<SyncPlayGroupInfo[]> {
    return this.requireApi().list();
  }

  /** Starts a group with this device in it; nothing plays until asked. */
  async create(groupName: string): Promise<void> {
    await this.syncClock();
    await this.requireApi().create(groupName);
  }

  async join(groupId: string): Promise<void> {
    await this.syncClock();
    // The server answers on the socket: GroupJoined, then the play queue.
    await this.requireApi().join(groupId);
  }

  async leave(): Promise<void> {
    this.forgetMembership();
    if (!this.api) {
      return;
    }
    try {
      await this.api.leave();
    } finally {
      this.reset();
    }
  }

  /** Local pause/play while in a group asks the group instead. */
  requestPause(): void {
    void this.api?.pause().catch(() => this.fail('Pause request failed.'));
  }

  requestUnpause(): void {
    void this.api?.unpause().catch(() => this.fail('Play request failed.'));
  }

  requestSeek(ticks: number): void {
    void this.api
      ?.seek(Math.max(0, ticks))
      .catch(() => this.fail('Seek request failed.'));
  }

  /**
   * Playing something while in a group plays it for the whole group. The
   * server sends the new queue to every member, and this device opens it
   * from that like everyone else.
   */
  async requestPlay(itemId: string, startPositionTicks: number): Promise<void> {
    try {
      await this.requireApi().setNewQueue(
        [itemId],
        Math.max(0, startPositionTicks),
      );
    } catch (error) {
      this.fail('Could not start that for the group.');
      throw error;
    }
  }

  /** Whether the group, not the viewer's keys, drives this item's player. */
  controlsPlayer(itemId: string): boolean {
    return this.isInGroup() && this.snapshot.playingItemId === itemId;
  }

  /** Frees the player on screen so the group's next item can open. */
  async releasePlayer(): Promise<void> {
    await this.player?.release();
  }

  /**
   * The player screen closed. Leaving it by hand leaves the group too, so a
   * device nobody is watching never holds the others at "waiting"; a Stop
   * from the group closes it without leaving.
   */
  playerClosed(): void {
    if (this.exitByCommand) {
      this.exitByCommand = false;
      return;
    }
    if (this.reopenOnResume) {
      // Releasing the media can take longer than the app takes to come
      // back; if it is already back, reopen now.
      if (!this.inBackground) {
        this.reopenCurrent();
      }
      return;
    }
    if (this.isInGroup()) {
      void this.leave().catch(() => undefined);
    }
  }

  /**
   * The app is going to the background (the screensaver does this to a
   * paused player) and the player is about to release its media. That is
   * not the viewer leaving, so the group membership stays.
   */
  playerBackgrounded(player: SyncPlayPlayer): void {
    if (this.isTracking(player)) {
      this.reopenOnResume = true;
      this.inBackground = true;
    }
  }

  /** The app is back on screen: reopen the group item where the group is. */
  appResumed(): void {
    this.inBackground = false;
    // A player still on screen has not closed yet; playerClosed reopens.
    if (this.reopenOnResume && !this.player) {
      this.reopenCurrent();
    }
  }

  private reopenCurrent(): void {
    this.reopenOnResume = false;
    if (this.isInGroup() && this.lastQueue) {
      this.openCurrent(this.lastQueue);
    }
  }

  attachPlayer(player: SyncPlayPlayer): () => void {
    this.player = player;
    return () => {
      if (this.player === player) {
        this.player = null;
      }
    };
  }

  /** The player has started its stream (also after a reload). */
  notifyPlayerStarted(player: SyncPlayPlayer): void {
    if (this.player !== player || !this.awaitingStart || !this.isInGroup()) {
      return;
    }
    if (player.itemId !== this.snapshot.playingItemId) {
      return;
    }
    this.awaitingStart = false;
    player.pause();
    this.reportReady(false);
  }

  notifyPlayerBuffering(player: SyncPlayPlayer): void {
    // A paused player still loads behind its frame, and a stall it reports
    // would hold the group with no "playing" event to release it. Only a
    // stall during playback is the group's business.
    if (!this.isTracking(player) || player.isPaused()) {
      return;
    }
    if (this.bufferingTimer !== null) {
      return;
    }
    this.bufferingTimer = this.timers.setTimeout(() => {
      this.bufferingTimer = null;
      if (!this.isTracking(player) || player.isPaused()) {
        return;
      }
      this.reportedBuffering = true;
      void this.api
        ?.buffering(this.report(!player.isPaused()))
        .catch(() => undefined);
    }, BUFFERING_REPORT_DELAY_MS);
  }

  notifyPlayerPlaying(player: SyncPlayPlayer): void {
    if (this.bufferingTimer !== null) {
      this.timers.clearTimeout(this.bufferingTimer);
      this.bufferingTimer = null;
    }
    if (!this.reportedBuffering || !this.isTracking(player)) {
      return;
    }
    this.reportedBuffering = false;
    this.reportReady(true);
  }

  /** Server time now, in the format SyncPlay requests carry. */
  private serverNowIso(): string {
    return new Date(
      this.now() + (this.snapshot.clockOffsetMs ?? 0),
    ).toISOString();
  }

  private toLocalMs(serverIso: string): number {
    return parseServerDate(serverIso) - (this.snapshot.clockOffsetMs ?? 0);
  }

  /** Where a position stamped at `when` has moved to by now. */
  private estimateTicks(ticks: number, when: string): number {
    return ticks + (this.now() - this.toLocalMs(when)) * TICKS_PER_MS;
  }

  private isTracking(player: SyncPlayPlayer): boolean {
    return (
      this.player === player &&
      this.isInGroup() &&
      !this.awaitingStart &&
      !this.applyingCommand
    );
  }

  private report(isPlaying: boolean) {
    return {
      When: this.serverNowIso(),
      PositionTicks: Math.max(
        0,
        Math.round(this.player?.getPositionTicks() ?? 0),
      ),
      IsPlaying: isPlaying,
      PlaylistItemId: this.playlistItemId ?? '',
    };
  }

  private reportReady(isPlaying: boolean): void {
    void this.api
      ?.ready(this.report(isPlaying))
      .catch(() => this.fail('Could not tell the group this device is ready.'));
  }

  /**
   * Measures the server clock with a few /GetUtcTime round trips and keeps
   * the one with the shortest network time, which is the least skewed.
   */
  private async syncClock(): Promise<void> {
    const api = this.requireApi();
    let best: {offset: number; rtt: number} | null = null;
    for (let sample = 0; sample < TIME_SYNC_SAMPLES; sample += 1) {
      try {
        const sentAt = this.now();
        const {received, sent} = await api.utcTime();
        const receivedAt = this.now();
        const rtt = receivedAt - sentAt - (sent - received);
        const offset = (received - sentAt + (sent - receivedAt)) / 2;
        if (!best || rtt < best.rtt) {
          best = {offset, rtt: Math.max(0, rtt)};
        }
      } catch {
        // One lost sample is fine; the rest still give an estimate.
      }
    }
    if (!best) {
      this.fail('Could not read the server clock.');
      return;
    }
    this.update({clockOffsetMs: best.offset, pingMs: best.rtt});
    void api.ping(best.rtt).catch(() => undefined);
  }

  private startClockRefresh(): void {
    if (this.timeSyncTimer !== null) {
      return;
    }
    this.timeSyncTimer = this.timers.setInterval(() => {
      void this.syncClock();
    }, TIME_SYNC_INTERVAL_MS);
  }

  private handleMessage(message: ServerSocketMessage): void {
    if (message.MessageType === 'SyncPlayGroupUpdate') {
      this.handleGroupUpdate(message.Data as SyncPlayGroupUpdate);
    } else if (message.MessageType === 'SyncPlayCommand') {
      this.handleCommand(message.Data as SyncPlayCommand);
    }
  }

  private handleGroupUpdate(update: SyncPlayGroupUpdate | undefined): void {
    if (!update || typeof update.Type !== 'string') {
      return;
    }
    switch (update.Type) {
      case 'GroupJoined':
      case 'GroupUpdate': {
        const group = update.Data as SyncPlayGroupInfo;
        this.update({
          group,
          state: group.State,
          lastEvent:
            update.Type === 'GroupJoined'
              ? `Joined ${group.GroupName}`
              : this.snapshot.lastEvent,
          lastError: null,
        });
        this.startClockRefresh();
        this.saveMembership(group);
        break;
      }
      case 'UserJoined':
      case 'UserLeft': {
        const name = String(update.Data ?? 'Someone');
        const group = this.snapshot.group;
        const participants = group
          ? update.Type === 'UserJoined'
            ? [...group.Participants, name]
            : group.Participants.filter((participant) => participant !== name)
          : [];
        this.update({
          group: group ? {...group, Participants: participants} : null,
          lastEvent: `${name} ${
            update.Type === 'UserJoined' ? 'joined' : 'left'
          }`,
        });
        break;
      }
      case 'StateUpdate': {
        const data = update.Data as {State?: SyncPlayGroupState};
        if (data?.State) {
          this.update({state: data.State});
        }
        break;
      }
      case 'PlayQueue':
        this.applyPlayQueue(update.Data as SyncPlayQueueUpdate);
        break;
      case 'GroupLeft':
      case 'NotInGroup':
        this.forgetMembership();
        this.reset();
        this.update({lastEvent: 'Left the group'});
        break;
      default:
        if (GROUP_ERRORS[update.Type]) {
          this.fail(GROUP_ERRORS[update.Type]);
        }
    }
  }

  private applyPlayQueue(queue: SyncPlayQueueUpdate | undefined): void {
    if (!queue || !Array.isArray(queue.Playlist)) {
      return;
    }
    const updatedAt = parseServerDate(queue.LastUpdate);
    if (updatedAt <= this.lastQueueUpdateMs) {
      return;
    }
    this.lastQueueUpdateMs = updatedAt;
    this.lastQueue = queue;

    const current = queue.Playlist[queue.PlayingItemIndex];
    if (!current) {
      this.playlistItemId = null;
      this.update({playingItemId: null});
      return;
    }
    const opensItem =
      queue.Reason === 'NewPlaylist' ||
      queue.Reason === 'SetCurrentItem' ||
      queue.Reason === 'NextItem' ||
      queue.Reason === 'PreviousItem' ||
      current.PlaylistItemId !== this.playlistItemId;
    this.playlistItemId = current.PlaylistItemId;
    this.update({playingItemId: current.ItemId});
    if (opensItem) {
      this.openCurrent(queue);
    }
  }

  private openCurrent(queue: SyncPlayQueueUpdate): void {
    const current = queue.Playlist[queue.PlayingItemIndex];
    if (!current) {
      return;
    }
    const updatedAt = parseServerDate(queue.LastUpdate);
    let startTicks = queue.IsPlaying
      ? this.estimateTicks(queue.StartPositionTicks, queue.LastUpdate)
      : queue.StartPositionTicks;
    // A command newer than the queue knows the position better.
    const command = this.lastCommand;
    if (
      command &&
      command.PlaylistItemId === current.PlaylistItemId &&
      parseServerDate(command.When) > updatedAt
    ) {
      startTicks =
        command.Command === 'Unpause'
          ? this.estimateTicks(command.PositionTicks, command.When)
          : command.PositionTicks;
    }

    this.awaitingStart = true;
    this.openNonce += 1;
    const request: SyncPlayOpenRequest = {
      itemId: current.ItemId,
      startPositionTicks: Math.max(0, Math.round(startTicks)),
      nonce: this.openNonce,
    };
    this.openListeners.forEach((listener) => listener(request));
  }

  private handleCommand(command: SyncPlayCommand | undefined): void {
    if (!command || !this.isInGroup()) {
      return;
    }
    const key = `${command.Command}|${command.When}|${command.PositionTicks}|${command.PlaylistItemId}`;
    if (key === this.lastCommandKey) {
      return;
    }
    this.lastCommandKey = key;
    this.lastCommand = command;
    this.update({lastEvent: command.Command});

    const player = this.player;
    if (
      !player ||
      player.itemId !== this.snapshot.playingItemId ||
      command.PlaylistItemId !== this.playlistItemId
    ) {
      // Nothing to steer yet; the queue start will use lastCommand.
      return;
    }
    if (this.commandTimer !== null) {
      this.timers.clearTimeout(this.commandTimer);
      this.commandTimer = null;
    }
    const delayMs = this.toLocalMs(command.When) - this.now();
    const later = (action: () => void) => {
      if (delayMs <= 0) {
        action();
        return;
      }
      this.commandTimer = this.timers.setTimeout(() => {
        this.commandTimer = null;
        if (this.player === player) {
          action();
        }
      }, delayMs);
    };

    switch (command.Command) {
      case 'Unpause':
        if (delayMs > 0) {
          void this.seekIfOff(player, command.PositionTicks).then(() =>
            later(() => player.play()),
          );
        } else {
          player.play();
          void this.seekIfOff(
            player,
            this.estimateTicks(command.PositionTicks, command.When),
          );
        }
        break;
      case 'Pause':
        later(() => {
          player.pause();
          void this.seekIfOff(player, command.PositionTicks);
        });
        break;
      case 'Seek':
        later(() => {
          player.pause();
          void this.seekIfOff(player, command.PositionTicks, true).then(() => {
            if (this.player === player) {
              this.reportReady(false);
            }
          });
        });
        break;
      case 'Stop':
        later(() => {
          this.exitByCommand = true;
          player.exit();
        });
        break;
    }
  }

  private async seekIfOff(
    player: SyncPlayPlayer,
    ticks: number,
    always = false,
  ): Promise<void> {
    const target = Math.max(0, Math.round(ticks));
    if (
      !always &&
      Math.abs(player.getPositionTicks() - target) <= SEEK_TOLERANCE_TICKS
    ) {
      return;
    }
    this.applyingCommand = true;
    try {
      // Only a group seek is worth a reload. A catch-up that needs one would
      // stall this player far longer than the drift it corrects.
      await player.seekTicks(target, always);
    } catch {
      this.fail('Could not move to the group position.');
    } finally {
      this.applyingCommand = false;
    }
  }

  private requireApi(): SyncPlayApi {
    if (!this.api) {
      throw new Error('Sign in to a server first.');
    }
    return this.api;
  }

  private fail(message: string): void {
    this.update({lastError: message});
  }

  private reset(): void {
    for (const timer of [this.commandTimer, this.bufferingTimer]) {
      if (timer !== null) {
        this.timers.clearTimeout(timer);
      }
    }
    if (this.timeSyncTimer !== null) {
      this.timers.clearInterval(this.timeSyncTimer);
    }
    this.commandTimer = null;
    this.bufferingTimer = null;
    this.timeSyncTimer = null;
    this.playlistItemId = null;
    this.lastQueueUpdateMs = 0;
    this.lastCommandKey = null;
    this.lastCommand = null;
    this.awaitingStart = false;
    this.reopenOnResume = false;
    this.inBackground = false;
    this.lastQueue = null;
    this.applyingCommand = false;
    this.reportedBuffering = false;
    const {clockOffsetMs, pingMs} = this.snapshot;
    this.snapshot = {...emptySnapshot(), clockOffsetMs, pingMs};
    this.emit();
  }

  private update(patch: Partial<SyncPlaySnapshot>): void {
    this.snapshot = {...this.snapshot, ...patch};
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch {
        // A screen's listener must never break the group.
      }
    });
  }
}

export const syncPlay = new SyncPlayManager();
