/* eslint-disable no-bitwise -- GF(256) arithmetic and bit packing are the job. */
/**
 * A small QR code encoder (ISO/IEC 18004, model 2) for the short links Astra
 * shows on screen. It covers byte mode and versions 1 to 10, which holds up to
 * 213 bytes at level M, far more than a URL needs. Everything is computed here
 * so the app ships no image per link and no third-party code.
 */

export type QrErrorCorrection = 'L' | 'M' | 'Q' | 'H';

export interface QrCode {
  /** Modules per side, without the quiet zone. */
  size: number;
  version: number;
  mask: number;
  /** Row-major; `true` is a dark module. */
  modules: boolean[][];
}

const MAX_VERSION = 10;

// Per version (index 0 = version 1): total codewords in the symbol.
const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

// Per level, per version: [error correction codewords per block, blocks].
const EC_BLOCKS: Record<QrErrorCorrection, ReadonlyArray<[number, number]>> = {
  L: [
    [7, 1],
    [10, 1],
    [15, 1],
    [20, 1],
    [26, 1],
    [18, 2],
    [20, 2],
    [24, 2],
    [30, 2],
    [18, 4],
  ],
  M: [
    [10, 1],
    [16, 1],
    [26, 1],
    [18, 2],
    [24, 2],
    [16, 4],
    [18, 4],
    [22, 4],
    [22, 5],
    [26, 5],
  ],
  Q: [
    [13, 1],
    [22, 1],
    [18, 2],
    [26, 2],
    [18, 4],
    [24, 4],
    [18, 6],
    [22, 6],
    [20, 8],
    [24, 8],
  ],
  H: [
    [17, 1],
    [28, 1],
    [22, 2],
    [16, 4],
    [22, 4],
    [28, 4],
    [26, 5],
    [26, 6],
    [24, 8],
    [28, 8],
  ],
};

// Centre rows/columns of the alignment patterns, per version.
const ALIGNMENT_CENTRES: ReadonlyArray<readonly number[]> = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

// The two bits the format information uses for each level.
const LEVEL_BITS: Record<QrErrorCorrection, number> = {L: 1, M: 0, Q: 3, H: 2};

// ---- Galois field GF(2^8) with the QR polynomial x^8+x^4+x^3+x^2+1 ----

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let value = 1;
  for (let power = 0; power < 255; power++) {
    EXP[power] = value;
    LOG[value] = power;
    value <<= 1;
    if (value & 0x100) {
      value ^= 0x11d;
    }
  }
  for (let power = 255; power < 512; power++) {
    EXP[power] = EXP[power - 255];
  }
})();

const multiply = (a: number, b: number) =>
  a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];

/** Coefficients of prod(x - a^i) for i < degree, highest power first. */
const generatorPolynomial = (degree: number): number[] => {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array(poly.length + 1).fill(0);
    poly.forEach((coefficient, j) => {
      next[j] ^= coefficient;
      next[j + 1] ^= multiply(coefficient, EXP[i]);
    });
    poly = next;
  }
  return poly;
};

/** The remainder of data * x^degree divided by the generator. */
export const reedSolomonRemainder = (
  data: readonly number[],
  degree: number,
): number[] => {
  const generator = generatorPolynomial(degree);
  const remainder = new Array(degree).fill(0);
  data.forEach((byte) => {
    const factor = byte ^ (remainder.shift() as number);
    remainder.push(0);
    for (let i = 0; i < degree; i++) {
      remainder[i] ^= multiply(generator[i + 1], factor);
    }
  });
  return remainder;
};

// ---- Data codewords ----

const utf8Bytes = (text: string): number[] => {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(
        0xe0 | (code >> 12),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
};

const dataCapacity = (version: number, level: QrErrorCorrection) => {
  const [ecPerBlock, blocks] = EC_BLOCKS[level][version - 1];
  return TOTAL_CODEWORDS[version - 1] - ecPerBlock * blocks;
};

// Byte mode counts characters in 8 bits up to version 9, 16 from version 10.
const countBits = (version: number) => (version < 10 ? 8 : 16);

const dataCodewords = (
  bytes: readonly number[],
  version: number,
  level: QrErrorCorrection,
): number[] => {
  const bits: number[] = [];
  const append = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) {
      bits.push((value >> i) & 1);
    }
  };
  append(0b0100, 4);
  append(bytes.length, countBits(version));
  bytes.forEach((byte) => append(byte, 8));

  const capacityBits = dataCapacity(version, level) * 8;
  append(0, Math.min(4, capacityBits - bits.length));
  append(0, (8 - (bits.length % 8)) % 8);

  const codewords: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    codewords.push(bits.slice(i, i + 8).reduce((acc, bit) => acc * 2 + bit));
  }
  for (
    let pad = 0xec;
    codewords.length < capacityBits / 8;
    pad ^= 0xec ^ 0x11
  ) {
    codewords.push(pad);
  }
  return codewords;
};

