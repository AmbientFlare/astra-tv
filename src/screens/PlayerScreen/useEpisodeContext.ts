import {useEffect, useRef, useState} from 'react';
import {
  getAdjacentEpisodes,
  getEpisodes,
  getMediaSegments,
  JellyfinMediaItem,
  JellyfinMediaSegment,
} from '../../services/jellyfin';
import {trace} from '../../services/logging/trace';
import {getUserPreferences, UserPreferences} from '../../services/storage';
import {resolveNextEpisode} from '../../services/episodePlayback';

interface EpisodeContextDeps {
  accessToken: string;
  item: JellyfinMediaItem;
  serverUrl: string;
  userId?: string;
  /** Called with the saved preferences once they are read. */
  onPreferences: (preferences: UserPreferences) => void;
}

/**
 * Credits and next-episode data are fetched once per item, off the playback
 * path. Any failure leaves that feature off for this video and touches
 * nothing else.
 */
export const useEpisodeContext = ({
  accessToken,
  item,
  serverUrl,
  userId,
  onPreferences,
}: EpisodeContextDeps) => {
  const [mediaSegments, setMediaSegments] = useState<JellyfinMediaSegment[]>(
    [],
  );
  const [nextEpisode, setNextEpisode] = useState<JellyfinMediaItem | null>(
    null,
  );
  const onPreferencesRef = useRef(onPreferences);
  onPreferencesRef.current = onPreferences;

  const itemId = item.id;
  const itemType = item.type;
  const seriesId = item.seriesId;
  const seasonId = item.parentId;

  useEffect(() => {
    let mounted = true;

    getUserPreferences()
      .then((preferences) => {
        if (mounted) {
          onPreferencesRef.current(preferences);
        }
      })
      .catch((error) => {
        console.warn('[Astra] Unable to read episode preferences:', error);
      });

    getMediaSegments(serverUrl, accessToken, itemId)
      .then((segments) => {
        trace(
          'credits.segments',
          `count=${segments.length} chapters=${item.chapters?.length ?? 0}`,
        );
        if (mounted) {
          setMediaSegments(segments);
        }
      })
      .catch((error) => {
        trace(
          'credits.segments',
          `error ${error instanceof Error ? error.message : String(error)}`,
        );
        console.warn('[Astra] Unable to load media segments:', error);
      });

    if (itemType === 'Episode' && seriesId && userId) {
      const current = {
        id: itemId,
        indexNumber: item.indexNumber,
        parentIndexNumber: item.parentIndexNumber,
        seriesId,
      };
      const describe = (episode: JellyfinMediaItem | null) =>
        episode
          ? `s${episode.parentIndexNumber ?? '?'}e${
              episode.indexNumber ?? '?'
            } ${episode.locationType ?? ''}`.trim()
          : 'none';
      getAdjacentEpisodes(serverUrl, accessToken, userId, seriesId, itemId)
        .then(async (episodes) => {
          let next = resolveNextEpisode(episodes, current);
          const hasCurrent = episodes.some((episode) => episode.id === itemId);
          trace(
            'nextEpisode.adjacent',
            `candidates=${episodes.length} hasCurrent=${hasCurrent} ` +
              `next=${describe(next)}`,
          );
          // A server that does not understand AdjacentTo answers without the
          // current episode; the season list still names the next one.
          if (!next && seasonId && !hasCurrent) {
            const seasonEpisodes = await getEpisodes(
              serverUrl,
              accessToken,
              userId,
              seriesId,
              seasonId,
            );
            next = resolveNextEpisode(seasonEpisodes, current);
            trace(
              'nextEpisode.season',
              `candidates=${seasonEpisodes.length} next=${describe(next)}`,
            );
          }
          if (mounted) {
            setNextEpisode(next);
          }
        })
        .catch((error) => {
          trace(
            'nextEpisode',
            `error ${error instanceof Error ? error.message : String(error)}`,
          );
          console.warn('[Astra] Unable to resolve the next episode:', error);
        });
    } else {
      trace(
        'nextEpisode',
        `skipped type=${itemType} series=${Boolean(seriesId)} user=${Boolean(
          userId,
        )}`,
      );
    }

    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, itemId, itemType, seasonId, seriesId, serverUrl, userId]);

  return {mediaSegments, nextEpisode};
};
