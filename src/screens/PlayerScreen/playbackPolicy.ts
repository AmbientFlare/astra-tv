/**
 * Pure playback decisions and helpers for the player screen. Nothing here
 * touches React, the media element or the network, so each rule is
 * unit-testable on its own and the screen only wires the results up.
 */
import {
  isSecondaryTrack,
  JellyfinMediaItem,
  JellyfinMediaTrack,
  sanitizeUrlForLog,
  SeriesTrackPick,
} from '../../services/jellyfin';
import {
  requiresServerConversion,
  serverConversionFailed,
} from '../../services/playbackHealth';
import {t} from '../../i18n';
import {TICKS_PER_SECOND} from './types';

// The physical one-hour MPEG-TS test rejected sequence mode: audio accumulated
// a clearly visible lead over video, while pause/resume partially restored
// sync. Keep every video route in the previously accepted segments mode while
// the native W3C Media 2.2 interface is evaluated independently.
export const shouldUseHlsSequenceMode = (_outputContainer?: string) => false;

/**
 * An fMP4 session that starts mid-file needs sequence mode. Jellyfin's
 * transcode keeps source timestamps (`-copyts`), and the fMP4 init segment
 * is served by a separate from-zero FFmpeg session, so in segments mode the
 * first fragment lands at its source time (for example 3345 s) while Shaka's
 * playhead stays at 0 and nothing ever decodes. Observed on the physical
 * stick for a subtitle burn-in resume on two titles. Sequence mode places
 * the first fragment at the playhead regardless of its timestamps. MPEG-TS
 * has no init segment and keeps the accepted segments mode, and so does
 * fMP4 playback from the start.
 */
export const shouldUseSequenceModeForMidFileStart = (
  outputContainer: string | undefined,
  startTimeSeconds: number | undefined,
) => {
  if (!(startTimeSeconds && startTimeSeconds > 0)) {
    return false;
  }
  const container = (outputContainer ?? '').trim().toLowerCase();
  return container.includes('mp4') || container.includes('m4s');
};

export const episodeLabel = (episode: JellyfinMediaItem) => {
  const code =
    episode.parentIndexNumber !== undefined && episode.indexNumber !== undefined
      ? `S${episode.parentIndexNumber}:E${episode.indexNumber}`
      : episode.indexNumber !== undefined
      ? t('detail.episodeNumber', {number: episode.indexNumber})
      : undefined;
  return code ? `${code}  ${episode.name}` : episode.name;
};

/** Names the likely cause when a title can only play through a server re-encode. */
export const startupFailureMessage = (
  sourceVideoRangeType: string | undefined,
  fallback: string,
) =>
  requiresServerConversion(sourceVideoRangeType)
    ? serverConversionFailed()
    : fallback;

export const toTicks = (seconds?: number, fallback = 0) =>
  Math.round((seconds ?? fallback) * TICKS_PER_SECOND);

/**
 * Jumps at least this far reload the stream at the target instead of seeking
 * within it.
 *
 * An in-place seek makes Vega drain and refill the decoder, which was measured
 * at 36 s for a ten-minute jump and close to two minutes on a high-bitrate
 * title. Reloading asks Jellyfin to start at the target segment, the same route
 * resume takes, which lands in about three seconds. Short D-pad seeks stay
 * in-place because they are already near-instant and a reload would be a
 * visible interruption for no gain.
 */
export const RELOAD_JUMP_THRESHOLD_SECONDS = 60;

export const isAdaptiveStream = (url: string) =>
  url.includes('.m3u8') || url.includes('.mpd');

export const assertPlayableUrl = (url: string) => {
  const parsed = new URL(url);
  const seenKeys = new Set<string>();
  const duplicateKeys = new Set<string>();

  parsed.searchParams.forEach((_, key) => {
    const normalizedKey = key.toLowerCase();
    if (seenKeys.has(normalizedKey)) {
      duplicateKeys.add(key);
    }
    seenKeys.add(normalizedKey);
  });

  const hasEmptyQueryAssignment = /[?&]=(?:&|$)/.test(url);

  if (duplicateKeys.size || hasEmptyQueryAssignment) {
    console.warn('[Astra] Malformed playback URL:', {
      duplicateQueryKeys: Array.from(duplicateKeys),
      hasEmptyQueryAssignment,
      url: sanitizeUrlForLog(url),
    });
    throw new Error(
      'Malformed playback URL before video load. Check stream URL logs.',
    );
  }
};

/** What to remember for the series from a choice in the player overlay. */
export const seriesPickFor = (selection: {
  audioTrack?: JellyfinMediaTrack;
  subtitleTrack?: JellyfinMediaTrack | null;
}): SeriesTrackPick => ({
  ...(selection.audioTrack
    ? {
        audio: {
          channels: selection.audioTrack.channels,
          language: selection.audioTrack.language,
          secondary: isSecondaryTrack(selection.audioTrack),
        },
      }
    : {}),
  ...(selection.subtitleTrack === undefined
    ? {}
    : {
        subtitle: selection.subtitleTrack
          ? {
              forced: Boolean(selection.subtitleTrack.isForced),
              language: selection.subtitleTrack.language,
              secondary: isSecondaryTrack(selection.subtitleTrack),
            }
          : {off: true},
      }),
});
