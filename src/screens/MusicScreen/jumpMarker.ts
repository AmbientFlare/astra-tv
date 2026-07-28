/**
 * Works out which letter of the A-Z rail the user is currently sitting in, so
 * the rail can show a position marker.
 *
 * The rule is deliberately simple: look at the middle rows of what is on
 * screen, tally first letters, and the most common wins. Using the middle
 * rather than the whole viewport keeps the marker steady — partially scrolled
 * rows at the top and bottom edge would otherwise make it flicker between two
 * letters.
 */

/** Leading articles that Jellyfin ignores when sorting. */
const ARTICLE_PATTERN = /^(the|a|an)\s+/i;

/**
 * First letter as the server would sort it. Jellyfin sorts on SortName, which
 * drops a leading article — "The Beatles" files under B — so strip those to
 * keep the marker agreeing with the rail's own filtering.
 */
export const sortLetterFor = (title: string): string => {
  const normalized = title.trim().replace(ARTICLE_PATTERN, '');
  const first = normalized.slice(0, 1).toUpperCase();

  return /[A-Z]/.test(first) ? first : '#';
};

/**
 * The middle rows of a viewport.
 *
 * With four rows on screen this returns the middle two, which is what the
 * marker should track — the row under the user's eye, not the ones half
 * clipped at the edges.
 */
export const middleRowItems = <Item>(
  visible: Item[],
  columns: number,
): Item[] => {
  if (!visible.length || columns <= 0) {
    return visible;
  }

  const rows = Math.ceil(visible.length / columns);

  // Fewer than three rows: there is no meaningful "middle", so use everything.
  if (rows < 3) {
    return visible;
  }

  const skipRows = Math.floor((rows - 2) / 2);
  const start = skipRows * columns;

  return visible.slice(start, start + columns * 2);
};

/**
 * Most frequent sort-letter among the given titles.
 *
 * Ties break toward the letter that appears later in the alphabet, matching
 * the intuition that when a screen is half M and half N you have already
 * arrived at N.
 */
export const jumpLetterFor = (titles: string[]): string | null => {
  if (!titles.length) {
    return null;
  }

  const counts = new Map<string, number>();

  titles.forEach((title) => {
    const letter = sortLetterFor(title);

    counts.set(letter, (counts.get(letter) ?? 0) + 1);
  });

  let best: string | null = null;
  let bestCount = 0;

  counts.forEach((count, letter) => {
    if (
      count > bestCount ||
      (count === bestCount && best !== null && letter > best)
    ) {
      best = letter;
      bestCount = count;
    }
  });

  return best;
};

/** Convenience: viewport -> marker letter. */
export const markerLetterFor = (
  visibleTitles: string[],
  columns: number,
): string | null => jumpLetterFor(middleRowItems(visibleTitles, columns));
