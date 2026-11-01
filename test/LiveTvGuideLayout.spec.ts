import {
  cellIndexAt,
  firstVisibleRowFor,
  GUIDE_WINDOW_MS,
  moveHorizontally,
  rowCells,
  SLOT_MS,
  slotMarks,
  windowFor,
} from '../src/screens/LiveTvScreen/guideLayout';

const MINUTE = 60 * 1000;
// A half-hour mark, so slots line up with the test's numbers.
const base = Math.floor(Date.parse('2026-10-31T18:00:00Z') / SLOT_MS) * SLOT_MS;
const at = (minutes: number) => base + minutes * MINUTE;
const program = (id: string, start: number, end: number) => ({
  endTime: at(end),
  id,
  name: id,
  startTime: at(start),
});

describe('rowCells', () => {
  it('covers the whole range, filling gaps with half-hour cells', () => {
    const cells = rowCells([program('a', 0, 45)], at(0), at(120));

    expect(cells.map((cell) => cell.program?.id ?? 'gap')).toEqual([
      'a',
      'gap',
      'gap',
      'gap',
    ]);
    // The first filler runs only to the next half-hour mark.
    expect(cells[1]).toEqual({start: at(45), end: at(60)});
    expect(cells[cells.length - 1].end).toBe(at(120));
  });

  it('clips programmes to the range and sorts them', () => {
    const cells = rowCells(
      [program('b', 30, 60), program('a', -20, 30)],
      at(0),
      at(60),
    );

    expect(cells).toEqual([
      {start: at(0), end: at(30), program: program('a', -20, 30)},
      {start: at(30), end: at(60), program: program('b', 30, 60)},
    ]);
  });

  it('keeps the earlier of two overlapping programmes', () => {
    const cells = rowCells(
      [program('a', 0, 40), program('b', 30, 60)],
      at(0),
      at(60),
    );

    expect(cells.map((cell) => [cell.program?.id, cell.start])).toEqual([
      ['a', at(0)],
      ['b', at(40)],
    ]);
  });

  it('cuts a row with no guide into half hours', () => {
    expect(rowCells(undefined, at(0), at(90))).toHaveLength(3);
  });
});

describe('cellIndexAt', () => {
  const cells = rowCells([program('a', 0, 30)], at(0), at(60));

  it('finds the cell under a time, clamping outside the range', () => {
    expect(cellIndexAt(cells, at(10))).toBe(0);
    expect(cellIndexAt(cells, at(30))).toBe(1);
    expect(cellIndexAt(cells, at(-10))).toBe(0);
    expect(cellIndexAt(cells, at(500))).toBe(1);
  });
});

describe('moveHorizontally', () => {
  const cells = rowCells(
    [program('a', -20, 30), program('b', 30, 90)],
    at(0),
    at(240),
  );

  it('moves to the start of the next or previous cell', () => {
    expect(moveHorizontally(cells, at(10), 1, at(0))).toBe(at(30));
    expect(moveHorizontally(cells, at(45), -1, at(0))).toBe(at(0));
  });

  it('stays put at the start of the guide', () => {
    expect(moveHorizontally(cells, at(10), -1, at(0))).toBe(at(10));
  });
});

describe('windowFor', () => {
  it('leaves the window alone while the anchor is in view', () => {
    expect(windowFor(at(0), at(90), at(0))).toBe(at(0));
  });

  it('moves by half hours to bring the anchor into view', () => {
    expect(windowFor(at(0), at(130), at(0))).toBe(at(30));
    expect(windowFor(at(120), at(45), at(0))).toBe(at(30));
  });

  it('never starts before the guide does', () => {
    expect(windowFor(at(-60), at(10), at(0))).toBe(at(0));
  });
});

describe('firstVisibleRowFor', () => {
  it('scrolls only when the row leaves the screen', () => {
    expect(firstVisibleRowFor(0, 4, 6)).toBe(0);
    expect(firstVisibleRowFor(0, 6, 6)).toBe(1);
    expect(firstVisibleRowFor(5, 3, 6)).toBe(3);
  });
});

describe('slotMarks', () => {
  it('marks every half hour across the window', () => {
    expect(slotMarks(at(0))).toHaveLength(GUIDE_WINDOW_MS / SLOT_MS);
    expect(slotMarks(at(0))[1]).toBe(at(30));
  });
});
