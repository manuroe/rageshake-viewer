import { COLLAPSED_GAP_PX, IDLE_GAP_THRESHOLD_MS } from './waterfallGapUtils';

/**
 * Default minimum scaling factor: 10ms = 1px
 * This constant ensures consistent scaling across timeline width, bar positions, and bar widths
 */
export const DEFAULT_MS_PER_PIXEL = 10;

/**
 * Ordered list of available timeline scale options (ms per pixel).
 * Exported so that auto-scale logic can snap computed values to the same set
 * that the TimelineScaleSelector UI presents to the user.
 */
export const TIMELINE_SCALE_OPTIONS = [
  { value: 5, label: '1px = 5ms' },
  { value: 10, label: '1px = 10ms' },
  { value: 25, label: '1px = 25ms' },
  { value: 50, label: '1px = 50ms' },
  { value: 100, label: '1px = 100ms' },
  { value: 250, label: '1px = 250ms' },
  { value: 500, label: '1px = 500ms' },
  { value: 1000, label: '1px = 1000ms' },
] as const;

/**
 * Compute an automatically selected timeline scale (ms per pixel) so that the
 * first `requestCount` requests fit within the available container width.
 *
 * When `collapseIdlePeriods` is `true` (the default, matching the UI default),
 * idle gaps longer than the compression threshold are treated as consuming a
 * fixed `COLLAPSED_GAP_PX` band — exactly as the compressed timeline does —
 * so the computed scale accounts for gap bands and allocates the remaining
 * container width to the actual request bars.
 *
 * The result is snapped upward to the smallest value from
 * {@link TIMELINE_SCALE_OPTIONS} that is greater than or equal to the raw
 * computed scale, so the scale selector always shows a discrete, labelled
 * option while preserving the auto-fit guarantee for the selected requests.
 *
 * Returns `null` when the data is insufficient to compute a meaningful scale
 * (empty slice, zero active span, or zero effective container width).
 *
 * @param timeData - Array of `{startTime, endTime}` entries in timeline order.
 * @param containerWidth - Available waterfall panel width in pixels.
 * @param requestCount - Number of leading requests to fit (default: 25).
 * @param collapseIdlePeriods - Account for idle-gap compression (default: true).
 * @returns Snapped ms-per-pixel value, or `null` if a scale cannot be computed.
 *
 * @example
 * // 25 requests spanning 5 000 ms in an 800 px container → raw ≈ 6.25 → snapped to 10
 * computeAutoScale(timeData, 800); // → 10
 *
 * @example
 * // Two clusters separated by a 10 s gap; collapse-idle on, 800 px container
 * // Active ms = 1 000; 1 gap band = 28 px; active budget = 772 px; raw ≈ 1.3 → snapped to 5
 * computeAutoScale(twoClusterData, 800, 25, true); // → 5
 */
export function computeAutoScale(
  timeData: ReadonlyArray<{ readonly startTime: number; readonly endTime: number }>,
  containerWidth: number,
  requestCount = 25,
  collapseIdlePeriods = true,
): number | null {
  if (containerWidth <= 0) return null;

  const slice = timeData.slice(0, requestCount);
  if (slice.length === 0) return null;

  /** Snap a raw ms/px value to the smallest discrete step that is >= rawMsPerPixel.
   * This guarantees the first N requests always fit within the container — picking
   * a smaller step would require more pixels than the budget allows.
   * If rawMsPerPixel exceeds every step, the largest step (most zoomed-out) is returned.
   */
  function snapToStep(rawMsPerPixel: number): number {
    const steps = TIMELINE_SCALE_OPTIONS.map((o) => o.value);
    for (const step of steps) {
      if (step >= rawMsPerPixel) return step;
    }
    return steps[steps.length - 1]; // clamp to most zoomed-out step
  }

  const minStart = Math.min(...slice.map((t) => t.startTime));

  if (collapseIdlePeriods) {
    // Merge overlapping/adjacent request windows (slice is already time-ordered).
    // This mirrors the gap-detection logic in buildCompressedTimeline so the
    // pixel budget calculation matches what the renderer actually produces.
    const merged: Array<{ startMs: number; endMs: number }> = [];
    for (const { startTime, endTime } of slice) {
      const relStart = startTime - minStart;
      const relEnd = endTime - minStart;
      if (merged.length === 0 || relStart > merged[merged.length - 1].endMs) {
        merged.push({ startMs: relStart, endMs: relEnd });
      } else {
        merged[merged.length - 1].endMs = Math.max(merged[merged.length - 1].endMs, relEnd);
      }
    }

    let collapsedGapMs = 0;
    let numCollapsedGaps = 0;
    let cursor = 0;
    for (const active of merged) {
      const gapDuration = active.startMs - cursor;
      if (gapDuration > IDLE_GAP_THRESHOLD_MS) {
        numCollapsedGaps++;
        // Only the collapsed gap's ms are removed from the pixel budget; the
        // fixed COLLAPSED_GAP_PX band is subtracted from the container below.
        collapsedGapMs += gapDuration;
      }
      cursor = active.endMs;
    }

    // spanMs includes every millisecond that will be rendered proportionally
    // (active bars + short sub-threshold gaps). Subtracting collapsed-gap
    // durations gives the ms that must fit within the non-gap pixel budget.
    const spanMs = merged.length > 0 ? merged[merged.length - 1].endMs : 0;
    const activeMs = spanMs - collapsedGapMs;

    if (activeMs <= 0) return null;

    const activePixelBudget = containerWidth - numCollapsedGaps * COLLAPSED_GAP_PX;
    if (activePixelBudget <= 0) {
      // All budget consumed by gap bands — clamp to the most zoomed-out step.
      return TIMELINE_SCALE_OPTIONS[TIMELINE_SCALE_OPTIONS.length - 1].value;
    }

    return snapToStep(activeMs / activePixelBudget);
  }

  // Linear path: fit the full span proportionally.
  const maxEnd = Math.max(...slice.map((t) => t.endTime));
  const spanMs = maxEnd - minStart;
  if (spanMs <= 0) return null;
  return snapToStep(spanMs / containerWidth);
}

