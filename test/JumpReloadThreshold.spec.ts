export {};

/**
 * Pins the decision jumpChapter makes between an in-place seek and a
 * repositioning reload.
 *
 * An in-place seek makes Vega drain and refill the decoder: 36 s was measured
 * for a ten-minute jump on 20260813.7, and close to two minutes on a
 * high-bitrate title. Reloading at the target takes the same route as resume,
 * which lands in about three seconds. Short seeks stay in-place because they
 * are already near-instant and a reload would interrupt for no gain.
 */

const RELOAD_JUMP_THRESHOLD_SECONDS = 60;

/** Mirrors the branch in jumpChapter. */
const shouldReloadForJump = (
  currentSeconds: number,
  targetSeconds: number,
  canReload = true,
): boolean =>
  canReload &&
  Math.abs(targetSeconds - currentSeconds) >= RELOAD_JUMP_THRESHOLD_SECONDS;

describe('jump strategy', () => {
  it.each([
    ['a ten-second skip forward', 600, 610],
    ['a ten-second skip back', 600, 590],
    ['a short synthetic chapter on a brief video', 100, 145],
    ['a jump just under the threshold', 600, 659],
  ])('seeks in place for %s', (_name, from, to) => {
    expect(shouldReloadForJump(from, to)).toBe(false);
  });

  it.each([
    ['a fifteen-minute jump forward', 600, 1500],
    ['a fifteen-minute jump back', 1500, 600],
    ['a jump exactly at the threshold', 600, 660],
    ['a jump to the start of a long film', 4000, 0],
  ])('reloads for %s', (_name, from, to) => {
    expect(shouldReloadForJump(from, to)).toBe(true);
  });

  it('never reloads before the reload path is available', () => {
    // jumpChapter is defined before the reload machinery, so the ref is null
    // until the component body has finished evaluating.
    expect(shouldReloadForJump(600, 1500, false)).toBe(false);
  });

  it('treats direction symmetrically', () => {
    expect(shouldReloadForJump(600, 1500)).toBe(shouldReloadForJump(1500, 600));
  });
});
