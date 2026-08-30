import {
  getCapturedLogs,
  installReleaseConsole,
  resetCapturedLogs,
} from '../src/services/logging';

describe('release console shim', () => {
  const original = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
  };

  beforeEach(() => {
    resetCapturedLogs();
  });

  afterEach(() => {
    console.log = original.log;
    console.info = original.info;
    console.warn = original.warn;
    console.error = original.error;
    resetCapturedLogs();
  });

  it('captures log, info and warn instead of writing through', () => {
    expect(installReleaseConsole(true)).toBe(true);

    console.log('loading', 3);
    console.info('info line');
    console.warn('careful');

    expect(getCapturedLogs().map((entry) => entry.level)).toEqual([
      'log',
      'info',
      'warn',
    ]);
    expect(getCapturedLogs()[0].message).toBe('loading 3');
  });

  it('leaves console.error connected so real errors still surface', () => {
    const errorSpy = jest.fn();
    console.error = errorSpy;

    installReleaseConsole(true);
    console.error('boom');

    expect(errorSpy).toHaveBeenCalledWith('boom');
    expect(getCapturedLogs()).toHaveLength(0);
  });

  it('installs only once', () => {
    expect(installReleaseConsole(true)).toBe(true);
    expect(installReleaseConsole(true)).toBe(false);
  });

  it('bounds the ring buffer so a chatty native bridge cannot grow it', () => {
    installReleaseConsole(true);

    for (let index = 0; index < 500; index += 1) {
      console.log('entry', index);
    }

    const captured = getCapturedLogs();
    expect(captured).toHaveLength(200);
    // Oldest entries are dropped, newest retained.
    expect(captured[captured.length - 1].message).toBe('entry 499');
  });

  it('truncates long messages and survives unrenderable arguments', () => {
    installReleaseConsole(true);

    console.log('x'.repeat(1000));
    const hostile = {
      toString() {
        throw new Error('nope');
      },
    };
    console.log(hostile);

    const captured = getCapturedLogs();
    expect(captured[0].message.length).toBeLessThanOrEqual(301);
    expect(captured[1].message).toBe('[unrenderable]');
  });
});
