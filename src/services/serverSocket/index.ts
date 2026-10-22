/**
 * The live connection to the Jellyfin server.
 *
 * Everything else Astra does is request/response. The server can only push
 * to a client over its session WebSocket: remote control from the dashboard,
 * and SyncPlay's group updates and timed play/pause/seek commands, all arrive
 * here. Nothing reacts to those messages yet; this layer only keeps the
 * socket open, answers the server's keep-alive and records what it saw so the
 * connection can be checked on a real device.
 */
import {getDeviceId, initializeDeviceIdentity} from '../deviceIdentity';
import {buildUrl, getAuthHeaders, getJson} from '../jellyfin/http';

export type ServerSocketStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'waiting'
  | 'stopped';

export interface ServerSocketMessage {
  MessageType: string;
  Data?: unknown;
  MessageId?: string;
}

export interface ServerSocketEvent {
  type: string;
  atMs: number;
}

export interface ServerSocketSnapshot {
  status: ServerSocketStatus;
  /** When the current connection opened; null while not open. */
  openedAtMs: number | null;
  lastMessageAtMs: number | null;
  messagesReceived: number;
  /** Interval the server asked for via ForceKeepAlive; null until it asks. */
  keepAliveIntervalMs: number | null;
  keepAlivesSent: number;
  /** Connections opened since connect() was called, the first included. */
  opens: number;
  lastCloseCode: number | null;
  lastError: string | null;
  /** Recent inbound message types, oldest first. */
  recent: ServerSocketEvent[];
}

interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: {data?: unknown}) => void) | null;
  onerror: ((event: {message?: string}) => void) | null;
  onclose: ((event: {code?: number; reason?: string}) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

type SocketFactory = (
  url: string,
  headers: Record<string, string>,
) => SocketLike;

const RECENT_CAPACITY = 12;
const RECONNECT_START_MS = 1000;
const RECONNECT_MAX_MS = 30000;

/**
 * ws(s)://host:port/base/socket?api_key=…&deviceId=… for an http(s) server URL.
 *
 * The port is always written out: Kepler's native WebSocket parses the URL
 * with curl and refuses one without a port ("failed to parse requested part
 * with error code 15", CURLUE_NO_PORT), closing with code 1 and no error.
 *
 * The token goes in as `ApiKey`, not the older `api_key`: Jellyfin 10.11 with
 * legacy authorization off refuses `api_key` with a bare 403. The auth
 * headers sent alongside cover servers that predate `ApiKey`.
 */
export const buildSocketUrl = (
  serverUrl: string,
  accessToken: string,
  deviceId: string,
): string => {
  const url = new URL('socket', `${serverUrl.replace(/\/+$/, '')}/`);
  const secure = url.protocol === 'https:';
  const port = url.port || (secure ? '443' : '80');
  const query = `ApiKey=${encodeURIComponent(
    accessToken,
  )}&deviceId=${encodeURIComponent(deviceId)}`;
  // Built by hand because URL drops a default port when it serializes.
  return `${secure ? 'wss' : 'ws'}://${url.hostname}:${port}${
    url.pathname
  }?${query}`;
};

const emptySnapshot = (): ServerSocketSnapshot => ({
  status: 'idle',
  openedAtMs: null,
  lastMessageAtMs: null,
  messagesReceived: 0,
  keepAliveIntervalMs: null,
  keepAlivesSent: 0,
  opens: 0,
  lastCloseCode: null,
  lastError: null,
  recent: [],
});

const defaultFactory: SocketFactory = (socketUrl, headers) =>
  new (
    global as unknown as {
      WebSocket: new (
        url: string,
        protocols: undefined,
        options: {headers: Record<string, string>},
      ) => SocketLike;
    }
  ).WebSocket(socketUrl, undefined, {headers});

export class ServerSocket {
  private socket: SocketLike | null = null;
  private target: {serverUrl: string; accessToken: string} | null = null;
  private snapshot = emptySnapshot();
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelayMs = RECONNECT_START_MS;
  private readonly messageListeners = new Set<
    (message: ServerSocketMessage) => void
  >();
  private readonly stateListeners = new Set<
    (snapshot: ServerSocketSnapshot) => void
  >();

  constructor(
    private readonly createSocket: SocketFactory = defaultFactory,
    private readonly now: () => number = Date.now,
  ) {}

  /** Opens (or re-targets) the connection. Same target twice is a no-op. */
  connect(serverUrl: string, accessToken: string): void {
    if (
      this.target?.serverUrl === serverUrl &&
      this.target.accessToken === accessToken &&
      this.snapshot.status !== 'stopped'
    ) {
      return;
    }
    this.teardown();
    this.target = {serverUrl, accessToken};
    this.snapshot = emptySnapshot();
    this.reconnectDelayMs = RECONNECT_START_MS;
    this.open();
  }

  /** Closes for good, e.g. on sign-out. connect() starts again. */
  disconnect(): void {
    this.teardown();
    this.target = null;
    this.update({status: 'stopped', openedAtMs: null});
  }

  send(MessageType: string, Data?: unknown): boolean {
    if (this.snapshot.status !== 'open' || !this.socket) {
      return false;
    }
    try {
      this.socket.send(
        JSON.stringify(
          Data === undefined ? {MessageType} : {MessageType, Data},
        ),
      );
      return true;
    } catch {
      return false;
    }
  }

  getSnapshot(): ServerSocketSnapshot {
    return {...this.snapshot, recent: this.snapshot.recent.slice()};
  }

  onMessage(listener: (message: ServerSocketMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onStateChange(
    listener: (snapshot: ServerSocketSnapshot) => void,
  ): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  private open(): void {
    const target = this.target;
    if (!target) {
      return;
    }
    this.update({status: 'connecting'});
    // The socket joins the session named by its device id, and REST calls use
    // the stored one. Opening on the placeholder id before storage is read
    // puts the socket on a session of its own that hears nothing.
    initializeDeviceIdentity()
      .catch(() => undefined)
      .then(() => {
        if (this.target === target && !this.socket && !this.reconnectTimer) {
          this.openSocket(target);
        }
      });
  }

  private openSocket(target: {serverUrl: string; accessToken: string}): void {
    let socket: SocketLike;
    try {
      socket = this.createSocket(
        buildSocketUrl(target.serverUrl, target.accessToken, getDeviceId()),
        getAuthHeaders(target.accessToken),
      );
    } catch (error) {
      this.update({
        lastError: error instanceof Error ? error.message : String(error),
      });
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) {
        return;
      }
      this.reconnectDelayMs = RECONNECT_START_MS;
      this.update({
        status: 'open',
        openedAtMs: this.now(),
        opens: this.snapshot.opens + 1,
        lastError: null,
      });
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) {
        return;
      }
      this.receive(event.data);
    };
    socket.onerror = (event) => {
      if (this.socket !== socket) {
        return;
      }
      this.update({lastError: event?.message || 'Socket error'});
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      this.stopKeepAlive();
      this.update({openedAtMs: null, lastCloseCode: event?.code ?? null});
      this.scheduleReconnect();
    };
  }

  private receive(raw: unknown): void {
    let message: ServerSocketMessage;
    try {
      message = JSON.parse(String(raw)) as ServerSocketMessage;
    } catch {
      return;
    }
    if (!message || typeof message.MessageType !== 'string') {
      return;
    }

    const atMs = this.now();
    const recent = [
      ...this.snapshot.recent,
      {type: message.MessageType, atMs},
    ].slice(-RECENT_CAPACITY);
    this.update({
      lastMessageAtMs: atMs,
      messagesReceived: this.snapshot.messagesReceived + 1,
      recent,
    });

    if (message.MessageType === 'ForceKeepAlive') {
      // Data is the server's lost-connection timeout in seconds; jellyfin-web
      // answers at half of it, which keeps well clear of the cutoff.
      const timeoutSeconds = Number(message.Data);
      this.startKeepAlive(
        Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
          ? (timeoutSeconds * 1000) / 2
          : 30000,
      );
    }

    this.messageListeners.forEach((listener) => {
      try {
        listener(message);
      } catch {
        // One listener must not cut the others off.
      }
    });
  }

  private startKeepAlive(intervalMs: number): void {
    this.stopKeepAlive();
    this.update({keepAliveIntervalMs: intervalMs});
    const beat = () => {
      if (this.send('KeepAlive')) {
        this.update({keepAlivesSent: this.snapshot.keepAlivesSent + 1});
      }
    };
    beat();
    this.keepAliveTimer = setInterval(beat, intervalMs);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (!this.target || this.reconnectTimer) {
      return;
    }
    this.update({status: 'waiting'});
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(delay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  private teardown(): void {
    this.stopKeepAlive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close(1000, 'Astra closed the connection');
      } catch {
        // Already gone.
      }
    }
  }

  private update(patch: Partial<ServerSocketSnapshot>): void {
    this.snapshot = {...this.snapshot, ...patch};
    const snapshot = this.getSnapshot();
    this.stateListeners.forEach((listener) => {
      try {
        listener(snapshot);
      } catch {
        // Diagnostics listeners must never break the connection.
      }
    });
  }
}

export const serverSocket = new ServerSocket();

export interface SessionLink {
  /** The server has a session for this device. */
  found: boolean;
  /**
   * The session advertises remote control. On Jellyfin 10.11 an open socket
   * is not enough: it also takes a POST to /Sessions/Capabilities/Full.
   */
  supportsRemoteControl: boolean;
  client?: string;
  deviceName?: string;
}

/** Asks the server how it sees this device's session. */
export const checkSessionLink = async (
  serverUrl: string,
  accessToken: string,
): Promise<SessionLink> => {
  const sessions = await getJson<
    Array<{
      Client?: string;
      DeviceName?: string;
      SupportsRemoteControl?: boolean;
    }>
  >(buildUrl(serverUrl, 'Sessions', {deviceId: getDeviceId()}), {
    headers: getAuthHeaders(accessToken),
  });
  const session = sessions?.[0];
  return session
    ? {
        found: true,
        supportsRemoteControl: session.SupportsRemoteControl === true,
        client: session.Client,
        deviceName: session.DeviceName,
      }
    : {found: false, supportsRemoteControl: false};
};
