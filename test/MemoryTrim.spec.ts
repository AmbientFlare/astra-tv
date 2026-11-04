import {
  collectGarbage,
  onMemoryTrim,
  trimMemory,
} from '../src/services/memoryTrim';
import {releaseFreedMemory} from '@astra/user-engagement';

jest.mock('@astra/user-engagement', () => ({
  releaseFreedMemory: jest.fn(),
}));

const withGc = (gc: unknown, run: () => void) => {
  const host = global as {gc?: unknown};
  const previous = host.gc;
  host.gc = gc;
  try {
    run();
  } finally {
    host.gc = previous;
  }
};

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

  it('collects garbage and returns it after the caches let go', () => {
    const order: string[] = [];
    const off = onMemoryTrim(() => order.push('cache'));
    (releaseFreedMemory as jest.Mock).mockImplementation(() =>
      order.push('release'),
    );
    withGc(
      () => order.push('gc'),
      () => trimMemory('background'),
    );
    expect(order).toEqual(['cache', 'gc', 'release']);
    off();
  });

  it('carries on where the engine has no collector or it throws', () => {
    withGc(undefined, () => expect(collectGarbage).not.toThrow());
    withGc(
      () => {
        throw new Error('no');
      },
      () => expect(collectGarbage).not.toThrow(),
    );
  });
});
