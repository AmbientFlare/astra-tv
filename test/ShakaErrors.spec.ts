import {ShakaPlayer} from '../src/w3cmedia/shakaplayer/ShakaPlayer';

const mockPlayers: any[] = [];
let mockLoad = async () => undefined;
jest.mock('@amazon-devices/react-native-w3cmedia/dist/headless', () => ({}));
jest.mock('../src/services/logging/trace', () => ({trace: jest.fn()}));
jest.mock('../src/w3cmedia/polyfills/DocumentPolyfill', () => ({
  __esModule: true,
  default: {install: jest.fn()},
}));
jest.mock('../src/w3cmedia/polyfills/ElementPolyfill', () => ({
  __esModule: true,
  default: {install: jest.fn()},
}));
jest.mock('../src/w3cmedia/polyfills/TextDecoderPolyfill', () => ({
  __esModule: true,
  default: {install: jest.fn()},
}));
jest.mock('../src/w3cmedia/polyfills/W3CMediaPolyfill', () => ({
  __esModule: true,
  default: {install: jest.fn()},
}));
jest.mock('../src/w3cmedia/polyfills/MiscPolyfill', () => ({
  __esModule: true,
  default: {install: jest.fn()},
}));
jest.mock('../src/w3cmedia/polyfills/DOMParserPolyfill', () => ({
  __esModule: true,
  default: {install: jest.fn()},
}));

jest.mock('../src/w3cmedia/shakaplayer/dist/shaka-player.compiled', () => ({
  __esModule: true,
  default: {
    polyfill: {installAll: jest.fn()},
    config: {AutoShowText: {ALWAYS: 1}},
    net: {
      NetworkingEngine: {
        unregisterScheme: jest.fn(),
        registerScheme: jest.fn(),
        PluginPriority: {APPLICATION: 1},
        RequestType: {MANIFEST: 0},
      },
      HttpFetchPlugin: {isSupported: () => true, parse: jest.fn()},
    },
    Player: jest.fn().mockImplementation(() => {
      const handlers = new Map<string, (event: any) => void>();
      const player = {
        addEventListener: jest.fn((event, callback) => {
          handlers.set(event, callback);
        }),
        removeEventListener: jest.fn((event) => {
          handlers.delete(event);
        }),
        emit: (event: any) => handlers.get('error')?.(event),
        configure: jest.fn(),
        setTextTrackVisibility: jest.fn(),
        load: jest.fn(() => mockLoad()),
        unload: jest.fn(async () => undefined),
        detach: jest.fn(async () => undefined),
        destroy: jest.fn(async () => undefined),
        getNetworkingEngine: () => ({
          clearAllRequestFilters: jest.fn(),
          clearAllResponseFilters: jest.fn(),
          registerRequestFilter: jest.fn(),
          registerResponseFilter: jest.fn(),
        }),
      };
      mockPlayers.push(player);
      return player;
    }),
  },
}));

const settings = {
  secure: true,
  abrEnabled: false,
  abrMaxWidth: 3840,
  abrMaxHeight: 2160,
};
const content = {uri: 'https://server/video.m3u8', startTime: 0};
describe('actual Shaka wrapper error and cancellation channels', () => {
  beforeEach(() => {
    mockPlayers.length = 0;
    mockLoad = async () => undefined;
  });
  it('forwards only numeric error metadata after load and removes the listener on release', async () => {
    const onError = jest.fn();
    const wrapper = new ShakaPlayer(null, {...settings, onError});
    await wrapper.load(content, false);
    mockPlayers[0].emit({
      detail: {
        code: 1002,
        category: 1,
        severity: 2,
        data: ['https://server?api_key=secret'],
      },
    });
    expect(onError).toHaveBeenCalledWith({
      source: 'shaka',
      code: 1002,
      category: 1,
      severity: 2,
    });
    expect(JSON.stringify(onError.mock.calls)).not.toContain('secret');
    await wrapper.unload();
    expect(mockPlayers[0].removeEventListener).toHaveBeenCalledWith(
      'error',
      expect.any(Function),
    );
    mockPlayers[0].emit({detail: {code: 1002}});
    expect(onError).toHaveBeenCalledTimes(1);
  });
  it('rejects startup once and destroys a partial player after load failure', async () => {
    const onError = jest.fn();
    const failure = {code: 4001, category: 4, severity: 2};
    mockLoad = async () => {
      mockPlayers[0].emit({detail: failure});
      throw failure;
    };
    const wrapper = new ShakaPlayer(null, {...settings, onError});
    await expect(wrapper.load(content, false)).rejects.toBe(failure);
    expect(onError).not.toHaveBeenCalled();
    expect(mockPlayers[0].destroy).toHaveBeenCalledTimes(1);
    await wrapper.unload();
    expect(mockPlayers[0].destroy).toHaveBeenCalledTimes(1);
  });
  it('cancels before native/Shaka construction without creating an orphan player', async () => {
    const wrapper = new ShakaPlayer(null, settings);
    const load = wrapper.load(content, false);
    const rejected = expect(load).rejects.toThrow('cancelled');
    await wrapper.cancelLoad();
    await rejected;
    await wrapper.unload();
    expect(mockPlayers).toHaveLength(0);
  });
  it('interrupts a pending load immediately rather than waiting behind it', async () => {
    let fail!: (error: Error) => void;
    mockLoad = () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      });
    const wrapper = new ShakaPlayer(null, settings);
    const load = wrapper.load(content, false);
    const rejected = expect(load).rejects.toThrow('cancelled');
    for (let n = 0; n < 15; n++) await Promise.resolve();
    mockPlayers[0].unload.mockImplementation(async () => {
      fail(new Error('cancelled'));
    });
    await wrapper.cancelLoad();
    await rejected;
    await wrapper.unload();
    expect(mockPlayers[0].unload).toHaveBeenCalledTimes(1);
    expect(mockPlayers[0].destroy).toHaveBeenCalledTimes(1);
  });
});
