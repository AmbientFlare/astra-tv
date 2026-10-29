import {
  classifyRemoteKey,
  isMenuKey,
  isPlayPauseKey,
} from '../src/screens/PlayerScreen/remoteKeys';

describe('classifyRemoteKey', () => {
  it('strips the press suffix and keeps the release phase', () => {
    expect(classifyRemoteKey('select_down', undefined)).toEqual({
      key: 'select',
      seekDirection: 0,
      released: false,
      transport: false,
    });
    expect(classifyRemoteKey('select_up', undefined).released).toBe(true);
    expect(classifyRemoteKey('select', 1).released).toBe(true);
    expect(classifyRemoteKey(undefined, undefined).key).toBe('');
  });

  it('tells directional seeks from transport keys', () => {
    expect(classifyRemoteKey('right', 0)).toMatchObject({
      seekDirection: 1,
      transport: false,
    });
    expect(classifyRemoteKey('left_down', 0)).toMatchObject({
      seekDirection: -1,
      transport: false,
    });
    expect(classifyRemoteKey('fast_forward', 0)).toMatchObject({
      seekDirection: 1,
      transport: true,
    });
    expect(classifyRemoteKey('skip_backward_up', 1)).toMatchObject({
      key: 'skip_backward',
      seekDirection: -1,
      transport: true,
      released: true,
    });
  });

  it('names the play/pause and menu keys in both spellings', () => {
    expect(isPlayPauseKey('playPause')).toBe(true);
    expect(isPlayPauseKey('playpause')).toBe(true);
    expect(isPlayPauseKey('select')).toBe(false);
    expect(isMenuKey('menu')).toBe(true);
    expect(isMenuKey('context_menu')).toBe(true);
    expect(isMenuKey('back')).toBe(false);
  });
});
