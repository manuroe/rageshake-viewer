/**
 * Default minimum scaling factor: 10ms = 1px
 * This constant ensures consistent scaling across timeline width, bar positions, and bar widths
 */
export const DEFAULT_MS_PER_PIXEL = 10;

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
