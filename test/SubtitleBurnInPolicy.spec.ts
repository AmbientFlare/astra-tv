import {
  subtitleRequiresBurnIn,
  supportsTextTrack,
} from '../src/services/jellyfin/playbackHelpers';

/**
 * Pins the subtitle delivery policy (issue #20).
 *
 * Burning in every subtitle made the server re-encode video that would
 * otherwise be stream-copied, because Astra sends `AllowVideoStreamCopy: false`
 * and `AlwaysBurnInSubtitleWhenTranscoding: true` whenever burn-in is required.
 * Astra draws text tracks itself, so burn-in is now reserved for the formats it
 * has no renderer for: bitmap subtitles and styled ASS/SSA.
 */
describe('subtitle burn-in policy', () => {
  it.each([['subrip'], ['srt'], ['webvtt'], ['vtt'], ['ttml'], ['mov_text']])(
    'renders %s in-app instead of burning it in',
    (codec) => {
      expect(supportsTextTrack(codec)).toBe(true);
      expect(subtitleRequiresBurnIn({codec})).toBe(false);
    },
  );

  it.each([['pgssub'], ['dvdsub'], ['dvbsub'], ['ass'], ['ssa'], [undefined]])(
    'burns in %s, which has no in-app renderer',
    (codec) => {
      expect(subtitleRequiresBurnIn({codec})).toBe(true);
    },
  );

  it('is case-insensitive about the codec name', () => {
    expect(subtitleRequiresBurnIn({codec: 'SubRip'})).toBe(false);
    expect(subtitleRequiresBurnIn({codec: 'MOV_TEXT'})).toBe(false);
  });

  it('believes a server that answers Encode for a text track', () => {
    // The device profile asks for External delivery of text formats, but a
    // server that decides otherwise is the authority on what it will send.
    expect(
      subtitleRequiresBurnIn({codec: 'subrip', deliveryMethod: 'Encode'}),
    ).toBe(true);
    expect(
      subtitleRequiresBurnIn({codec: 'subrip', deliveryMethod: 'External'}),
    ).toBe(false);
  });
});
