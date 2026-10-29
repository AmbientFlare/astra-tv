/** Number and clock formatting for the player overlays. */

export const formatDiagnosticMbps = (bitsPerSecond?: number) =>
  bitsPerSecond && Number.isFinite(bitsPerSecond)
    ? `${(bitsPerSecond / 1000000).toFixed(1)} Mbps`
    : '—';

export const formatDiagnosticKbps = (bitsPerSecond?: number) =>
  bitsPerSecond && Number.isFinite(bitsPerSecond)
    ? `${Math.round(bitsPerSecond / 1000)} kbps`
    : '—';

// Vega's getVideoPlaybackQuality() reports absolute frame counts that cannot
// be true -- roughly 4,600 fps on a 23.976 fps stream -- so printing them
// invites people to read a wrong number as fact. The ratio between the two
// still moves in the right direction when the decoder is struggling, so that
// is the only form worth showing.
export const formatDropRatio = (decoded?: number, dropped?: number) => {
  if (
    !decoded ||
    !Number.isFinite(decoded) ||
    dropped === undefined ||
    !Number.isFinite(dropped)
  ) {
    return '\u2014';
  }
  return `${((dropped / decoded) * 100).toFixed(2)}%`;
};

export const formatDiagnosticCodec = (codec?: string, profile?: string) =>
  [codec?.toUpperCase() ?? 'UNKNOWN', profile].filter(Boolean).join(' ');

export const formatDiagnosticTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(
    2,
    '0',
  )}`;
