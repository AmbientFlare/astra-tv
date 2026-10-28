import {AsyncStorage} from '@amazon-devices/react-native-kepler';
import {
  readPlaybackPreferences,
  readSeriesTrackPick,
  rememberSeriesTrackPick,
  seriesTrackPickKey,
} from '../src/services/storage';

jest.mock('@amazon-devices/react-native-kepler', () => {
  const store = new Map<string, string>();

  return {
    AsyncStorage: {
      clear: () => store.clear(),
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

beforeEach(() => {
  (AsyncStorage as unknown as {clear: () => void}).clear();
});

describe('series track picks', () => {
  it('keeps audio and subtitle picks together per account and series', async () => {
    const key = seriesTrackPickKey('user-1', 'series-1');
    await rememberSeriesTrackPick(key, {audio: {language: 'jpn'}});
    await rememberSeriesTrackPick(key, {subtitle: {language: 'eng'}});

    expect(await readSeriesTrackPick(key)).toEqual({
      audio: {language: 'jpn'},
      subtitle: {language: 'eng'},
    });
    expect(
      await readSeriesTrackPick(seriesTrackPickKey('user-2', 'series-1')),
    ).toBeUndefined();
  });

  it('keeps only the most recent 200 series', async () => {
    const now = jest.spyOn(Date, 'now');
    for (let n = 0; n < 201; n++) {
      now.mockReturnValue(1000 + n);
      await rememberSeriesTrackPick(`user:series-${n}`, {
        audio: {language: 'eng'},
      });
    }
    now.mockRestore();

    expect(await readSeriesTrackPick('user:series-0')).toBeUndefined();
    expect(await readSeriesTrackPick('user:series-200')).toBeDefined();
  });
});

describe('audio language default', () => {
  it('follows the Jellyfin account on a fresh install', async () => {
    expect((await readPlaybackPreferences()).preferredAudioLanguage).toBe(
      'server',
    );
  });

  it('keeps the language an existing install already had', async () => {
    await AsyncStorage.setItem(
      'astra.userPreferences.v1',
      JSON.stringify({preferredAudioLanguage: 'English'}),
    );
    expect((await readPlaybackPreferences()).preferredAudioLanguage).toBe('en');
  });
});
