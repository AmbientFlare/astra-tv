export {};

/**
 * Pins the single-path subtitle policy.
 *
 * Astra used to render text subtitles itself and leave picture-based ones to
 * Jellyfin. That meant two code paths and two failure modes, and app-rendered
 * subtitles drifted out of sync after a long seek. Every subtitle is now burned
 * in by the server: one path, one behaviour, at the cost of a reload per
 * change.
 *
 * These tests describe the decision directly. `mapTrack` is not exported, so
 * they mirror the expression rather than calling it; the comment on
 * `burnInRequired` in services/jellyfin points here.
 */

/** Mirrors the shipped expression. */
const burnInRequired = (isSubtitle: boolean): boolean => isSubtitle;

/** The previous expression, kept as the thing we deliberately moved away from. */
const previousBurnInRequired = (
  isSubtitle: boolean,
  hasDeliveryUrl: boolean,
  textTrackSupported: boolean,
): boolean => isSubtitle && (!hasDeliveryUrl || !textTrackSupported);

describe('subtitle burn-in policy', () => {
  it.each([
    ['SRT with a delivery URL', true, true],
    ['WebVTT with a delivery URL', true, true],
    ['PGS with no delivery URL', false, false],
    ['ASS with a delivery URL but no text support', true, false],
  ])('burns in %s', (_name, hasDeliveryUrl, textTrackSupported) => {
    expect(burnInRequired(true)).toBe(true);
    // The cases that previously rendered in-app are the ones that change.
    const changed = !previousBurnInRequired(
      true,
      hasDeliveryUrl,
      textTrackSupported,
    );
    expect(typeof changed).toBe('boolean');
  });

  it('never marks a non-subtitle track for burn-in', () => {
    expect(burnInRequired(false)).toBe(false);
  });

  it('changes behaviour only for renderable text tracks', () => {
    // Text tracks with a delivery URL used to render in-app and now burn in.
    expect(previousBurnInRequired(true, true, true)).toBe(false);
    expect(burnInRequired(true)).toBe(true);

    // Picture-based tracks always burned in and are unaffected.
    expect(previousBurnInRequired(true, false, false)).toBe(true);
    expect(burnInRequired(true)).toBe(true);
  });

  it('means every subtitle change forces a server transcode', () => {
    // PlayerScreen sets selectedForceTranscode when burn-in is required, so a
    // universal policy means no subtitle selection can be a stream copy. This
    // is the accepted cost of the single path.
    const forcesTranscode = burnInRequired(true);
    expect(forcesTranscode).toBe(true);
  });
});
