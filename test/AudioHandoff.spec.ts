import {AudioPlaybackService} from '../src/services/audioPlayer';

let mockInitialize: () => Promise<void> = async () => undefined;
const mockPlayers: any[] = [];
jest.mock('@amazon-devices/react-native-w3cmedia', () => ({
  AudioContentType: {CONTENT_TYPE_MUSIC: 1},
  AudioUsageType: {USAGE_MEDIA: 1},
  KeplerMediaControlHandler: class {},
  AudioPlayer: jest.fn().mockImplementation(() => {
    const listeners = new Map<string, () => void>();
    const player: any = {
      initialize: () => mockInitialize(),
      setMediaControlFocus: jest.fn(async () => undefined),
      pause: jest.fn(),
      play: jest.fn(),
      deinitialize: jest.fn(async () => undefined),
      addEventListener: (event: string, callback: () => void) => {
        listeners.set(event, callback);
      },
      emit: (event: string) => listeners.get(event)?.(),
    };
    mockPlayers.push(player);
    return player;
  }),
}));
jest.mock('../src/services/deviceIdentity', () => ({
  initializeDeviceIdentity: async () => 'test-id',
}));
jest.mock('../src/services/jellyfin/music', () => ({
  getAudioStreamUrl: () => 'https://server/audio.mp3',
  getAudioHlsStreamUrl: () => 'http://server/audio.m3u8',
}));

describe('music to video handoff', () => {
  beforeEach(() => {
    mockPlayers.length = 0;
    mockInitialize = async () => undefined;
  });
  const service = () => {
    const audio = new AudioPlaybackService();
    audio.setSession({
      serverUrl: 'https://server',
      userId: 'user',
      accessToken: 'token',
    });
    audio.setComponentInstance({});
    return audio;
  };
  it('invalidates a music load that was still acquiring native resources', async () => {
    let finish!: () => void;
    mockInitialize = () =>
      new Promise((resolve) => {
        finish = resolve;
      });
    const audio = service();
    const play = audio.play([{id: 'song', name: 'Song'}]);
    for (let n = 0; n < 5; n++) await Promise.resolve();
    const stop = audio.stop();
    finish();
    await Promise.all([play, stop]);
    expect(mockPlayers[0].src).toBeUndefined();
    expect(mockPlayers[0].deinitialize).toHaveBeenCalledTimes(1);
    mockPlayers[0].emit('loadedmetadata');
    expect(mockPlayers[0].play).not.toHaveBeenCalled();
  });
  it('shares concurrent stop and leaves listeners on the service usable', async () => {
    const audio = service();
    await audio.play([{id: 'song', name: 'Song'}]);
    await Promise.all([audio.stop(), audio.stop()]);
    expect(mockPlayers[0].deinitialize).toHaveBeenCalledTimes(1);
    await audio.play([{id: 'other', name: 'Other'}]);
    expect(mockPlayers).toHaveLength(2);
    expect(mockPlayers[1].src).toBe('https://server/audio.mp3');
    await audio.stop();
  });
});
