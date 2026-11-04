/**
 * The guide grid's arithmetic, kept apart from the screen so it can be tested
 * without a TV.
 *
 * A row is cut into cells that cover the guide's whole time range with no
 * holes: one per programme, and half-hour filler cells wherever the guide has
 * nothing. The remote then always has somewhere to move to, even on a channel
 * without guide data.
 *
 * The cursor is a channel row plus an anchor time. Left and Right move the
 * anchor to the start of the neighbouring cell; Up and Down keep it, so going
 * straight down a column does not drift earlier on every long programme.
 */
import type {LiveTvProgram} from '../../services/jellyfin/liveTv';

export const SLOT_MS = 30 * 60 * 1000;

/** How far ahead the guide goes. Most guide sources carry a day or two. */
export const GUIDE_HORIZON_MS = 24 * 60 * 60 * 1000;

/** How much time is on screen at once. */
export const GUIDE_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface GuideCell {
  start: number;
  end: number;
  /** Missing where the guide has no programme. */
  program?: LiveTvProgram;
}

export interface GuideCursor {
  row: number;
  anchor: number;
}

export const floorToSlot = (time: number) =>
  Math.floor(time / SLOT_MS) * SLOT_MS;

/** Filler cells for a gap, cut on half-hour marks. */
const fillGap = (start: number, end: number): GuideCell[] => {
  const cells: GuideCell[] = [];
  let cursor = start;

  while (cursor < end) {
    const slotEnd = Math.min(end, floorToSlot(cursor) + SLOT_MS);
    cells.push({start: cursor, end: slotEnd});
    cursor = slotEnd;
  }

  return cells;
};

/**
 * One row's cells from `from` to `to`. Programmes are clipped to the range;
 * an overlap in bad guide data is resolved in favour of the earlier one.
 */
export const rowCells = (
  programs: LiveTvProgram[] | undefined,
  from: number,
  to: number,
): GuideCell[] => {
  const cells: GuideCell[] = [];
  let cursor = from;

  [...(programs ?? [])]
    .sort((a, b) => a.startTime - b.startTime)
    .forEach((program) => {
      const start = Math.max(program.startTime, cursor);
      const end = Math.min(program.endTime, to);

      if (end <= start) {
        return;
      }

      cells.push(...fillGap(cursor, start));
      cells.push({start, end, program});
      cursor = end;
    });

  cells.push(...fillGap(cursor, to));

  return cells;
};

/** The cell under a time, or the nearest end cell if the time is outside. */
export const cellIndexAt = (cells: GuideCell[], time: number) => {
  if (cells.length && time < cells[0].start) {
    return 0;
  }

  const index = cells.findIndex(
    (cell) => cell.start <= time && time < cell.end,
  );

  return index >= 0 ? index : Math.max(0, cells.length - 1);
};

/**
 * Where the on-screen window should start so the anchor is in view. It only
 * moves when it has to, and then by whole half hours.
 */
export const windowFor = (
  windowStart: number,
  anchor: number,
  guideStart: number,
) => {
  let start = Math.max(windowStart, guideStart);

  while (anchor >= start + GUIDE_WINDOW_MS) {
    start += SLOT_MS;
  }

  while (anchor < start && start > guideStart) {
    start -= SLOT_MS;
  }

  return Math.max(start, guideStart);
};

/**
 * The cursor after a horizontal move: the start of the cell before or after
 * the focused one. The guide does not go back before `guideStart`, since a
 * programme that has ended cannot be watched.
 */
export const moveHorizontally = (
  cells: GuideCell[],
  anchor: number,
  direction: 1 | -1,
  guideStart: number,
) => {
  const target = cells[cellIndexAt(cells, anchor) + direction];

  return target ? Math.max(target.start, guideStart) : anchor;
};

/** Which rows are on screen, keeping the cursor row in view. */
export const firstVisibleRowFor = (
  firstRow: number,
  row: number,
  visibleRows: number,
) => {
  if (row < firstRow) {
    return row;
  }

  if (row >= firstRow + visibleRows) {
    return row - visibleRows + 1;
  }

  return firstRow;
};

/** The half-hour marks across the window, for the time ruler. */
export const slotMarks = (windowStart: number) => {
  const marks: number[] = [];

  for (let time = windowStart; time < windowStart + GUIDE_WINDOW_MS; ) {
    marks.push(time);
    time += SLOT_MS;
  }

  return marks;
};
