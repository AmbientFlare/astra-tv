import {
  authenticateWithQuickConnect,
  initiateQuickConnect,
  isQuickConnectEnabled,
  pollQuickConnect,
} from '../src/services/jellyfin';

const originalFetch = global.fetch;

const jsonResponse = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
  });

describe('Jellyfin Quick Connect API', () => {
  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('checks whether Quick Connect is enabled', async () => {
    const fetchMock = jest.fn(() => jsonResponse(true));
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      isQuickConnectEnabled('https://jellyfin.example.com/'),
    ).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://jellyfin.example.com/QuickConnect/Enabled',
      expect.objectContaining({signal: expect.anything()}),
    );
  });

  it('starts Quick Connect with the required POST request', async () => {
    const fetchMock = jest.fn(() =>
      jsonResponse({Code: '123456', Secret: 'device-secret'}),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      initiateQuickConnect('https://jellyfin.example.com'),
    ).resolves.toEqual({code: '123456', secret: 'device-secret'});
    expect(fetchMock).toHaveBeenCalledWith(
      'https://jellyfin.example.com/QuickConnect/Initiate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Emby-Authorization': expect.stringContaining('MediaBrowser'),
        }),
      }),
    );
  });

  it('polls approval and exchanges the secret for an account token', async () => {
    const fetchMock = jest
      .fn()
      .mockImplementationOnce(() => jsonResponse({Authenticated: true}))
      .mockImplementationOnce(() =>
        jsonResponse({
          AccessToken: 'account-token',
          User: {Id: 'user-id', Name: 'Astra User'},
        }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      pollQuickConnect('https://jellyfin.example.com', 'device-secret'),
    ).resolves.toBe(true);
    await expect(
      authenticateWithQuickConnect(
        'https://jellyfin.example.com',
        'device-secret',
      ),
    ).resolves.toEqual({
      accessToken: 'account-token',
      userId: 'user-id',
      username: 'Astra User',
    });

    expect(fetchMock.mock.calls[0][0]).toContain(
      '/QuickConnect/Connect?Secret=device-secret',
    );
    expect(fetchMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({Secret: 'device-secret'}),
        method: 'POST',
      }),
    );
  });
});