/** Splits data into blocks, adds error correction, and interleaves both. */
const finalCodewords = (
  data: readonly number[],
  version: number,
  level: QrErrorCorrection,
): number[] => {
  const [ecPerBlock, blockCount] = EC_BLOCKS[level][version - 1];
  const shortLength = Math.floor(data.length / blockCount);
  const longBlocks = data.length % blockCount;
  const blocks: number[][] = [];
  let offset = 0;
  for (let b = 0; b < blockCount; b++) {
    const length = shortLength + (b >= blockCount - longBlocks ? 1 : 0);
    blocks.push(data.slice(offset, offset + length));
    offset += length;
  }
  const corrections = blocks.map((block) =>
    reedSolomonRemainder(block, ecPerBlock),
  );

  const result: number[] = [];
  for (let i = 0; i <= shortLength; i++) {
    blocks.forEach((block) => {
      if (i < block.length) {
        result.push(block[i]);
      }
    });
  }
  for (let i = 0; i < ecPerBlock; i++) {
    corrections.forEach((correction) => result.push(correction[i]));
  }
  return result;
};

// ---- The symbol ----

/** BCH remainder of `value << (generatorBits - 1)` by the generator. */
const bchRemainder = (value: number, generator: number) => {
  const generatorLength = Math.floor(Math.log2(generator));
  let remainder = value << generatorLength;
  for (let bit = 31 - Math.clz32(remainder); bit >= generatorLength; bit--) {
    if ((remainder >> bit) & 1) {
      remainder ^= generator << (bit - generatorLength);
    }
  }
  return remainder;
};

export const formatBits = (level: QrErrorCorrection, mask: number) => {
  const data = (LEVEL_BITS[level] << 3) | mask;
  return ((data << 10) | bchRemainder(data, 0x537)) ^ 0x5412;
};

export const versionBits = (version: number) =>
  (version << 12) | bchRemainder(version, 0x1f25);

const MASKS: ReadonlyArray<(row: number, col: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

class QrSymbol {
  readonly size: number;
  readonly dark: boolean[][];
  // Modules that belong to a function pattern and carry no data.
  readonly reserved: boolean[][];

  constructor(readonly version: number) {
    this.size = version * 4 + 17;
    this.dark = this.grid();
    this.reserved = this.grid();
    this.drawFunctionPatterns();
  }

  private grid() {
    return Array.from({length: this.size}, () =>
      new Array<boolean>(this.size).fill(false),
    );
  }

  set(row: number, col: number, dark: boolean) {
    this.dark[row][col] = dark;
    this.reserved[row][col] = true;
  }

  private drawFunctionPatterns() {
    const {size} = this;
    for (let i = 0; i < size; i++) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(3, size - 4);
    this.drawFinder(size - 4, 3);

    const centres = ALIGNMENT_CENTRES[this.version - 1];
    centres.forEach((row) =>
      centres.forEach((col) => {
        const onFinder =
          (row === 6 && col === 6) ||
          (row === 6 && col === size - 7) ||
          (row === size - 7 && col === 6);
        if (!onFinder) {
          this.drawAlignment(row, col);
        }
      }),
    );

    // Reserve the format areas now; their bits depend on the mask.
    this.drawFormat(0);
    this.drawVersion();
  }

  private drawFinder(centreRow: number, centreCol: number) {
    for (let dr = -4; dr <= 4; dr++) {
      for (let dc = -4; dc <= 4; dc++) {
        const row = centreRow + dr;
        const col = centreCol + dc;
        if (row < 0 || col < 0 || row >= this.size || col >= this.size) {
          continue;
        }
        const ring = Math.max(Math.abs(dr), Math.abs(dc));
        this.set(row, col, ring !== 2 && ring !== 4);
      }
    }
  }

  private drawAlignment(centreRow: number, centreCol: number) {
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        this.set(
          centreRow + dr,
          centreCol + dc,
          Math.max(Math.abs(dr), Math.abs(dc)) !== 1,
        );
      }
    }
  }

  drawFormat(bits: number) {
    const {size} = this;
    const bit = (i: number) => ((bits >> i) & 1) === 1;
    // Around the top-left finder: down column 8, then left along row 8.
    for (let i = 0; i <= 5; i++) {
      this.set(i, 8, bit(i));
    }
    this.set(7, 8, bit(6));
    this.set(8, 8, bit(7));
    this.set(8, 7, bit(8));
    for (let i = 9; i <= 14; i++) {
      this.set(8, 14 - i, bit(i));
    }
    // The copy split between the other two finders.
    for (let i = 0; i <= 7; i++) {
      this.set(8, size - 1 - i, bit(i));
    }
    for (let i = 8; i <= 14; i++) {
      this.set(size - 15 + i, 8, bit(i));
    }
    this.set(size - 8, 8, true);
  }

  private drawVersion() {
    if (this.version < 7) {
      return;
    }
    const bits = versionBits(this.version);
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >> i) & 1) === 1;
      const near = Math.floor(i / 3);
      const far = this.size - 11 + (i % 3);
      this.set(near, far, dark);
      this.set(far, near, dark);
    }
  }

  /** Places codewords in the two-column zigzag, from the bottom right. */
  drawCodewords(codewords: readonly number[]) {
    const {size} = this;
    let bitIndex = 0;
    const totalBits = codewords.length * 8;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) {
        // The vertical timing pattern takes column 6 whole.
        right = 5;
      }
      for (let step = 0; step < size; step++) {
        const row = upward ? size - 1 - step : step;
        for (const col of [right, right - 1]) {
          if (this.reserved[row][col]) {
            continue;
          }
          if (bitIndex < totalBits) {
            const byte = codewords[bitIndex >> 3];
            this.dark[row][col] = ((byte >> (7 - (bitIndex & 7))) & 1) === 1;
            bitIndex++;
          }
        }
      }
      upward = !upward;
    }
  }

  applyMask(mask: number) {
    const test = MASKS[mask];
    for (let row = 0; row < this.size; row++) {
      for (let col = 0; col < this.size; col++) {
        if (!this.reserved[row][col] && test(row, col)) {
          this.dark[row][col] = !this.dark[row][col];
        }
      }
    }
  }
}

