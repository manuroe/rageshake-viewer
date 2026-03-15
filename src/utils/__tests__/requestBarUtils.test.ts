import { describe, expect, it } from 'vitest';
import { buildAttemptSegments, getAttemptSegmentColor } from '../requestBarUtils';

describe('getAttemptSegmentColor', () => {
  it('returns the HTTP status color for numeric outcome strings', () => {
    // 200 is a known code → specific CSS variable, not the category fallback
    const color = getAttemptSegmentColor('200');
    expect(color).toBe('var(--http-200)');
  });

  it('returns the incomplete color for "Incomplete"', () => {
    expect(getAttemptSegmentColor('Incomplete')).toBe('var(--http-incomplete)');
  });

  it('returns the client-error color for non-numeric, non-Incomplete outcomes', () => {
    expect(getAttemptSegmentColor('TimedOut')).toBe('var(--http-client-error)');
    expect(getAttemptSegmentColor('ConnectionRefused')).toBe('var(--http-client-error)');
  });
});

describe('buildAttemptSegments', () => {
  it('returns an empty array for zero totalMs', () => {
    expect(buildAttemptSegments(['200'], [0], 0, 100)).toEqual([]);
  });

  it('returns an empty array for negative totalMs', () => {
    expect(buildAttemptSegments(['200'], [0], -1, 100)).toEqual([]);
  });

  it('returns an empty array for empty outcomes', () => {
    expect(buildAttemptSegments([], [], 1000, 100)).toEqual([]);
  });

  it('returns an empty array when timestamps are fewer than outcomes', () => {
    expect(buildAttemptSegments(['503', '200'], [0], 1000, 100)).toEqual([]);
  });

  it('produces one segment occupying the full bar for a single outcome', () => {
    const segs = buildAttemptSegments(['200'], [0], 1000, 100);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ leftPx: 0, widthPx: 100 });
  });

  it('produces two proportional segments for two outcomes', () => {
    // seg 0 spans 250ms (25%), seg 1 spans 750ms (75%) of 1000ms
    const ts = [0, 250_000]; // µs
    const segs = buildAttemptSegments(['503', '200'], ts, 1000, 100);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ leftPx: 0, widthPx: 25 });
    expect(segs[1]).toMatchObject({ leftPx: 25, widthPx: 75 });
  });

  it('segment widths always sum exactly to barWidthPx', () => {
    // Irregular proportions to exercise remainder distribution
    const ts = [0, 333_333, 666_667]; // µs → ~33% / ~33% / ~33%
    const segs = buildAttemptSegments(['503', 'TimedOut', '200'], ts, 1000, 7);
    const total = segs.reduce((sum, s) => sum + s.widthPx, 0);
    expect(total).toBe(7);
  });

  /**
   * Regression test: with barWidthPx=2 and 4 equal-proportion segments,
   * Math.round(0.5) = 1 for each of the 3 non-last segments, causing usedPx to
   * accumulate to 3 > barWidthPx=2 without clamping. The fix clamps each
   * non-last segment to the remaining pixels so the sum invariant holds.
   */
  it('clamps non-last segments to prevent usedPx exceeding barWidthPx', () => {
    // 4 equal segments of 25% each, totalMs=4ms
    const ts = [0, 1_000, 2_000, 3_000]; // µs
    const segs = buildAttemptSegments(['503', '503', '503', '200'], ts, 4, 2);
    const total = segs.reduce((sum, s) => sum + s.widthPx, 0);
    expect(total).toBe(2);
    segs.forEach((s) => {
      expect(s.widthPx).toBeGreaterThanOrEqual(0);
    });
  });

  it('assigns correct leftPx offsets (cumulative sum of preceding widths)', () => {
    const ts = [0, 500_000]; // µs → 50/50 split
    const segs = buildAttemptSegments(['503', '200'], ts, 1000, 100);
    expect(segs[0].leftPx).toBe(0);
    expect(segs[1].leftPx).toBe(segs[0].widthPx);
  });

  it('assigns correct segment colors', () => {
    const ts = [0, 500_000];
    const segs = buildAttemptSegments(['TimedOut', '200'], ts, 1000, 100);
    expect(segs[0].color).toBe('var(--http-client-error)');
    expect(segs[1].color).toBe('var(--http-200)');
  });
});
