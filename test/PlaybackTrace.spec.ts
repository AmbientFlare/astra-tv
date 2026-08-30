import {getTraces, resetTraces, trace} from '../src/services/logging/trace';

describe('playback traces', () => {
  beforeEach(() => resetTraces());
  afterEach(() => resetTraces());

  it('records label, detail and a relative time', () => {
    trace('reload.start', 'positionSeconds=42.0');
    const [entry] = getTraces();
    expect(entry.label).toBe('reload.start');
    expect(entry.detail).toBe('positionSeconds=42.0');
    expect(entry.sinceStartMs).toBe(0);
  });

  it('bounds the buffer so a reload loop cannot grow it', () => {
    for (let index = 0; index < 200; index += 1) {
      trace('shaka.load.done', `ms=${index}`);
    }
    const traces = getTraces();
    expect(traces).toHaveLength(40);
    expect(traces[traces.length - 1].detail).toBe('ms=199');
  });

  it('never throws, so instrumentation cannot break playback', () => {
    expect(() => trace('x')).not.toThrow();
    expect(getTraces()[0].detail).toBe('');
  });
});
