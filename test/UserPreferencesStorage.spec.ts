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
