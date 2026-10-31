/**
 * Fills in the stream details Jellyfin leaves off a master playlist when it
 * knows nothing about the source.
 *
 * Jellyfin never probes a stream from a channel plugin, so for a live plugin
 * channel it has no video or audio stream on record. Its master playlist then
 * has no CODECS, RESOLUTION or FRAME-RATE. Shaka asks the device whether it
 * can play such a variant as an unknown codec at 64x64 and 1 fps, Vega says
 * no, and playback fails with error 4032. FFmpeg falls back to its HLS
 * defaults for such a source, H.264 and AAC, so those are the codecs the
 * segments really carry. The size and rate only need to be ones the device
 * accepts; the real picture can be smaller.
 *
 * BANDWIDTH is only the bitrate the app asked for (up to about 80 Mbps), not
 * what FFmpeg makes: it is given no bitrate for such a source. Vega turns down
 * H.264 at that rate, so it is capped too.
 */

const STREAM_INF = '#EXT-X-STREAM-INF:';

/** How to describe Jellyfin's output for a source it has no details for. */
export const UNPROBED_SOURCE_ATTRIBUTES: Readonly<Record<string, string>> = {
  CODECS: '"avc1.640028,mp4a.40.2"',
  RESOLUTION: '1920x1080',
  'FRAME-RATE': '30',
};

/** Highest BANDWIDTH Vega accepts for the codecs above, in bits per second. */
export const UNPROBED_SOURCE_MAX_BANDWIDTH = 20_000_000;

const BANDWIDTH = /([:,](?:AVERAGE-)?BANDWIDTH=)(\d+)/g;

const hasAttribute = (line: string, name: string) =>
  new RegExp(`[:,]${name}=`).test(line);

/**
 * The master playlist with `attributes` added to every variant that names no
 * codecs (each one only where the variant lacks it) and its bandwidth capped
 * at `maxBandwidth`, or null when there was no such variant (a media
 * playlist, or every variant names its codecs).
 */
export const describeUnprobedVariants = (
  playlist: string,
  attributes: Readonly<Record<string, string>>,
  maxBandwidth: number,
): string | null => {
  let changed = false;
  const lines = playlist.split('\n').map((line) => {
    if (!line.startsWith(STREAM_INF) || hasAttribute(line, 'CODECS')) {
      return line;
    }
    changed = true;
    const ending = line.endsWith('\r') ? '\r' : '';
    const added = Object.entries(attributes)
      .filter(([name]) => !hasAttribute(line, name))
      .map(([name, value]) => `,${name}=${value}`)
      .join('');
    const capped = line
      .replace(/\r$/, '')
      .replace(BANDWIDTH, (_, name: string, value: string) =>
        Number(value) > maxBandwidth ? `${name}${maxBandwidth}` : _,
      );
    return `${capped}${added}${ending}`;
  });

  return changed ? lines.join('\n') : null;
};
