import {
  DEFAULT_BUFFER_BUDGET,
  MEDIA_BUFFER_BUDGET_BYTES,
  computeBufferBudget,
} from '../src/services/playbackHealth';

const bytesHeld = (bitrateBps: number) => {
  const {bufferingGoal, bufferBehind} = computeBufferBudget(bitrateBps);
  return ((bufferingGoal + bufferBehind) * bitrateBps) / 8;
};

describe('computeBufferBudget', () => {
  it('falls back when the bitrate is unknown or nonsense', () => {
    expect(computeBufferBudget(undefined)).toEqual(DEFAULT_BUFFER_BUDGET);
    expect(computeBufferBudget(0)).toEqual(DEFAULT_BUFFER_BUDGET);
    expect(computeBufferBudget(-1)).toEqual(DEFAULT_BUFFER_BUDGET);
    expect(computeBufferBudget(Number.NaN)).toEqual(DEFAULT_BUFFER_BUDGET);
  });

  it('keeps a high-bitrate 4K title inside a sane footprint', () => {
    // Central Intelligence: manifest BANDWIDTH 24,836,532.
    const budget = computeBufferBudget(24_836_532);
    expect(budget.bufferingGoal).toBeGreaterThanOrEqual(8);
    expect(budget.bufferingGoal).toBeLessThanOrEqual(12);
    // Well under Shaka's 30s default, which is the point of setting it.
    expect(budget.bufferBehind).toBeLessThanOrEqual(15);
    expect(bytesHeld(24_836_532)).toBeLessThan(
      MEDIA_BUFFER_BUDGET_BYTES * 1.25,
    );
  });

  it('gives a typical episode the full time-based window', () => {
    // Library median is 2.3 Mbps; the byte budget is not the constraint here.
    const budget = computeBufferBudget(2_300_000);
    expect(budget.bufferingGoal).toBe(20);
    expect(budget.rebufferingGoal).toBe(7);
    expect(budget.bufferBehind).toBe(15);
    expect(bytesHeld(2_300_000)).toBeLessThan(MEDIA_BUFFER_BUDGET_BYTES / 4);
  });

  it('never resumes as thin as the previous fixed 2s goal', () => {
    for (const bitrate of [1_000_000, 7_600_000, 24_800_000, 33_000_000]) {
      const budget = computeBufferBudget(bitrate);
      expect(budget.rebufferingGoal).toBeGreaterThanOrEqual(4);
      expect(budget.rebufferingGoal).toBeLessThan(budget.bufferingGoal);
      expect(budget.bufferBehind).toBeGreaterThanOrEqual(8);
    }
  });

  it('biases forward of the playhead', () => {
    const budget = computeBufferBudget(24_836_532);
    expect(budget.bufferingGoal).toBeGreaterThan(budget.bufferBehind);
  });
});
