import { describe, it, expect } from 'vitest';
import { mergeNumberRanges } from '../rangeUtils';

describe('mergeNumberRanges', () => {
  it('returns empty array for empty input', () => {
    expect(mergeNumberRanges([])).toEqual([]);
  });

  it('returns a single range unchanged', () => {
    expect(mergeNumberRanges([{ start: 3, end: 7 }])).toEqual([{ start: 3, end: 7 }]);
  });

  it('merges two overlapping ranges', () => {
    const result = mergeNumberRanges([{ start: 0, end: 5 }, { start: 3, end: 8 }]);
    expect(result).toEqual([{ start: 0, end: 8 }]);
  });

  it('merges adjacent ranges whose endpoints meet', () => {
    const result = mergeNumberRanges([{ start: 0, end: 5 }, { start: 5, end: 10 }]);
    expect(result).toEqual([{ start: 0, end: 10 }]);
  });

  it('keeps disjoint ranges separate', () => {
    const result = mergeNumberRanges([{ start: 0, end: 5 }, { start: 6, end: 10 }]);
    expect(result).toEqual([{ start: 0, end: 5 }, { start: 6, end: 10 }]);
  });

  it('sorts ranges before merging', () => {
    const result = mergeNumberRanges([{ start: 10, end: 20 }, { start: 0, end: 5 }]);
    expect(result).toEqual([{ start: 0, end: 5 }, { start: 10, end: 20 }]);
  });

  it('merges three overlapping ranges into one', () => {
    const result = mergeNumberRanges([
      { start: 1, end: 4 },
      { start: 0, end: 2 },
      { start: 3, end: 6 },
    ]);
    expect(result).toEqual([{ start: 0, end: 6 }]);
  });

  it('does not mutate the input array', () => {
    const input = [{ start: 0, end: 5 }, { start: 3, end: 8 }];
    const original = JSON.stringify(input);
    mergeNumberRanges(input);
    expect(JSON.stringify(input)).toBe(original);
  });
});
