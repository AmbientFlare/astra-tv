import {shouldShowMusic} from '../src/hooks/useMusicAvailability';
import {defaultUserPreferences} from '../src/services/storage';

describe('shouldShowMusic', () => {
  it('shows music only when the user has a library AND has it enabled', () => {
    expect(shouldShowMusic({hasMusicLibrary: true, musicEnabled: true})).toBe(
      true,
    );
  });

  it('hides music when the user has no music library', () => {
    // A movies-only user must not see dead Music/Playlists navigation.
    expect(shouldShowMusic({hasMusicLibrary: false, musicEnabled: true})).toBe(
      false,
    );
  });

  it('hides music when the user has switched it off', () => {
    expect(shouldShowMusic({hasMusicLibrary: true, musicEnabled: false})).toBe(
      false,
    );
  });

  it('hides music when neither condition holds', () => {
    expect(shouldShowMusic({hasMusicLibrary: false, musicEnabled: false})).toBe(
      false,
    );
  });
});

describe('musicEnabled preference', () => {
  it('defaults to on so users with music see it without opting in', () => {
    expect(defaultUserPreferences.musicEnabled).toBe(true);
  });
});
