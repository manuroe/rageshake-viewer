import { describe, it, expect } from 'vitest';
import { bucketActivityRuns } from '../activityLanes';

describe('bucketActivityRuns', () => {
  it('merges adjacent non-empty buckets and splits on gaps; bounds are actual log times', () => {
    // bucketSize 10: 0,5 → bucket 0 (min 0, max 5); 30 → bucket 30 (min/max 30)
    expect(bucketActivityRuns([0, 5, 30], 0, 40, 10)).toEqual([
      { startUs: 0, endUs: 5, count: 2 },
      { startUs: 30, endUs: 30, count: 1 },
    ]);
  });

  it('merges consecutive buckets into one run bounded by first/last log', () => {
    // buckets 0 and 10 both active → single run [0,12] (actual log extent)
    expect(bucketActivityRuns([0, 12], 0, 30, 10)).toEqual([
      { startUs: 0, endUs: 12, count: 2 },
    ]);
  });

  it('ignores timestamps outside the window', () => {
    expect(bucketActivityRuns([-5, 5, 100], 0, 40, 10)).toEqual([
      { startUs: 5, endUs: 5, count: 1 },
    ]);
  });

  it('returns [] for no activity or non-positive bucket size', () => {
    expect(bucketActivityRuns([], 0, 40, 10)).toEqual([]);
    expect(bucketActivityRuns([5], 0, 40, 0)).toEqual([]);
  });

  it('tracks the actual min/max timestamp within a bucket regardless of arrival order', () => {
    // All four land in the same bucket (size 100); out-of-order arrival must still
    // widen the run to the true [5, 20] extent, not just the first timestamp seen.
    expect(bucketActivityRuns([10, 5, 20, 15], 0, 100, 100)).toEqual([
      { startUs: 5, endUs: 20, count: 4 },
    ]);
  });
});
