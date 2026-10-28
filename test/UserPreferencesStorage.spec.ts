import {AsyncStorage} from '@amazon-devices/react-native-kepler';
import {
  defaultUserPreferences,
  defaultPlaybackPrefs,
  getUserPreferences,
  readPlaybackPreferences,
  updateUserPreferences,
  writePlaybackPreferences,
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

describe('the persisted bitrate cap', () => {
  beforeEach(async () => {
    await AsyncStorage.removeItem('astra.playbackPrefs.v1');
  });

  // Issue #26: a server that cannot re-encode 4K needs a cap low enough that
  // it downscales instead.
  it('keeps the low caps a struggling server needs', async () => {
    for (const maxBitrateBps of [4000000, 8000000, 12000000, 20000000]) {
      await writePlaybackPreferences({maxBitrateBps});
      expect((await readPlaybackPreferences()).maxBitrateBps).toBe(
        maxBitrateBps,
      );
    }
  });

  it('falls back to the default for a cap this build does not offer', async () => {
    await writePlaybackPreferences({maxBitrateBps: 5000000});
    expect((await readPlaybackPreferences()).maxBitrateBps).toBe(
      defaultPlaybackPrefs.maxBitrateBps,
    );
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

describe('the "Continue watching?" episode count', () => {
  it('defaults to three episodes, including for installs that never set it', async () => {
    expect((await getUserPreferences()).stillWatchingAfterEpisodes).toBe(3);

    const older: Partial<typeof defaultUserPreferences> = {
      ...defaultUserPreferences,
    };
    delete older.stillWatchingAfterEpisodes;
    await AsyncStorage.setItem(KEY, JSON.stringify(older));
    expect((await getUserPreferences()).stillWatchingAfterEpisodes).toBe(3);
  });

  it('round-trips each choice, Never included', async () => {
    for (const stillWatchingAfterEpisodes of [5, 10, 0, 3] as const) {
      await updateUserPreferences({stillWatchingAfterEpisodes});
      expect((await getUserPreferences()).stillWatchingAfterEpisodes).toBe(
        stillWatchingAfterEpisodes,
      );
    }
  });

  it('falls back to three for a value this build does not offer', async () => {
    await AsyncStorage.setItem(
      KEY,
      JSON.stringify({
        ...defaultUserPreferences,
        stillWatchingAfterEpisodes: 7,
      }),
    );

    expect((await getUserPreferences()).stillWatchingAfterEpisodes).toBe(3);
  });
});
