/**
 * # Waterfall Gap Compression
 *
 * Utilities for collapsing idle periods (large time gaps with no HTTP activity)
 * in the waterfall timeline.  Instead of rendering an empty proportional strip
 * for each gap, idle gaps are replaced by a narrow fixed-width band so that
 * request bars remain legible without extreme horizontal scrolling.
 *
 * Architecture
 * ------------
 * `buildCompressedTimeline` partitions the timeline into `WaterfallSegment`s.
 * Each segment is either:
 * - `'active'` – contains at least one request bar; width = `durationMs / msPerPixel`
 * - `'gap'`    – an idle period > threshold; width = `COLLAPSED_GAP_PX` (fixed)
 *
 * `buildLinearTimeline` wraps the existing proportional logic in the same
 * `CompressedTimeline` interface, used when the feature is disabled.
 *
 * Key invariant: every request bar lies entirely within a single active segment,
 * so no bar ever spans a collapsed gap.  This means the `msPerPixel` scale is
 * preserved inside active segments, making the timeout-exceeded overlay in
 * `SyncView` continue to render correctly.
 */

/** Minimum inter-request idle gap (ms) that triggers compression. */
export const IDLE_GAP_THRESHOLD_MS = 5_000;

/**
 * Fixed pixel width rendered for each collapsed gap band.
 * Wide enough to be visible and hold a short label, but narrow enough to
 * avoid wasting screen space.
 */
export const COLLAPSED_GAP_PX = 28;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single contiguous time slice in the (possibly compressed) timeline. */
export interface WaterfallSegment {
  /** `'active'` = contains requests; `'gap'` = collapsed idle period. */
  readonly type: 'active' | 'gap';
  /** Wall-clock start of this segment (ms). */
  readonly startMs: number;
  /** Wall-clock end of this segment (ms). */
  readonly endMs: number;
  /** Real duration in milliseconds. */
  readonly durationMs: number;
  /** Left pixel edge in the compressed timeline. */
  readonly startPx: number;
  /** Right pixel edge in the compressed timeline. */
  readonly endPx: number;
  /** Width in pixels (= `endPx - startPx`). */
  readonly widthPx: number;
}

/**
 * A timeline mapping that converts wall-clock times to pixel positions.
 * Returned by both `buildCompressedTimeline` and `buildLinearTimeline`.
 */
