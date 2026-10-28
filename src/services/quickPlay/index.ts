import {
  getEpisodes,
  getSeriesNextUp,
  getSeriesResume,
  JellyfinMediaItem,
} from '../jellyfin';

const PLAYABLE_TYPES = ['Episode', 'Movie', 'MusicVideo', 'Video'];

interface QuickPlayProfile {
  serverUrl: string;
  accessToken: string;
  userId: string;
}

/**
 * What Play on a library card starts without opening the item: a movie or
 * episode itself (from its resume point, if any). A series resumes the
 * episode it was left part-way through, as Continue Watching shows it; with
 * none, it plays what Next Up offers. Next Up only counts finished episodes,
 * which is why the part-watched one is asked for first. A series with
 * neither starts from its first episode.
 * Anything else (folders, collections) resolves to null and opens as usual.
 */
export const resolveQuickPlay = async (
  item: JellyfinMediaItem,
  {serverUrl, accessToken, userId}: QuickPlayProfile,
): Promise<JellyfinMediaItem | null> => {
  if (PLAYABLE_TYPES.includes(item.type)) {
    return item;
  }

  if (item.type !== 'Series') {
    return null;
  }

  const inProgress = await getSeriesResume(
    serverUrl,
    accessToken,
    userId,
    item.id,
  );
  if (inProgress) {
    return inProgress;
  }

  const nextUp = await getSeriesNextUp(serverUrl, accessToken, userId, item.id);
  if (nextUp) {
    return nextUp;
  }

  const [first] = await getEpisodes(serverUrl, accessToken, userId, item.id);
  return first ? {...first, resumePositionTicks: 0} : null;
};
