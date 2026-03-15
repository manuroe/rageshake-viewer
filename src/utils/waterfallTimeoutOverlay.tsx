import type { ReactNode } from 'react';
import type { HttpRequest } from '../types/log.types';
import { getWaterfallBarWidth } from './timelineUtils';

type TimeoutResolver = (req: HttpRequest) => number | undefined;

/**
 * Render the timeout-exceeded (overflow) segment for a waterfall bar.
 *
 * The waterfall bar is drawn in two layers: the base layer retains the
 * request's status colour for the portion up to the configured timeout, and
 * this overlay paints the remaining overflow portion with
 * `var(--waterfall-timeout-exceeded)` (a warning colour).
 *
 * Returns `null` (no overlay) when:
 * - the request has no associated timeout,
 * - the timeout is zero,
 * - or the request finished within the timeout.
 *
 * @param req - The HTTP request whose duration is being visualised.
 * @param barWidthPx - Total rendered width of the waterfall bar in pixels.
 * @param msPerPixel - Timeline scale factor: how many milliseconds one pixel represents.
 * @param totalDuration - Total duration of the visible timeline window in milliseconds,
 *   used by `getWaterfallBarWidth` to compute the timeout boundary position.
 * @param timelineWidth - Pixel width of the full timeline container.
 * @param resolveTimeout - Callback that returns the effective timeout (ms) for the
 *   given request, or `undefined` when no timeout applies.
 * @returns A positioned `<div>` overlay element, or `null` if no overflow exists.
 */
export function renderTimeoutExceededOverlay(
  req: HttpRequest,
  barWidthPx: number,
  msPerPixel: number,
  totalDuration: number,
  timelineWidth: number,
  resolveTimeout: TimeoutResolver,
): ReactNode {
  const timeoutMs = resolveTimeout(req);

  if (timeoutMs === undefined || timeoutMs === 0 || req.requestDurationMs <= timeoutMs) {
    return null;
  }

  const timeoutBoundaryPx = timeoutMs <= 0
    ? 0
    : getWaterfallBarWidth(timeoutMs, totalDuration, timelineWidth, msPerPixel);

  const splitLeftPx = Math.max(0, Math.min(timeoutBoundaryPx, barWidthPx));
  const exceededWidthPx = barWidthPx - splitLeftPx;

  if (exceededWidthPx <= 0) {
    return null;
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: `${splitLeftPx}px`,
        width: `${exceededWidthPx}px`,
        height: '100%',
        background: 'var(--waterfall-timeout-exceeded)',
        pointerEvents: 'none',
      }}
    />
  );
}