export interface CompressedTimeline {
  /** Ordered segments that together cover the full `[minTime, maxTime]` range. */
  readonly segments: readonly WaterfallSegment[];
  /** Total pixel width of the entire timeline. */
  readonly totalWidthPx: number;
  /**
   * Map a wall-clock timestamp (ms) to an x pixel offset.
   * Times before `minTime` clamp to 0; times after `maxTime` clamp to `totalWidthPx`.
   */
  timeToPixel(timeMs: number): number;
  /**
   * Convert the pixel width for a request bar that spans `[startMs, endMs]`.
   * Both endpoints must lie within the same active segment (guaranteed by construction).
   */
  durationToPixels(startMs: number, endMs: number): number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface TimeWindow {
  startMs: number;
  endMs: number;
}

/**
 * Merge overlapping or adjacent time windows into the minimal covering set.
 * Input windows use ms values relative to any shared epoch.
 */
function mergeWindows(windows: TimeWindow[]): TimeWindow[] {
  if (windows.length === 0) return [];
  const sorted = [...windows].sort((a, b) => a.startMs - b.startMs);
  const merged: TimeWindow[] = [{ startMs: sorted[0].startMs, endMs: sorted[0].endMs }];
  for (let i = 1; i < sorted.length; i++) {
    const current = merged[merged.length - 1];
    const next = sorted[i];
    if (next.startMs <= current.endMs) {
      // Overlapping or adjacent – extend the current window.
      current.endMs = Math.max(current.endMs, next.endMs);
    } else {
      merged.push({ startMs: next.startMs, endMs: next.endMs });
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a compressed timeline where idle gaps longer than `thresholdMs`
 * are collapsed to `COLLAPSED_GAP_PX` pixels wide.
 *
 * Active segments retain their real proportional width (`durationMs / msPerPixel`),
 * so the scale selector continues to have the expected visual effect.
 *
 * @param timeData     - Array of `{ startTime, endTime }` for all displayed requests (ms).
 * @param minTime      - Earliest timestamp across all requests (ms absolute).
 * @param maxTime      - Latest point in the timeline, typically `maxEndTime + labelPaddingMs` (ms absolute).
 * @param msPerPixel   - Current timeline scale (ms per pixel).
 * @param thresholdMs  - Minimum gap duration to collapse (default: `IDLE_GAP_THRESHOLD_MS`).
 *
 * @example
 * const timeline = buildCompressedTimeline(
 *   [{ startTime: 1000, endTime: 1500 }, { startTime: 61000, endTime: 61500 }],
 *   1000, 61600, 10
 * );
 * // The 59.5s gap between the two request bars is collapsed to 28px.
 * timeline.totalWidthPx; // ~50 + 28 + ~50 + ~10 = ~138
 */
export function buildCompressedTimeline(
  timeData: ReadonlyArray<{ readonly startTime: number; readonly endTime: number }>,
  minTime: number,
  maxTime: number,
  msPerPixel: number,
  thresholdMs = IDLE_GAP_THRESHOLD_MS,
): CompressedTimeline {
  const totalMs = Math.max(1, maxTime - minTime);

  // Build active time windows from request bars (relative to minTime).
  const windows: TimeWindow[] = timeData
    .filter(t => t.startTime > 0)
    .map(t => ({
      startMs: t.startTime - minTime,
      endMs: t.endTime - minTime,
    }));

  const activeMerged = mergeWindows(windows);

  const segments: WaterfallSegment[] = [];
  let cursorMs = 0;   // current position in ms (relative to minTime)
  let cursorPx = 0;   // current position in pixels

  /** Push a segment and advance cursors. */
  function pushSegment(type: 'active' | 'gap', durationMs: number): void {
    const widthPx = type === 'gap' ? COLLAPSED_GAP_PX : Math.max(1, durationMs / msPerPixel);
    segments.push({
      type,
      startMs: cursorMs + minTime,
      endMs: cursorMs + durationMs + minTime,
      durationMs,
      startPx: cursorPx,
      endPx: cursorPx + widthPx,
      widthPx,
    });
    cursorMs += durationMs;
    cursorPx += widthPx;
  }

  for (const active of activeMerged) {
    const gapDuration = active.startMs - cursorMs;
    if (gapDuration > thresholdMs) {
      pushSegment('gap', gapDuration);
    } else if (gapDuration > 0) {
      pushSegment('active', gapDuration);
    }
    pushSegment('active', active.endMs - active.startMs);
  }

  // Tail: time after the last active window up to maxTime.
  const tailDuration = totalMs - cursorMs;
  if (tailDuration > thresholdMs) {
    pushSegment('gap', tailDuration);
  } else if (tailDuration > 0) {
    pushSegment('active', tailDuration);
  }

  const totalWidthPx = cursorPx;

  /**
   * Find the segment containing `relativeMs` (ms relative to minTime).
   * Uses an exclusive right boundary so a timestamp exactly at the junction
   * between two segments (e.g. gap end = active start) resolves to the later
   * (active) segment rather than the earlier (gap) one.
   */
  function findSegment(relativeMs: number): { seg: WaterfallSegment; offsetMs: number } | null {
    for (const seg of segments) {
      const segStartMs = seg.startMs - minTime;
      const segEndMs = seg.endMs - minTime;
      if (relativeMs >= segStartMs && relativeMs < segEndMs) {
        return { seg, offsetMs: relativeMs - segStartMs };
      }
    }
    // Fallback: clamp to the last segment's right edge (guards against
    // floating-point rounding when relativeMs ≈ totalMs).
    const last = segments[segments.length - 1];
    if (last) {
      return { seg: last, offsetMs: relativeMs - (last.startMs - minTime) };
    }
    return null;
  }

  return {
    segments,
    totalWidthPx,

    timeToPixel(timeMs: number): number {
      const relativeMs = timeMs - minTime;
      if (relativeMs <= 0) return 0;
      if (relativeMs >= totalMs) return totalWidthPx;
      const found = findSegment(relativeMs);
      if (!found) return totalWidthPx;
      const { seg, offsetMs } = found;
      if (seg.type === 'gap') {
        // A timestamp that falls inside a gap maps to the gap's left edge.
        return seg.startPx;
      }
      return seg.startPx + offsetMs / msPerPixel;
    },

    durationToPixels(startMs: number, endMs: number): number {
      // Both endpoints lie within the same active segment (invariant).
      // Width = duration / msPerPixel, with a 1px floor.
      return Math.max(1, (endMs - startMs) / msPerPixel);
    },
  };
}

/**
 * Build a linear (non-compressed) timeline that implements the same
 * `CompressedTimeline` interface using standard proportional math.
 * Used when the "collapse idle periods" option is turned off.
 *
 * @example
 * const timeline = buildLinearTimeline(1000, 60000, 6000, 10);
 * timeline.timeToPixel(1000);  // 0
 * timeline.timeToPixel(61000); // 6000
 */
export function buildLinearTimeline(
  minTime: number,
  totalDuration: number,
  timelineWidth: number,
  msPerPixel: number,
): CompressedTimeline {
  const segments: WaterfallSegment[] = [
    {
      type: 'active',
      startMs: minTime,
      endMs: minTime + totalDuration,
      durationMs: totalDuration,
      startPx: 0,
      endPx: timelineWidth,
      widthPx: timelineWidth,
    },
  ];

  return {
    segments,
    totalWidthPx: timelineWidth,

    timeToPixel(timeMs: number): number {
      const offsetMs = timeMs - minTime;
      const calculatedPosition = (offsetMs / totalDuration) * timelineWidth;
      const dynamicMinPosition = Math.max(0, offsetMs / msPerPixel);
      return Math.max(calculatedPosition, dynamicMinPosition);
    },

    durationToPixels(startMs: number, endMs: number): number {
      const durationMs = endMs - startMs;
      const calculatedWidth = (durationMs / totalDuration) * timelineWidth;
      const dynamicMin = Math.max(1, durationMs / msPerPixel);
      return Math.max(calculatedWidth, dynamicMin);
    },
  };
}

// ---------------------------------------------------------------------------
// Duration formatting
// ---------------------------------------------------------------------------

const MS_PER_SECOND = 1_000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/**
 * Format a gap duration into a short human-readable label shown inside the
 * collapsed gap band.
 *
 * @example
 * formatGapDuration(3_600_000); // "1h"
 * formatGapDuration(90_000);    // "1m 30s"
 * formatGapDuration(5_200);     // "5.2s"
 * formatGapDuration(800);       // "800ms"
 */
export function formatGapDuration(ms: number): string {
  if (ms >= MS_PER_HOUR) {
    const h = Math.floor(ms / MS_PER_HOUR);
    const m = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  if (ms >= MS_PER_MINUTE) {
    const m = Math.floor(ms / MS_PER_MINUTE);
    const s = Math.floor((ms % MS_PER_MINUTE) / MS_PER_SECOND);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  if (ms >= MS_PER_SECOND) {
    const s = (ms / MS_PER_SECOND).toFixed(1);
    return `${s}s`;
  }
  return `${ms}ms`;
}
