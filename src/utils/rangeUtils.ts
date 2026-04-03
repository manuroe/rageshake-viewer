/**
 * Generic number-range utilities shared across modules that merge
 * overlapping intervals (gap expansion and waterfall compression).
 */

/**
 * A simple inclusive-start / exclusive-end numeric range `[start, end)`.
 * Using a flat struct rather than a tuple keeps call sites readable and
 * avoids index-0/index-1 confusion.
 */
export interface NumberRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Merge an array of possibly-overlapping numeric ranges into the minimal
 * covering set, sorted ascending by `start`.
 *
 * Adjacent ranges whose endpoints are equal (`end === nextStart`) are also
 * merged so that the result has no zero-width gaps.
 *
 * Returns a new array; the input is not mutated.
 *
 * @param ranges - Array of `{ start, end }` ranges to merge.
 * @returns Sorted, non-overlapping array of merged ranges.
 *
 * @example
 * mergeNumberRanges([{ start: 0, end: 5 }, { start: 3, end: 8 }])
 * // => [{ start: 0, end: 8 }]
 *
 * @example
 * mergeNumberRanges([{ start: 10, end: 20 }, { start: 0, end: 5 }])
 * // => [{ start: 0, end: 5 }, { start: 10, end: 20 }]
 */
export function mergeNumberRanges(ranges: ReadonlyArray<NumberRange>): NumberRange[] {
  if (ranges.length === 0) return [];

  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<{ start: number; end: number }> = [{ ...sorted[0] }];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    if (current.start <= last.end) {
      // Overlapping or adjacent – extend the last range.
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}
