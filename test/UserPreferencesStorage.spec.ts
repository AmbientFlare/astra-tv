import {AsyncStorage} from '@amazon-devices/react-native-kepler';
import {
  defaultUserPreferences,
  getUserPreferences,
  updateUserPreferences,
} from '../src/services/storage';

jest.mock('@amazon-devices/react-native-kepler', () => {
  const store = new Map<string, string>();

  return {
    AsyncStorage: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      removeItem: jest.fn(async (key: string) => {
        store.delete(key);
      }),
      setItem: jest.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    },
  };
});

const KEY = 'astra.userPreferences.v1';

beforeEach(async () => {
  await AsyncStorage.removeItem(KEY);
});

describe('the persisted subtitle preference', () => {
  it('defaults to per-video behaviour', async () => {
    expect((await getUserPreferences()).subtitleMode).toBe('default');
    expect(defaultUserPreferences.subtitleMode).toBe('default');
  });

  it('round-trips every subtitle mode through storage', async () => {
    for (const subtitleMode of [
      'alwaysOn',
      'alwaysOff',
      'forcedOnly',
      'default',
    ] as const) {
      await updateUserPreferences({subtitleMode});
      expect((await getUserPreferences()).subtitleMode).toBe(subtitleMode);
    }
  });

  it('falls back to per-video for a stored value this build does not know', async () => {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({...defaultUserPreferences, subtitleMode: 'smart'}),
    );

    expect((await getUserPreferences()).subtitleMode).toBe('default');
  });

  it('keeps the other preferences when only the subtitle mode changes', async () => {
    await updateUserPreferences({nextEpisodeAutoplay: true});
    await updateUserPreferences({subtitleMode: 'alwaysOff'});

    const preferences = await getUserPreferences();
    expect(preferences.nextEpisodeAutoplay).toBe(true);
    expect(preferences.subtitleMode).toBe('alwaysOff');
  });
});

describe('subtitle appearance', () => {
  it('defaults to shadowed text for new installs and existing preferences', async () => {
    expect((await getUserPreferences()).subtitleAppearance).toBe('shadow');
    await AsyncStorage.setItem(KEY, JSON.stringify({subtitleMode: 'alwaysOn'}));
    const preferences = await getUserPreferences();
    expect(preferences.subtitleAppearance).toBe('shadow');
    expect(preferences.subtitleMode).toBe('alwaysOn');
  });

  it('persists either appearance without changing subtitle selection', async () => {
    await updateUserPreferences({subtitleMode: 'forcedOnly'});
    for (const subtitleAppearance of ['background', 'shadow'] as const) {
      await updateUserPreferences({subtitleAppearance});
      const preferences = await getUserPreferences();
      expect(preferences.subtitleAppearance).toBe(subtitleAppearance);
      expect(preferences.subtitleMode).toBe('forcedOnly');
    }
  });

  it('falls back to shadowed text for an unknown stored appearance', async () => {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({subtitleAppearance: 'unknown'}),
    );
    expect((await getUserPreferences()).subtitleAppearance).toBe('shadow');
  });
});
