import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HttpActivityChart } from '../HttpActivityChart';
import type { HttpRequestWithTimestamp, HttpRequestSpan } from '../HttpActivityChart';
import type { TimestampMicros } from '../../types/time.types';
import { MICROS_PER_MILLISECOND } from '../../types/time.types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<HttpRequestWithTimestamp> = {}): HttpRequestWithTimestamp {
  return {
    requestId: 'R-1',
    status: '200',
    timestampUs: (2_000 * MICROS_PER_MILLISECOND) as TimestampMicros, // 2 s
    uri: '/_matrix/client/v3/sync',
    ...overrides,
  };
}

function makeRange(
  minMs: number = 0,
  maxMs: number = 10_000,
): { minTime: TimestampMicros; maxTime: TimestampMicros } {
  return {
    minTime: (minMs * MICROS_PER_MILLISECOND) as TimestampMicros,
    maxTime: (maxMs * MICROS_PER_MILLISECOND) as TimestampMicros,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('HttpActivityChart', () => {
  describe('empty state', () => {
    it('shows empty message when no requests provided', () => {
      render(<HttpActivityChart httpRequests={[]} timeRange={makeRange()} />);
      expect(screen.getByText('No HTTP request data to display')).toBeInTheDocument();
    });

    it('renders without errors when timeRange is 0/0', () => {
      const requests = [makeReq()];
      // Renders the component: exercises the `if (minTime === 0 && maxTime === 0)` early return
      // path inside the useMemo, which returns empty buckets.  We just verify it does not throw.
      expect(() =>
        render(
          <HttpActivityChart
            httpRequests={requests}
            timeRange={{ minTime: 0 as TimestampMicros, maxTime: 0 as TimestampMicros }}
          />,
        ),
      ).not.toThrow();
    });
  });

  describe('regular HTTP status codes', () => {
    it('renders SVG with bars for 200 requests', () => {
      const requests = [makeReq({ requestId: 'R-1', status: '200' })];
      const { container } = render(
        <HttpActivityChart httpRequests={requests} timeRange={makeRange(0, 10_000)} />,
      );
      expect(container.querySelector('svg')).toBeInTheDocument();
      // 200 uses var(--http-200)
      const bars = container.querySelectorAll('rect[fill="var(--http-200)"][opacity="0.9"]');
      expect(bars.length).toBeGreaterThan(0);
    });

    it('renders 4xx errors', () => {
      const requests = [makeReq({ requestId: 'R-2', status: '404' })];
      const { container } = render(
        <HttpActivityChart httpRequests={requests} timeRange={makeRange(0, 10_000)} />,
      );
      const bars = container.querySelectorAll('rect[fill="var(--http-404)"][opacity="0.9"]');
      expect(bars.length).toBeGreaterThan(0);
    });

    it('renders 5xx errors', () => {
      const requests = [makeReq({ requestId: 'R-3', status: '500' })];
      const { container } = render(
        <HttpActivityChart httpRequests={requests} timeRange={makeRange(0, 10_000)} />,
      );
      const bars = container.querySelectorAll('rect[fill="var(--http-500)"][opacity="0.9"]');
      expect(bars.length).toBeGreaterThan(0);
    });

    it('renders incomplete requests (empty status) with incomplete color', () => {
      const requests = [makeReq({ requestId: 'R-4', status: '' })];
      const { container } = render(
        <HttpActivityChart httpRequests={requests} timeRange={makeRange(0, 10_000)} />,
      );
      const bars = container.querySelectorAll('rect[fill="var(--http-incomplete)"][opacity="0.9"]');
      expect(bars.length).toBeGreaterThan(0);
    });

    it('renders non-sync 200 without timeout as regular 200 (not catchup/longpoll)', () => {
      // status 200 but no timeout → getBucketKey returns '200'
      const requests = [makeReq({ status: '200' })]; // no timeout property
      const { container } = render(
        <HttpActivityChart httpRequests={requests} timeRange={makeRange(0, 10_000)} />,
      );
      const regularBars = container.querySelectorAll('rect[fill="var(--http-200)"][opacity="0.9"]');
      expect(regularBars.length).toBeGreaterThan(0);
    });
  });

  describe('sync request sub-types (getBucketKey, getBucketColor, getBucketLabel)', () => {
    it('renders sync catchup (status 200, timeout=0) with catchup color', () => {
      const requests = [makeReq({ status: '200', timeout: 0 })];
      const { container } = render(
        <HttpActivityChart httpRequests={requests} timeRange={makeRange(0, 10_000)} />,
      );
      // sync-catchup bars use var(--sync-catchup-success)
      const catchupBars = container.querySelectorAll(
        'rect[fill="var(--sync-catchup-success)"][opacity="0.9"]',
      );
      expect(catchupBars.length).toBeGreaterThan(0);
    });

    it('renders sync long-poll (status 200, timeout=30000) with longpoll color', () => {
      const requests = [makeReq({ status: '200', timeout: 30_000 })];
      const { container } = render(
        <HttpActivityChart httpRequests={requests} timeRange={makeRange(0, 10_000)} />,
      );
      const longPollBars = container.querySelectorAll(
        'rect[fill="var(--sync-longpoll-success)"][opacity="0.9"]',
      );
      expect(longPollBars.length).toBeGreaterThan(0);
    });

    it('renders sync long-poll with large timeout (>=30000)', () => {
      const requests = [makeReq({ status: '200', timeout: 60_000 })];
      const { container } = render(
        <HttpActivityChart httpRequests={requests} timeRange={makeRange(0, 10_000)} />,
      );
      const longPollBars = container.querySelectorAll(
        'rect[fill="var(--sync-longpoll-success)"][opacity="0.9"]',
      );
      expect(longPollBars.length).toBeGreaterThan(0);
    });

    it('4xx with timeout does NOT get sync color (only 2xx is eligible)', () => {
      const requests = [makeReq({ status: '408', timeout: 0 })];
      const { container } = render(
        <HttpActivityChart httpRequests={requests} timeRange={makeRange(0, 10_000)} />,
      );
      // Should use 408's normal color, not the sync-catchup color
      const catchupBars = container.querySelectorAll(
        'rect[fill="var(--sync-catchup-success)"][opacity="0.9"]',
      );
      expect(catchupBars.length).toBe(0);
    });
  });

  describe('mixed request types (sortStatusCodes coverage)', () => {
    it('renders all status types together', () => {
      // Covers sortStatusCodes path with sync codes + numeric + non-numeric
      const base = (2_000 * MICROS_PER_MILLISECOND) as TimestampMicros;
      const requests: HttpRequestWithTimestamp[] = [
        makeReq({ requestId: 'R-catchup', status: '200', timestampUs: base, timeout: 0 }),
        makeReq({ requestId: 'R-longpoll', status: '200', timestampUs: base, timeout: 30_000 }),
        makeReq({ requestId: 'R-200', status: '200', timestampUs: base }),
        makeReq({ requestId: 'R-404', status: '404', timestampUs: base }),
        makeReq({ requestId: 'R-500', status: '500', timestampUs: base }),
        makeReq({ requestId: 'R-incomplete', status: '', timestampUs: base }),
      ];
      const { container } = render(
        <HttpActivityChart httpRequests={requests} timeRange={makeRange(0, 10_000)} />,
      );
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('handles requests with status codes not in the same bucket', () => {
      // Spread across different seconds to produce multiple buckets
      const requests: HttpRequestWithTimestamp[] = [
        makeReq({ requestId: 'R-1', status: '500', timestampUs: (1_000 * MICROS_PER_MILLISECOND) as TimestampMicros }),
        makeReq({ requestId: 'R-2', status: '404', timestampUs: (5_000 * MICROS_PER_MILLISECOND) as TimestampMicros }),
        makeReq({ requestId: 'R-3', status: '200', timestampUs: (9_000 * MICROS_PER_MILLISECOND) as TimestampMicros }),
      ];
      const { container } = render(
        <HttpActivityChart httpRequests={requests} timeRange={makeRange(0, 10_000)} />,
      );
      // Each bucket only has one status — this exercises the count === 0 return null
      // branch inside renderTooltipContent
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('tooltip interactions', () => {
    it('shows cursor line on mouse move over chart', () => {
      const requests = [
        makeReq({ requestId: 'R-1', status: '200' }),
        makeReq({ requestId: 'R-2', status: '404', timestampUs: (5_000 * MICROS_PER_MILLISECOND) as TimestampMicros }),
      ];
      const { container } = render(
        <HttpActivityChart httpRequests={requests} timeRange={makeRange(0, 10_000)} />,
      );

      const overlay = container.querySelector('rect[fill="transparent"]') as SVGElement;
      expect(overlay).not.toBeNull();

      fireEvent.mouseMove(overlay, { clientX: 300, clientY: 50 });
      const cursorLine = container.querySelector('line[stroke-dasharray="4,2"]');
      expect(cursorLine).toBeInTheDocument();
    });

    it('hides cursor line on mouse leave', () => {
      const requests = [makeReq()];
      const { container } = render(
        <HttpActivityChart httpRequests={requests} timeRange={makeRange(0, 10_000)} />,
      );

      const overlay = container.querySelector('rect[fill="transparent"]') as SVGElement;

      fireEvent.mouseMove(overlay, { clientX: 300, clientY: 50 });
      fireEvent.mouseLeave(overlay);

      expect(container.querySelector('line[stroke-dasharray="4,2"]')).not.toBeInTheDocument();
    });

    it('shows tooltip content on mouse move (exercises renderTooltipContent)', () => {
      // Put all requests into the same bucket so tooltip shows multiple codes
      const ts = (2_000 * MICROS_PER_MILLISECOND) as TimestampMicros;
      const requests: HttpRequestWithTimestamp[] = [
        makeReq({ requestId: 'R-1', status: '200', timestampUs: ts, timeout: 0 }),
        makeReq({ requestId: 'R-2', status: '200', timestampUs: ts, timeout: 30_000 }),
        makeReq({ requestId: 'R-3', status: '404', timestampUs: ts }),
      ];
      const { container } = render(
        <HttpActivityChart httpRequests={requests} timeRange={makeRange(0, 5_000)} />,
      );

      const overlay = container.querySelector('rect[fill="transparent"]') as SVGElement;
      fireEvent.mouseMove(overlay, { clientX: 400, clientY: 50 });

      // Cursor line is the most reliable indicator that tooltip logic ran
      expect(container.querySelector('line[stroke-dasharray="4,2"]')).toBeInTheDocument();
    });
  });

  describe('time range selection', () => {
    it('calls onTimeRangeSelected after a drag selection', () => {
      const onTimeRangeSelected = vi.fn();
      const requests = [makeReq()];
      const { container } = render(
        <HttpActivityChart
          httpRequests={requests}
          timeRange={makeRange(0, 10_000)}
          onTimeRangeSelected={onTimeRangeSelected}
        />,
      );

      const overlay = container.querySelector('rect[fill="transparent"]') as SVGElement;
      // Drag from ~20% to ~80% of the chart width (800px default)
      fireEvent.mouseDown(overlay, { clientX: 210, clientY: 50 });
      fireEvent.mouseMove(overlay, { clientX: 650, clientY: 50 });
      fireEvent.mouseUp(overlay);

      expect(onTimeRangeSelected).toHaveBeenCalled();
    });

    it('calls onResetZoom on double click', () => {
      const onResetZoom = vi.fn();
      const requests = [makeReq()];
      const { container } = render(
        <HttpActivityChart
          httpRequests={requests}
          timeRange={makeRange(0, 10_000)}
          onResetZoom={onResetZoom}
        />,
      );

      const overlay = container.querySelector('rect[fill="transparent"]') as SVGElement;
      fireEvent.dblClick(overlay);
      expect(onResetZoom).toHaveBeenCalled();
    });
  });
});

// ─── Concurrent mode ────────────────────────────────────────────────────────

/** Create a span with sensible defaults (times in milliseconds, converted internally). */
function makeSpan(overrides: Partial<HttpRequestSpan> = {}): HttpRequestSpan {
  return {
    startUs: (1_000 * MICROS_PER_MILLISECOND) as TimestampMicros,
    endUs: (3_000 * MICROS_PER_MILLISECOND) as TimestampMicros,
    status: '200',
    uri: '/_matrix/client/v3/sync',
    ...overrides,
  };
}

describe('HttpActivityChart — concurrent mode', () => {
  describe('empty state', () => {
    it('shows empty message when no spans provided and displayMode is concurrent', () => {
      render(
        <HttpActivityChart
          httpRequests={[makeReq()]}
          httpRequestSpans={[]}
          displayMode="concurrent"
          timeRange={makeRange()}
        />,
      );
      expect(screen.getByText('No in-flight request data to display')).toBeInTheDocument();
    });

    it('still renders completed chart when displayMode is omitted (default)', () => {
      const { container } = render(
        <HttpActivityChart httpRequests={[makeReq()]} timeRange={makeRange(0, 10_000)} />,
      );
      // Default mode: uses completed buckets → SVG bars present
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('area chart rendering', () => {
    it('renders an SVG area path for overlapping spans in concurrent mode', () => {
      const spans: HttpRequestSpan[] = [
        makeSpan({ startUs: (1_500 * MICROS_PER_MILLISECOND) as TimestampMicros, endUs: (4_000 * MICROS_PER_MILLISECOND) as TimestampMicros, status: '200' }),
        makeSpan({ startUs: (2_000 * MICROS_PER_MILLISECOND) as TimestampMicros, endUs: (5_000 * MICROS_PER_MILLISECOND) as TimestampMicros, status: '200' }),
      ];
      const { container } = render(
        <HttpActivityChart
          httpRequests={[makeReq()]}
          httpRequestSpans={spans}
          displayMode="concurrent"
          timeRange={makeRange(0, 10_000)}
        />,
      );
      expect(container.querySelector('svg')).toBeInTheDocument();
      // Area chart renders path elements (AreaClosed + LinePath), not bars
      expect(container.querySelector('path')).toBeInTheDocument();
    });

    it('renders area path for incomplete spans (endUs=null)', () => {
      const spans: HttpRequestSpan[] = [
        makeSpan({ startUs: (1_000 * MICROS_PER_MILLISECOND) as TimestampMicros, endUs: null }),
      ];
      const { container } = render(
        <HttpActivityChart
          httpRequests={[makeReq()]}
          httpRequestSpans={spans}
          displayMode="concurrent"
          timeRange={makeRange(0, 10_000)}
        />,
      );
      expect(container.querySelector('path')).toBeInTheDocument();
    });
  });
});
