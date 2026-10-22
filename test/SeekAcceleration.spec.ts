import {SeekAcceleration} from '../src/services/videoSeeking/acceleration';

describe('held-key scan acceleration', () => {
  it('increases from 10 to 30 to 60 seconds without exceeding the cap', () => {
    const scan = new SeekAcceleration();
    expect(scan.step(1, 10, 0)).toBe(10);
    for (let time = 100; time < 1000; time += 100) {
      scan.step(1, 10, time);
    }
    expect(scan.step(1, 10, 1000)).toBe(30);
    for (let time = 1100; time < 2500; time += 100) {
      scan.step(1, 10, time);
    }
    expect(scan.step(1, 10, 2500)).toBe(60);
    expect(scan.step(1, 10, 2600)).toBe(60);
  });

  it('keeps rapid taps at the configured step when releases arrive', () => {
    const scan = new SeekAcceleration();
    for (let time = 0; time < 4000; time += 200) {
      expect(scan.step(1, 15, time)).toBe(15);
      scan.release(1);
    }
  });

  it('resets on a direction change, a gap, or an explicit cancellation', () => {
    const scan = new SeekAcceleration();
    for (let time = 0; time <= 1000; time += 100) {
      scan.step(1, 10, time);
    }
    expect(scan.step(-1, 10, 1100)).toBe(10);
    for (let time = 1200; time <= 2100; time += 100) {
      scan.step(-1, 10, time);
    }
    expect(scan.step(-1, 10, 2200)).toBe(30);
    expect(scan.step(-1, 10, 2800)).toBe(10);
    scan.reset();
    expect(scan.step(-1, 10, 2900)).toBe(10);
  });

  it('ignores the old direction’s release after reversing', () => {
    const scan = new SeekAcceleration();
    scan.step(1, 10, 0);
    scan.step(-1, 10, 100);
    expect(scan.release(1)).toBe(false);
    for (let time = 200; time < 1100; time += 100) {
      scan.step(-1, 10, time);
    }
    expect(scan.step(-1, 10, 1100)).toBe(30);
  });

  it('honors larger configured steps without accelerating beyond 60 seconds', () => {
    const scan = new SeekAcceleration();
    for (let time = 0; time < 1000; time += 100) {
      scan.step(1, 30, time);
    }
    expect(scan.step(1, 30, 1000)).toBe(60);
    expect(scan.step(1, 60, 1100)).toBe(60);
  });
});
