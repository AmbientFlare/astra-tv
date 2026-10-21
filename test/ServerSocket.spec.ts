jest.mock('../src/services/deviceIdentity', () => ({
  getDeviceId: () => 'device-1234',
  initializeDeviceIdentity: async () => 'device-1234',
}));

import {
  ServerSocket,
  buildSocketUrl,
  checkSessionLink,
} from '../src/services/serverSocket';

class FakeSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: {data?: unknown}) => void) | null = null;
  onerror: ((event: {message?: string}) => void) | null = null;
  onclose: ((event: {code?: number}) => void) | null = null;
  sent: string[] = [];
  closed = false;
  constructor(public url: string, public headers: Record<string, string>) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
  }
  serverSends(message: object) {
    this.onmessage?.({data: JSON.stringify(message)});
  }
}

const harness = () => {
  const sockets: FakeSocket[] = [];
  const socket = new ServerSocket((url, headers) => {
    const next = new FakeSocket(url, headers);
    sockets.push(next);
    return next;
  });
  return {socket, sockets, latest: () => sockets[sockets.length - 1]};
};

describe('buildSocketUrl', () => {
  it('maps http to ws and https to wss, keeping a base path and port', () => {
    expect(buildSocketUrl('http://10.0.0.5:8096', 'tok', 'dev')).toBe(
      'ws://10.0.0.5:8096/socket?ApiKey=tok&deviceId=dev',
    );
    expect(
      buildSocketUrl('https://media.example/jellyfin/', 'tok', 'dev'),
    ).toBe('wss://media.example:443/jellyfin/socket?ApiKey=tok&deviceId=dev');
    expect(buildSocketUrl('http://jf.lan', 'tok', 'dev')).toBe(
      'ws://jf.lan:80/socket?ApiKey=tok&deviceId=dev',
    );
  });
});

describe('ServerSocket', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('opens once per target and reports the open state', () => {
    const {socket, sockets, latest} = harness();
    socket.connect('http://server', 'tok');
    socket.connect('http://server', 'tok');
    expect(sockets).toHaveLength(1);
    expect(latest().url).toContain('deviceId=device-1234');
    // Jellyfin 10.11 can refuse the token in the URL; the header always works.
    expect(latest().headers.Authorization).toContain('Token="tok"');
    expect(socket.getSnapshot().status).toBe('connecting');
    latest().onopen?.();
    expect(socket.getSnapshot()).toMatchObject({status: 'open', opens: 1});
  });

  it('answers ForceKeepAlive at half the timeout, then on an interval', () => {
    const {socket, latest} = harness();
    socket.connect('http://server', 'tok');
    latest().onopen?.();
    latest().serverSends({MessageType: 'ForceKeepAlive', Data: 60});
    expect(latest().sent).toEqual(['{"MessageType":"KeepAlive"}']);
    jest.advanceTimersByTime(30000);
    expect(latest().sent).toHaveLength(2);
    expect(socket.getSnapshot()).toMatchObject({
      keepAliveIntervalMs: 30000,
      keepAlivesSent: 2,
      messagesReceived: 1,
    });
  });

  it('passes messages to listeners and ignores junk', () => {
    const {socket, latest} = harness();
    const seen: string[] = [];
    socket.onMessage((message) => seen.push(message.MessageType));
    socket.connect('http://server', 'tok');
    latest().onopen?.();
    latest().onmessage?.({data: 'not json'});
    latest().serverSends({MessageType: 'SyncPlayGroupUpdate', Data: {}});
    expect(seen).toEqual(['SyncPlayGroupUpdate']);
    expect(socket.getSnapshot().recent.map((event) => event.type)).toEqual([
      'SyncPlayGroupUpdate',
    ]);
  });

  it('reconnects with backoff after the server drops the socket', () => {
    const {socket, sockets, latest} = harness();
    socket.connect('http://server', 'tok');
    latest().onopen?.();
    latest().serverSends({MessageType: 'ForceKeepAlive', Data: 60});
    latest().onclose?.({code: 1006});
    expect(socket.getSnapshot()).toMatchObject({
      status: 'waiting',
      lastCloseCode: 1006,
    });
    jest.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    // A failed retry doubles the wait.
    latest().onclose?.({code: 1006});
    jest.advanceTimersByTime(1999);
    expect(sockets).toHaveLength(2);
    jest.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    // The old socket's keep-alive died with it.
    expect(sockets[0].sent).toHaveLength(1);
  });

  it('closes and stops retrying on disconnect, and ignores the old socket', () => {
    const {socket, sockets, latest} = harness();
    socket.connect('http://server', 'tok');
    const first = latest();
    first.onopen?.();
    socket.disconnect();
    expect(first.closed).toBe(true);
    first.onclose?.({code: 1000});
    jest.advanceTimersByTime(60000);
    expect(sockets).toHaveLength(1);
    expect(socket.getSnapshot().status).toBe('stopped');
  });

  it('re-targets when the signed-in profile changes', () => {
    const {socket, sockets} = harness();
    socket.connect('http://server', 'tok-a');
    socket.connect('http://server', 'tok-b');
    expect(sockets).toHaveLength(2);
    expect(sockets[0].closed).toBe(true);
    expect(sockets[1].url).toContain('ApiKey=tok-b');
  });
});

describe('checkSessionLink', () => {
  it('reports whether the server attached the socket to this session', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      text: async () =>
        JSON.stringify([
          {Client: 'Astra', DeviceName: 'FireTV', SupportsRemoteControl: true},
        ]),
    }));
    (global as any).fetch = fetchMock;
    await expect(checkSessionLink('http://server', 'tok')).resolves.toEqual({
      found: true,
      supportsRemoteControl: true,
      client: 'Astra',
      deviceName: 'FireTV',
    });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe(
      'http://server/Sessions?deviceId=device-1234',
    );
  });

  it('reports a missing session', async () => {
    (global as any).fetch = jest.fn(async () => ({
      ok: true,
      text: async () => '[]',
    }));
    await expect(checkSessionLink('http://server', 'tok')).resolves.toEqual({
      found: false,
      supportsRemoteControl: false,
    });
  });
});
