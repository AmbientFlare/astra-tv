/**
 * The JavaScript engine's own memory numbers, in whole megabytes.
 *
 * Vitals reports some 1.6.3 crashes as a Hermes fatal error with nothing but
 * engine frames: no reason and no JS stack. Running out of JS heap is the
 * usual cause, and ArrayBuffers (media segments) count as external memory
 * against the same limit. Recording the heap next to each crash tail is how
 * we tell that apart from an internal engine fault.
 */
export interface JsHeapSnapshot {
  /** Bytes held by the garbage-collected heap. */
  heapMb: number;
  /** Bytes the heap has reserved from the OS. */
  allocatedMb: number;
  /** Native memory owned by JS objects, mostly ArrayBuffers. */
  externalMb: number;
}

type InstrumentedStats = Record<string, number | undefined>;

const toMb = (bytes: number | undefined) =>
  typeof bytes === 'number' && Number.isFinite(bytes)
    ? Math.round(bytes / (1024 * 1024))
    : undefined;

export const readJsHeap = (): JsHeapSnapshot | undefined => {
  try {
    const hermes = (
      globalThis as unknown as {
        HermesInternal?: {getInstrumentedStats?: () => InstrumentedStats};
      }
    ).HermesInternal;
    const stats = hermes?.getInstrumentedStats?.();
    if (!stats) {
      return undefined;
    }
    const heapMb = toMb(stats.js_allocatedBytes);
    const allocatedMb = toMb(stats.js_heapSize);
    const externalMb = toMb(stats.js_externalBytes);
    if (heapMb === undefined || allocatedMb === undefined) {
      return undefined;
    }
    return {heapMb, allocatedMb, externalMb: externalMb ?? 0};
  } catch {
    return undefined;
  }
};

export const describeJsHeap = (heap: JsHeapSnapshot | undefined): string =>
  heap
    ? `${heap.heapMb} MB used / ${heap.allocatedMb} MB heap, ${heap.externalMb} MB external`
    : 'unavailable';
