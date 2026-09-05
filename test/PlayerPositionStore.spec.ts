import {createPositionStore} from '../src/screens/PlayerScreen/positionStore';

describe('position store', () => {
  it('reports the resume position before any tick arrives', () => {
    expect(createPositionStore(42).get()).toBe(42);
    expect(createPositionStore(Number.NaN).get()).toBe(0);
  });

  it('notifies subscribers only when the playhead actually moves', () => {
    const store = createPositionStore(0);
    const seen: number[] = [];
    store.subscribe((seconds) => seen.push(seconds));

    store.set(1.25);
    store.set(1.25);
    store.set(Number.NaN);
    store.set(2.5);

    expect(seen).toEqual([1.25, 2.5]);
    expect(store.get()).toBe(2.5);
  });

  it('stops notifying after unsubscribe', () => {
    const store = createPositionStore(0);
    const seen: number[] = [];
    const unsubscribe = store.subscribe((seconds) => seen.push(seconds));

    store.set(1);
    unsubscribe();
    store.set(2);

    expect(seen).toEqual([1]);
    expect(store.get()).toBe(2);
  });

  it('survives a listener that unsubscribes during notification', () => {
    const store = createPositionStore(0);
    const seen: number[] = [];
    const unsubscribe = store.subscribe(() => unsubscribe());
    store.subscribe((seconds) => seen.push(seconds));

    expect(() => store.set(1)).not.toThrow();
    store.set(2);

    expect(seen).toEqual([1, 2]);
  });
});
