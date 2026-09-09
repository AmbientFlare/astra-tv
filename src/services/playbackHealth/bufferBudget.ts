/**
 * Shaka's buffer goals are expressed in seconds, which makes them blind to
 * bitrate: a 10s goal is 2.9 MB of a 2.3 Mbps episode and 31 MB of a 25 Mbps
 * 4K movie. On a 1 GB device that difference decides whether the media buffer
 * is comfortable or is the largest allocation in the process.
 *
 * These helpers convert a fixed byte budget into the three second-valued knobs
 * Shaka actually accepts, so every title targets roughly the same memory
 * footprint. The split biases forward (resume-after-stall health) over behind
 * (backward seek), while still keeping a usable backward window.
 *
 * `bufferBehind` is set explicitly and deliberately: Shaka's 30s default is
 * ~90 MB at 25 Mbps and its eviction pass is the leading suspect for the
 * full-buffer collapses seen on high-bitrate Dolby Vision titles.
 */
export const MEDIA_BUFFER_BUDGET_BYTES = 50 * 1024 * 1024;

export interface BufferBudget {
  /** Seconds of media Shaka fetches ahead of the playhead. */
  bufferingGoal: number;
  /** Seconds that must be queued before playback resumes from a stall. */
  rebufferingGoal: number;
  /** Seconds retained behind the playhead before eviction. */
  bufferBehind: number;
}

/**
 * Used when the stream reports no usable bitrate. Deliberately mid-range
 * rather than generous: an unknown bitrate may be the 33 Mbps tail.
 */
export const DEFAULT_BUFFER_BUDGET: BufferBudget = {
  bufferingGoal: 10,
  rebufferingGoal: 4,
  bufferBehind: 10,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const round = (seconds: number) => Math.round(seconds * 10) / 10;

/**
 * @param bitrateBps Total delivered bitrate. Prefer the manifest BANDWIDTH,
 *   which already includes the muxed audio track, over a video-only figure.
 */
export const computeBufferBudget = (
  bitrateBps?: number,
  budgetBytes: number = MEDIA_BUFFER_BUDGET_BYTES,
): BufferBudget => {
  if (
    typeof bitrateBps !== 'number' ||
    !Number.isFinite(bitrateBps) ||
    bitrateBps <= 0
  ) {
    return DEFAULT_BUFFER_BUDGET;
  }
  const bytesPerSecond = bitrateBps / 8;
  const bufferingGoal = clamp((budgetBytes * 0.6) / bytesPerSecond, 8, 20);
  return {
    bufferingGoal: round(bufferingGoal),
    rebufferingGoal: round(clamp(bufferingGoal * 0.4, 4, 7)),
    bufferBehind: round(clamp((budgetBytes * 0.25) / bytesPerSecond, 8, 15)),
  };
};
