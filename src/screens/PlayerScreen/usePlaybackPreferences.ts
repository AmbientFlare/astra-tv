import {useEffect, useState} from 'react';
import {
  defaultPlaybackPrefs,
  readPlaybackPreferences,
} from '../../services/storage';

/**
 * The saved playback preferences the player reads once on mount. The stats
 * and traces toggles stay writable because the settings overlay flips them.
 */
export const usePlaybackPreferences = () => {
  const [preferredSeekSeconds, setPreferredSeekSeconds] = useState(
    defaultPlaybackPrefs.seekDurationSeconds,
  );
  const [preferredMaxBitrate, setPreferredMaxBitrate] = useState<
    number | undefined
  >(undefined);
  const [showPlaybackStats, setShowPlaybackStats] = useState(false);
  const [showPlaybackTraces, setShowPlaybackTraces] = useState(false);

  useEffect(() => {
    let mounted = true;

    readPlaybackPreferences().then((preferences) => {
      if (!mounted) {
        return;
      }

      setPreferredSeekSeconds(preferences.seekDurationSeconds);
      setPreferredMaxBitrate(preferences.maxBitrateBps);
      setShowPlaybackStats(preferences.showPlaybackStats);
      setShowPlaybackTraces(preferences.showPlaybackTraces);
    });

    return () => {
      mounted = false;
    };
  }, []);

  return {
    preferredSeekSeconds,
    preferredMaxBitrate,
    showPlaybackStats,
    setShowPlaybackStats,
    showPlaybackTraces,
    setShowPlaybackTraces,
  };
};
