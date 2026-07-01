/** A contiguous run of active time buckets (log activity present). */
export interface ActivityRun {
  readonly startUs: number;
  readonly endUs: number;
  /** Total log lines across the run's buckets. */
  readonly count: number;
}

interface Bucket {
  count: number;
  minTs: number;
  maxTs: number;
}

/**
 * Bucket log timestamps into fixed-size time buckets and merge adjacent
 * non-empty buckets into contiguous activity runs. Used by the activity lanes
 * (app-state bars, per-process presence) to show *where* a stream was logging.
 *
 * Each run is bounded by the **actual** first/last log timestamps it contains,
 * not the bucket edges — otherwise a run's edge could spill into a neighbouring
 * state span (e.g. the bucket straddling a foreground boundary) and paint a
 * phantom bar where no logs exist.
 *
 * Timestamps outside `[minUs, maxUs]` are ignored. Returns runs in ascending
 * time order; empty when there is no activity or `bucketSizeUs <= 0`.
 *
 * @example
 * // bucketSize 10: ts 0,5 → bucket 0; ts 30 → bucket 30 (gap at 10,20)
 * bucketActivityRuns([0, 5, 30], 0, 40, 10);
 * // → [{ startUs: 0, endUs: 5, count: 2 }, { startUs: 30, endUs: 30, count: 1 }]
 */
export function bucketActivityRuns(
  timestampsUs: readonly number[],
  minUs: number,
  maxUs: number,
  bucketSizeUs: number,
): ActivityRun[] {
  if (bucketSizeUs <= 0) return [];

  const buckets = new Map<number, Bucket>();
  for (const ts of timestampsUs) {
    if (ts < minUs || ts > maxUs) continue;
    const key = Math.floor(ts / bucketSizeUs) * bucketSizeUs;
    const b = buckets.get(key);
    if (b) {
      b.count++;
      if (ts < b.minTs) b.minTs = ts;
      if (ts > b.maxTs) b.maxTs = ts;
    } else {
      buckets.set(key, { count: 1, minTs: ts, maxTs: ts });
    }
  }

  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const runs: ActivityRun[] = [];
  let cur: { startUs: number; endUs: number; count: number } | null = null;
  let nextContiguousKey: number | null = null;
  for (const key of keys) {
    const b = buckets.get(key)!;
    if (cur !== null && key === nextContiguousKey) {
      cur.endUs = b.maxTs; // extend to this bucket's last actual log
      cur.count += b.count;
    } else {
      if (cur !== null) runs.push(cur);
      cur = { startUs: b.minTs, endUs: b.maxTs, count: b.count };
    }
    nextContiguousKey = key + bucketSizeUs;
  }
  if (cur !== null) runs.push(cur);
  return runs;
}
