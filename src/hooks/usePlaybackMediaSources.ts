import {useEffect, useState} from 'react';
import {
  getPlaybackMediaSources,
  JellyfinMediaItem,
  JellyfinMediaSource,
} from '../services/jellyfin';
import {ServerProfile} from '../services/storage';

export const usePlaybackMediaSources = (
  profile: ServerProfile,
  item: JellyfinMediaItem,
) => {
  const [sources, setSources] = useState<JellyfinMediaSource[]>(
    item.mediaSources ?? [],
  );
  const [selectedMediaSourceId, setSelectedMediaSourceId] = useState<
    string | undefined
  >(item.selectedMediaSourceId);

  useEffect(() => {
    let mounted = true;
    setSources(item.mediaSources ?? []);
    setSelectedMediaSourceId(item.selectedMediaSourceId);

    if (item.type !== 'Movie' && item.type !== 'Episode') {
      return () => {
        mounted = false;
      };
    }

    getPlaybackMediaSources(
      profile.serverUrl,
      profile.accessToken,
      item.id,
      profile.userId,
    )
      .then((results) => {
        if (mounted && results.length) {
          setSources(results);
        }
      })
      .catch(() => {
        // Item DTO MediaSources remain a valid fallback, and a source-menu failure must never
        // interfere with ordinary Play.
      });

    return () => {
      mounted = false;
    };
  }, [
    item.id,
    item.mediaSources,
    item.selectedMediaSourceId,
    item.type,
    profile,
  ]);

  return {selectedMediaSourceId, setSelectedMediaSourceId, sources};
};
