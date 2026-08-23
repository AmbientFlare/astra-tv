export interface TrimmedHlsPlaylist {
  playlist: string;
  skippedDurationSeconds: number;
  skippedSegments: number;
}

/**
 * Jellyfin exposes dynamic HLS as a virtual VOD playlist. Requesting segment
 * N makes the server seek FFmpeg directly to that part of the source. Trim
 * entries before the logical resume point so Shaka requests N immediately
 * instead of downloading/appending segments 0..N first.
 */
export const trimHlsMediaPlaylistForResume = (
  playlist: string,
  resumeSeconds: number,
): TrimmedHlsPlaylist | null => {
  if (!(resumeSeconds > 0) || !playlist.includes('#EXTINF:')) {
    return null;
  }

  const lines = playlist.split(/\r?\n/);
  const segments: Array<{
    duration: number;
    endLine: number;
    startLine: number;
  }> = [];
  let pendingExtInfLine = -1;
  let pendingDuration = 0;

  lines.forEach((line, index) => {
    if (line.startsWith('#EXTINF:')) {
      pendingExtInfLine = index;
      pendingDuration = Number(line.slice('#EXTINF:'.length).split(',', 1)[0]);
      return;
    }

    if (
      pendingExtInfLine >= 0 &&
      line.length > 0 &&
      !line.startsWith('#') &&
      Number.isFinite(pendingDuration) &&
      pendingDuration > 0
    ) {
      segments.push({
        duration: pendingDuration,
        endLine: index,
        startLine: pendingExtInfLine,
      });
      pendingExtInfLine = -1;
      pendingDuration = 0;
    }
  });

  if (segments.length < 2) {
    return null;
  }

  let skippedDurationSeconds = 0;
  let skippedSegments = 0;
  while (
    skippedSegments + 1 < segments.length &&
    skippedDurationSeconds + segments[skippedSegments].duration <=
      resumeSeconds
  ) {
    skippedDurationSeconds += segments[skippedSegments].duration;
    skippedSegments += 1;
  }

  if (skippedSegments === 0) {
    return null;
  }

  const firstKeptLine = segments[skippedSegments].startLine;
  const prefix = lines.slice(0, segments[0].startLine);
  const oldSequenceIndex = prefix.findIndex((line) =>
    line.startsWith('#EXT-X-MEDIA-SEQUENCE:'),
  );
  if (oldSequenceIndex >= 0) {
    const oldSequence = Number(prefix[oldSequenceIndex].split(':', 2)[1]);
    prefix[oldSequenceIndex] = `#EXT-X-MEDIA-SEQUENCE:${
      (Number.isFinite(oldSequence) ? oldSequence : 0) + skippedSegments
    }`;
  } else {
    const headerIndex = Math.max(0, prefix.indexOf('#EXTM3U'));
    prefix.splice(
      headerIndex + 1,
      0,
      `#EXT-X-MEDIA-SEQUENCE:${skippedSegments}`,
    );
  }

  return {
    playlist: [...prefix, ...lines.slice(firstKeptLine)].join('\n'),
    skippedDurationSeconds,
    skippedSegments,
  };
};
