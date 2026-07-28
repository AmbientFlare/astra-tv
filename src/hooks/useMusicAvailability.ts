/**
 * Decides whether the music section exists for this user.
 *
 * Two independent conditions, both required:
 *   1. the signed-in user can actually see a music library on the server, and
 *   2. the user has not switched music off in settings.
 *
 * Music and Playlists must never appear otherwise — a user with no music
 * library should not see dead navigation.
 */
import {useCallback, useEffect, useState} from 'react';
import {hasMusicLibraries, MusicSession} from '../services/jellyfin/music';
import {getUserPreferences} from '../services/storage';

export interface MusicAvailabilityInputs {
  hasMusicLibrary: boolean;
  musicEnabled: boolean;
}

/**
 * Pure gate, split out so the rule is testable without a server or storage.
 */
export const shouldShowMusic = ({
  hasMusicLibrary,
  musicEnabled,
}: MusicAvailabilityInputs) => hasMusicLibrary && musicEnabled;

export interface MusicAvailability {
  /** True only when both conditions hold. */
  available: boolean;
  hasMusicLibrary: boolean;
  isChecking: boolean;
  musicEnabled: boolean;
  refresh: () => void;
}

export const useMusicAvailability = (
  session: MusicSession | null,
): MusicAvailability => {
  const [hasMusicLibrary, setHasMusicLibrary] = useState(false);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [isChecking, setChecking] = useState(true);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => setRefreshToken((token) => token + 1), []);

  useEffect(() => {
    let active = true;

    const check = async () => {
      if (!session) {
        if (active) {
          setHasMusicLibrary(false);
          setChecking(false);
        }
        return;
      }

      setChecking(true);

      // hasMusicLibraries already swallows network errors and reports false,
      // so a server hiccup hides the section rather than breaking the home
      // screen.
      const [libraryPresent, preferences] = await Promise.all([
        hasMusicLibraries(session),
        getUserPreferences(),
      ]);

      if (!active) {
        return;
      }

      setHasMusicLibrary(libraryPresent);
      setMusicEnabled(preferences.musicEnabled);
      setChecking(false);
    };

    check();

    return () => {
      active = false;
    };
  }, [refreshToken, session]);

  return {
    available: shouldShowMusic({hasMusicLibrary, musicEnabled}),
    hasMusicLibrary,
    isChecking,
    musicEnabled,
    refresh,
  };
};
