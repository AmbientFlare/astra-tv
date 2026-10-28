import {
  encodeQr,
  formatBits,
  penaltyScore,
  reedSolomonRemainder,
  versionBits,
} from '../src/services/qr';

// The Ko-fi link at level M with mask 7, as drawn by an independent encoder.
// Astra's own mask choice for this text is also 7.
const KOFI_GOLDEN = [
  '#######..#..#.#...##..#######',
  '#.....#..###....##....#.....#',
  '#.###.#...#...##.#.#..#.###.#',
  '#.###.#..##.##..#.###.#.###.#',
  '#.###.#....#......#...#.###.#',
  '#.....#.#.###..######.#.....#',
  '#######.#.#.#.#.#.#.#.#######',
  '...........###.###..#........',
  '#..#.##.##.#..#.#...##.#.....',
  '.#.#.....###.#.##...###..#..#',
  '.#.#.##......###..##..#..###.',
  '.###.#..#....#..#.#.#..#..##.',
  '....#.#.####..##.#....#..#.##',
  '.#.#.#.##..#.#########.......',
  '.########.##.##...#.##..#####',
  '....#....#.##..#.#.#.##.##.#.',
  '.###..#.##..##...#.###.....#.',
  '.#..#..#....#####....##..#..#',
  '#....###......###.....##...##',
  '...#.#..##.##.#..####...#..##',
  '#..####.###....#...######.#..',
  '........##.#..##.####...#.###',
  '#######...#.#...#...#.#.#..#.',
  '#.....#.#.#.#.##...##...###..',
  '#.###.#..#......##..#####..#.',
  '#.###.#.#.#.##.#.###..#####.#',
  '#.###.#....###.##..##...###.#',
  '#.....#...#.###.##.##.#.#..#.',
  '#######.####.###..#.###..#.#.',
];

const draw = (modules: boolean[][]) =>
  modules.map((row) => row.map((dark) => (dark ? '#' : '.')).join(''));

describe('QR encoder', () => {
  it('draws the Ko-fi link exactly as the reference encoder does', () => {
    const code = encodeQr('https://ko-fi.com/astrafiretv');

    expect(code.version).toBe(3);
    expect(code.size).toBe(29);
    expect(code.mask).toBe(7);
    expect(draw(code.modules)).toEqual(KOFI_GOLDEN);
  });

  it('computes Reed-Solomon codewords for the textbook HELLO WORLD 1-M', () => {
    const data = [
      32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17,
    ];
    expect(reedSolomonRemainder(data, 10)).toEqual([
      196, 35, 39, 119, 235, 215, 231, 226, 93, 23,
    ]);
  });

  it('builds the format and version words from the standard tables', () => {
    expect(formatBits('M', 0)).toBe(0x5412);
    expect(formatBits('L', 0)).toBe(0x77c4);
    expect(formatBits('Q', 0)).toBe(0x355f);
    expect(formatBits('H', 0)).toBe(0x1689);
    expect(formatBits('L', 7)).toBe(0x6976);
    expect(versionBits(7)).toBe(0x07c94);
    expect(versionBits(10)).toBe(0x0a4d3);
  });

  it('picks the smallest version that fits, up to version 10', () => {
    expect(encodeQr('a'.repeat(14)).version).toBe(1);
    expect(encodeQr('a'.repeat(15)).version).toBe(2);
    expect(encodeQr('a'.repeat(213)).version).toBe(10);
    expect(() => encodeQr('a'.repeat(214))).toThrow(/too long/);
  });

  it('draws the version blocks from version 7', () => {
    const code = encodeQr('v'.repeat(120));
    expect(code.version).toBe(7);
    // Bit 0 of the version word sits at the top of the lower-left block.
    expect(code.modules[code.size - 11][0]).toBe(versionBits(7) % 2 === 1);
    expect(code.modules[0][code.size - 11]).toBe(versionBits(7) % 2 === 1);
  });

  it('chooses the mask with the lowest penalty', () => {
    const text = 'https://github.com/AmbientFlare/astra-tv';
    const chosen = encodeQr(text);
    for (let mask = 0; mask < 8; mask++) {
      expect(penaltyScore(chosen.modules)).toBeLessThanOrEqual(
        penaltyScore(encodeQr(text, 'M', mask).modules),
      );
    }
  });
});
