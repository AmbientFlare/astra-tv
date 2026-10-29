import {useEffect, useState} from 'react';
import type {JellyfinStreamInfo} from '../../services/jellyfin';
import {parseWebVtt, WebVttCue} from '../../services/subtitles';

/**
 * Fetches and parses the WebVTT for a text subtitle track the server delivers
 * separately. Any other selection, or a failed fetch, leaves the overlay
 * empty.
 */
export const useExternalSubtitleCues = (
  currentStream: JellyfinStreamInfo | null,
  selectedSubtitleTrackIndex: number | undefined,
): WebVttCue[] => {
  const [cues, setCues] = useState<WebVttCue[]>([]);

  useEffect(() => {
    let cancelled = false;
    const subtitleTrack = currentStream?.subtitleTracks.find(
      (track) =>
        track.index === selectedSubtitleTrackIndex &&
        track.deliveryUrl &&
        !track.burnInRequired,
    );

    setCues([]);
    if (!subtitleTrack?.deliveryUrl) {
      return () => {
        cancelled = true;
      };
    }

    fetch(subtitleTrack.deliveryUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Subtitle request failed (${response.status})`);
        }
        return response.text();
      })
      .then((body) => {
        if (!cancelled) {
          const parsed = parseWebVtt(body);
          console.info('[Astra] Loaded external subtitle cues:', parsed.length);
          setCues(parsed);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn('[Astra] Unable to load external subtitles:', error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentStream, selectedSubtitleTrackIndex]);

  return cues;
};