/** The standard's penalty score; the mask with the lowest one is used. */
export const penaltyScore = (modules: boolean[][]): number => {
  const size = modules.length;
  let score = 0;
  const line = (index: number, horizontal: boolean) =>
    Array.from({length: size}, (_, i) =>
      horizontal ? modules[index][i] : modules[i][index],
    );

  for (let index = 0; index < size; index++) {
    for (const horizontal of [true, false]) {
      const cells = line(index, horizontal);
      // Rule 1: runs of five or more of one colour.
      let run = 1;
      for (let i = 1; i <= size; i++) {
        if (i < size && cells[i] === cells[i - 1]) {
          run++;
        } else {
          if (run >= 5) {
            score += run - 2;
          }
          run = 1;
        }
      }
      // Rule 3: 1:1:3:1:1 finder look-alikes with four light modules beside.
      const padded = [
        ...new Array(4).fill(false),
        ...cells,
        ...new Array(4).fill(false),
      ];
      const finder = [true, false, true, true, true, false, true];
      for (let i = 0; i + 7 <= padded.length; i++) {
        if (!finder.every((dark, k) => padded[i + k] === dark)) {
          continue;
        }
        const lightBefore = i >= 4 && [1, 2, 3, 4].every((k) => !padded[i - k]);
        const lightAfter =
          i + 11 <= padded.length && [7, 8, 9, 10].every((k) => !padded[i + k]);
        if (lightBefore || lightAfter) {
          score += 40;
        }
      }
    }
  }

  // Rule 2: 2x2 blocks of one colour.
  for (let row = 0; row + 1 < size; row++) {
    for (let col = 0; col + 1 < size; col++) {
      const colour = modules[row][col];
      if (
        modules[row][col + 1] === colour &&
        modules[row + 1][col] === colour &&
        modules[row + 1][col + 1] === colour
      ) {
        score += 3;
      }
    }
  }

  // Rule 4: how far the dark share strays from half, in 5% steps.
  const dark = modules.reduce(
    (count, row) => count + row.filter(Boolean).length,
    0,
  );
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
};

/**
 * Encodes `text` (as UTF-8) in the smallest version that fits. Throws if it
 * needs more than version 10. `forceMask` skips the mask choice, for tests.
 */
export const encodeQr = (
  text: string,
  level: QrErrorCorrection = 'M',
  forceMask?: number,
): QrCode => {
  const bytes = utf8Bytes(text);
  let version = 1;
  while (
    version <= MAX_VERSION &&
    4 + countBits(version) + bytes.length * 8 > dataCapacity(version, level) * 8
  ) {
    version++;
  }
  if (version > MAX_VERSION) {
    throw new Error(`Text is too long for a QR code: ${bytes.length} bytes`);
  }

  const codewords = finalCodewords(
    dataCodewords(bytes, version, level),
    version,
    level,
  );

  let best: {mask: number; modules: boolean[][]; score: number} | null = null;
  for (let mask = 0; mask < MASKS.length; mask++) {
    if (forceMask !== undefined && mask !== forceMask) {
      continue;
    }
    const symbol = new QrSymbol(version);
    symbol.drawCodewords(codewords);
    symbol.applyMask(mask);
    symbol.drawFormat(formatBits(level, mask));
    const score = penaltyScore(symbol.dark);
    if (!best || score < best.score) {
      best = {mask, modules: symbol.dark, score};
    }
  }
  const chosen = best as {mask: number; modules: boolean[][]};
  return {
    mask: chosen.mask,
    modules: chosen.modules,
    size: version * 4 + 17,
    version,
  };
};
