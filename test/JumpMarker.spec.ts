import {
  jumpLetterFor,
  markerLetterFor,
  middleRowItems,
  sortLetterFor,
} from '../src/screens/MusicScreen/jumpMarker';

describe('sortLetterFor', () => {
  it('uses the first letter', () => {
    expect(sortLetterFor('Metallica')).toBe('M');
  });

  it('ignores a leading article, matching how the server sorts', () => {
    // Jellyfin files "The Beatles" under B, so the marker must agree with the
    // rail rather than saying T.
    expect(sortLetterFor('The Beatles')).toBe('B');
    expect(sortLetterFor('A Perfect Circle')).toBe('P');
    expect(sortLetterFor('An Horse')).toBe('H');
  });

  it('does not strip an article that is part of the name', () => {
    expect(sortLetterFor('Theory of a Deadman')).toBe('T');
    expect(sortLetterFor('Anthrax')).toBe('A');
  });

  it('files anything non-alphabetic under #', () => {
    expect(sortLetterFor('50 Cent')).toBe('#');
    expect(sortLetterFor('$O$')).toBe('#');
    expect(sortLetterFor('...And Justice For All')).toBe('#');
  });

  it('handles whitespace and empty input', () => {
    expect(sortLetterFor('   Nirvana')).toBe('N');
    expect(sortLetterFor('')).toBe('#');
  });
});

describe('middleRowItems', () => {
  const grid = (count: number) =>
    Array.from({length: count}, (_, index) => index);

  it('returns the middle two rows of a four-row viewport', () => {
    // 4 rows of 8; middle two are indices 8..23.
    expect(middleRowItems(grid(32), 8)).toEqual(
      Array.from({length: 16}, (_, index) => index + 8),
    );
  });

  it('returns everything when there are fewer than three rows', () => {
    expect(middleRowItems(grid(16), 8)).toEqual(grid(16));
    expect(middleRowItems(grid(5), 8)).toEqual(grid(5));
  });

  it('handles a partial trailing row', () => {
    const middle = middleRowItems(grid(20), 8);

    expect(middle.length).toBeGreaterThan(0);
    expect(middle.length).toBeLessThanOrEqual(16);
  });

  it('tolerates empty input and a zero column count', () => {
    expect(middleRowItems([], 8)).toEqual([]);
    expect(middleRowItems(grid(4), 0)).toEqual(grid(4));
  });
});

describe('jumpLetterFor', () => {
  it('picks the most common letter', () => {
    const titles = [...Array(5).fill('Metallica'), ...Array(7).fill('Nirvana')];

    // 5 M's against 7 N's -> N, exactly the worked example.
    expect(jumpLetterFor(titles)).toBe('N');
  });

  it('breaks a tie toward the later letter', () => {
    // Half M, half N reads as having arrived at N.
    expect(jumpLetterFor(['Metallica', 'Nirvana'])).toBe('N');
  });

  it('returns null for an empty viewport', () => {
    expect(jumpLetterFor([])).toBeNull();
  });

  it('can land on #', () => {
    expect(jumpLetterFor(['50 Cent', '$O$', 'Abba'])).toBe('#');
  });
});

describe('markerLetterFor', () => {
  it('reports the letter dominating the middle of the screen', () => {
    // Top row A, middle rows all B, bottom row C: the marker follows the
    // middle, not the edges.
    const visible = [
      ...Array(8).fill('Abba'),
      ...Array(16).fill('Beatles'),
      ...Array(8).fill('Cake'),
    ];

    expect(markerLetterFor(visible, 8)).toBe('B');
  });

  it('returns null when nothing is visible', () => {
    expect(markerLetterFor([], 8)).toBeNull();
  });
});
