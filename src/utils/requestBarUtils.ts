/**
 * Utilities for computing per-attempt waterfall bar segments in HTTP retry
 * requests. These are kept in `src/utils/` so they can be tested in isolation.
 */

import type { HttpRequest } from '../types/log.types';
import { getHttpStatusColor } from './httpStatusColors';
import { INCOMPLETE_STATUS_KEY, isNumericStatus } from './statusCodeUtils';

/**
 * Returns the CSS color string for a single retry-attempt outcome.
 * Numeric strings are treated as HTTP status codes; `'Incomplete'` maps to
 * the incomplete color; anything else is a client error (transport failure
 * such as a timeout or a connection refusal).
 *
 * @example
 * getAttemptSegmentColor('503') // → 'var(--http-503)'
 * @example
 * getAttemptSegmentColor('TimedOut') // → 'var(--http-client-error)'
 * @example
 * getAttemptSegmentColor(INCOMPLETE_STATUS_KEY) // → 'var(--http-incomplete)'
 */
export function getAttemptSegmentColor(outcome: string): string {
  if (isNumericStatus(outcome)) return getHttpStatusColor(outcome);
  if (outcome === INCOMPLETE_STATUS_KEY) return 'var(--http-incomplete)';
  return 'var(--http-client-error)';
}

/**
 * Computes per-attempt segment descriptors for a retried request waterfall bar.
 * Proportions are derived from attempt timestamps relative to total request
 * duration. The last segment absorbs any remaining pixels to eliminate rounding
 * gaps while ensuring all segment widths sum exactly to `barWidthPx`.
 *
 * @example
 * const segs = buildAttemptSegments(['TimedOut', '200'], [ts1, ts2], 62000, 620);
 * // → [{leftPx: 0, widthPx: ..., color: 'var(--http-client-error)'}, ...]
 */
export function buildAttemptSegments(
  outcomes: readonly string[],
  timestamps: readonly number[],
  totalMs: number,
  barWidthPx: number,
): Array<{ leftPx: number; widthPx: number; color: string }> {
  // Guard against zero or negative totalMs, empty outcomes, or mismatched arrays
  // (missing timestamps would produce NaN widths).
  if (totalMs <= 0 || outcomes.length === 0 || timestamps.length < outcomes.length) return [];
  const segments: Array<{ leftPx: number; widthPx: number; color: string }> = [];
  let usedPx = 0;
  for (let i = 0; i < outcomes.length; i++) {
    const segStartUs = timestamps[i];
    const segEndUs = i < outcomes.length - 1 ? timestamps[i + 1] : timestamps[0] + totalMs * 1000;
    const segMs = (segEndUs - segStartUs) / 1000;
    const widthPx =
      i === outcomes.length - 1
        ? Math.max(0, barWidthPx - usedPx) // last segment gets the remainder
        : // Clamp to remaining pixels so usedPx never exceeds barWidthPx,
          // preventing the last segment from getting a negative/zero remainder
          // when multiple non-last segments round up simultaneously.
          Math.min(barWidthPx - usedPx, Math.max(0, Math.round((segMs / totalMs) * barWidthPx)));
    segments.push({ leftPx: usedPx, widthPx, color: getAttemptSegmentColor(outcomes[i]) });
    usedPx += widthPx;
  }
  return segments;
}

/**
 * Returns `true` when a request has complete per-attempt segment data that can
 * be rendered as colored bar segments in the waterfall view.
 * Extracted here so render functions stay lightweight and the check is testable.
 *
 * @example
 * computeHasSegments(singleAttemptReq) // → false
 */
export function computeHasSegments(req: HttpRequest): boolean {
  const n = req.numAttempts ?? 1;
  return n > 1
    && req.attemptOutcomes?.length === n
    && (req.attemptTimestampsUs?.length ?? 0) === n;
}

/**
 * Builds the retry tooltip string listing each attempt's outcome and duration,
 * e.g. `"↻3: 503 (20ms) → 503 (100ms) → 200 (1500ms) — 1620ms"`.
 * Extracted from component render so per-row computation stays in domain utils.
 *
 * @example
 * buildRetryTooltip(['503', '200'], [t0, t1], 1620, 2)
 * // → '↻2: 503 (120ms) → 200 (1500ms) — 1620ms'
 */
export function buildRetryTooltip(
  outcomes: readonly string[],
  timestamps: readonly number[],
  totalMs: number,
  numAttempts: number,
): string {
  const parts = outcomes.map((outcome, i) => {
    const endUs = i < outcomes.length - 1
      ? timestamps[i + 1]
      : timestamps[0] + totalMs * 1000;
    const ms = Math.round((endUs - timestamps[i]) / 1000);
    return `${outcome} (${ms}ms)`;
  });
  return `↻${numAttempts}: ${parts.join(' → ')} — ${totalMs}ms`;
}