/**
 * Convert milliseconds to minimum pixels using configurable scaling
 * @param durationMs - Duration in milliseconds
 * @param msPerPixel - Scaling factor (ms per pixel), defaults to 10
 * @returns Minimum pixel value for the given duration
 */
export function msToMinPixels(durationMs: number, msPerPixel = DEFAULT_MS_PER_PIXEL): number {
  return durationMs / msPerPixel;
}

/**
 * Calculate timeline width based on visible requests to optimize initial display
 * Uses configurable minimum scaling to ensure consistency with bar widths and positions
 * @param containerWidth - Available width in pixels
 * @param visibleTimes - Reserved for call-site compatibility; not read by the
 *   current implementation (parameter retained to avoid a breaking change).
 * @param minTime - Minimum time across all requests
 * @param maxTime - Maximum time across all requests
 * @param msPerPixel - Scaling factor (ms per pixel), defaults to 10
 * @returns Object with timelineWidth and pixelsPerMs
 */
export function calculateTimelineWidth(
  containerWidth: number,
  _visibleTimes: number[],
  minTime: number,
  maxTime: number,
  msPerPixel = DEFAULT_MS_PER_PIXEL
): { timelineWidth: number; pixelsPerMs: number } {
  const availableWaterfallWidth = Math.max(300, containerWidth);
  const totalDuration = Math.max(1, maxTime - minTime);

  // Drive timeline width directly from msPerPixel so the scale selector always has effect.
  // Previously an auto-fit calculation (fitting visible requests to the container) was used as
  // a base, then clamped up by dynamicMinWidth. That meant zooming out (high msPerPixel →
  // small dynamicMinWidth) had no effect because the auto-fit width was always larger.
  const dynamicWidth = msToMinPixels(totalDuration, msPerPixel);
  const timelineWidth = Math.max(availableWaterfallWidth, dynamicWidth);
  const pixelsPerMs = timelineWidth / totalDuration;

  return { timelineWidth, pixelsPerMs };
}

/**
 * Calculate waterfall position with configurable scaling to ensure alignment with bar widths.
 * @param requestTime - Request start time in milliseconds.
 * @param minTime - Minimum time across all requests.
 * @param totalDuration - Total duration of the timeline in milliseconds.
 * @param timelineWidth - Width of the timeline in pixels.
 * @param msPerPixel - Scaling factor (ms per pixel), defaults to 10.
 * @returns Horizontal position in pixels for the request on the waterfall timeline.
 */
export function getWaterfallPosition(
  requestTime: number,
  minTime: number,
  totalDuration: number,
  timelineWidth: number,
  msPerPixel = DEFAULT_MS_PER_PIXEL
): number {
  const calculatedPosition = ((requestTime - minTime) / totalDuration) * timelineWidth;
  // Apply same minimum scaling as bar widths
  const timeFromStart = requestTime - minTime;
  const dynamicMinPosition = msToMinPixels(timeFromStart, msPerPixel);
  return Math.max(calculatedPosition, dynamicMinPosition);
}

/**
 * Utility function to calculate bar width
 * Ensures duration is represented with configurable minimum scaling
 * For very short durations on large timelines, this prevents bars from becoming invisible
 * @param msPerPixel - Scaling factor (ms per pixel), defaults to 10
 */
export function getWaterfallBarWidth(
  durationMs: number,
  totalDuration: number,
  timelineWidth: number,
  msPerPixel = DEFAULT_MS_PER_PIXEL
): number {
  const calculatedWidth = (durationMs / totalDuration) * timelineWidth;
  // Dynamic minimum based on duration and scale, with a floor of 1px for any non-zero duration
  const dynamicMin = Math.max(1, msToMinPixels(durationMs, msPerPixel));
  return Math.max(calculatedWidth, dynamicMin);
}
