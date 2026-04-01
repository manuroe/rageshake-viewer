import type { HttpRequestSpan } from '../types/log.types';

/**
 * A point in the concurrency step function.
 * At `timeUs`, the number of simultaneously in-flight requests became `count`.
 * Pair with `curveStepAfter` to render a precise waveform with no bucketing approximation.
 */
export interface StepPoint {
  readonly timeUs: number;
  readonly count: number;
}

/**
 * Compute an exact step-function from request spans via an event sweep.
 *
 * For each span, a `+1` event is placed at `startUs` and a `-1` event at
 * `endUs` (or `maxTime` when `endUs` is null).  Sweeping the sorted events
 * in order gives the precise count of in-flight requests at every moment.
 *
 * The returned array is sorted by `timeUs` and is safe to pass directly to
 * visx `Area` / `LinePath` with `curveStepAfter`.
 *
 * @example
 * const spans = [{ startUs: 10, endUs: 30, status: '200' }];
 * computeStepPoints(spans, 0, 50);
 * // → [{ timeUs: 0, count: 0 }, { timeUs: 10, count: 1 },
 * //    { timeUs: 30, count: 0 }, { timeUs: 50, count: 0 }]
 */
export function computeStepPoints(
  spans: readonly HttpRequestSpan[],
  minTime: number,
  maxTime: number,
): StepPoint[] {
  if (spans.length === 0) return [];

  // Accumulate net delta per unique timestamp, clamped to the chart domain.
  const eventMap = new Map<number, number>();
  for (const span of spans) {
    const rawEnd = span.endUs ?? maxTime;

    // Ignore spans that end at or before the chart start, or start at or after the chart end.
    if (rawEnd <= minTime || span.startUs >= maxTime) {
      continue;
    }

    // Clamp span bounds to the [minTime, maxTime] domain.
    const clampedStart = Math.max(span.startUs, minTime);
    const clampedEnd = Math.min(rawEnd, maxTime);

    // Skip zero-width spans within the domain.
    if (clampedStart >= clampedEnd) {
      continue;
    }

    eventMap.set(clampedStart, (eventMap.get(clampedStart) ?? 0) + 1);
    eventMap.set(clampedEnd, (eventMap.get(clampedEnd) ?? 0) - 1);
  }

  if (eventMap.size === 0) {
    return [];
  }

  const sortedTimes = Array.from(eventMap.keys()).sort((a, b) => a - b);

  const points: StepPoint[] = [];
  let count = 0;

  // Anchor at chart start with zero count when first event is not at minTime.
  if (sortedTimes[0] > minTime) {
    points.push({ timeUs: minTime, count: 0 });
  }

  for (const time of sortedTimes) {
    count += eventMap.get(time)!;
    points.push({ timeUs: time, count: Math.max(0, count) });
  }

  // Anchor at chart end so the area fills to maxTime.
  const lastCount = points[points.length - 1].count;
  if (sortedTimes[sortedTimes.length - 1] < maxTime) {
    points.push({ timeUs: maxTime, count: lastCount });
  }

  return points;
}

/**
 * Return the current in-flight count at the given timestamp by binary-searching
 * the step-function point array.  The count is determined by the last point
 * whose `timeUs` is ≤ the query time.
 *
 * @example
 * const pts = [{ timeUs: 0, count: 0 }, { timeUs: 10, count: 2 }];
 * getCountAtTime(pts, 15); // → 2
 */
export function getCountAtTime(points: StepPoint[], timeUs: number): number {
  let lo = 0;
  let hi = points.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].timeUs <= timeUs) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return idx >= 0 ? points[idx].count : 0;
}
