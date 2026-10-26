import {onMemoryTrim, trimMemory} from '../src/services/memoryTrim';

describe('memoryTrim', () => {
  it('tells every registered cache the level', () => {
    const first = jest.fn();
    const second = jest.fn();
    const offFirst = onMemoryTrim(first);
    const offSecond = onMemoryTrim(second);

    trimMemory('critical');

    expect(first).toHaveBeenCalledWith('critical');
    expect(second).toHaveBeenCalledWith('critical');
    offFirst();
    offSecond();
  });

  it('keeps trimming past a cache that throws', () => {
    const offBroken = onMemoryTrim(() => {
      throw new Error('broken');
    });
    const after = jest.fn();
    const offAfter = onMemoryTrim(after);

    expect(() => trimMemory('background')).not.toThrow();
    expect(after).toHaveBeenCalledWith('background');
    offBroken();
    offAfter();
  });

  it('stops calling a cache once it unsubscribes', () => {
    const listener = jest.fn();
    onMemoryTrim(listener)();

    trimMemory('background');

    expect(listener).not.toHaveBeenCalled();
  });
});
