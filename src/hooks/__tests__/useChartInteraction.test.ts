/**
 * Unit tests for useChartInteraction edge-snapping logic.
 *
 * When a user drags to the first or last bar of the chart, the computed
 * time lands somewhere inside that bucket rather than exactly at the data
 * min/max.  handleMouseUp snaps the boundary to minTime / maxTime whenever
 * the raw value is within one bucket's time span of the edge.
 *
 * Test geometry (marginLeft = 0, so chart-x === event-x):
 *   xMax        = 1 000 px
 *   xScaleStep  =    10 px  (100 buckets)
 *   minTime     =         0 µs
 *   maxTime     = 1 000 000 µs  (1s range)
 *   bucketTimeSpan = (10 / 1000) × 1 000 000 = 10 000 µs
 *
 * Snap fires when:
 *   - rawStart  − minTime  < bucketTimeSpan  → startTime = minTime
 *   - maxTime   − rawEnd   < bucketTimeSpan  → endTime   = maxTime
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useChartInteraction } from '../useChartInteraction';
import type { TimestampMicros } from '../../types/time.types';

// ─── Mock @visx/event ────────────────────────────────────────────────────────
const mockLocalPoint = vi.fn();
vi.mock('@visx/event', () => ({
  localPoint: (e: unknown) => mockLocalPoint(e),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const X_MAX = 1_000;
const MIN_TIME = 0 as TimestampMicros;
const MAX_TIME = 1_000_000 as TimestampMicros; // 1 s
const X_SCALE_STEP = 10; // 100 buckets → bucketTimeSpan = 10 000 µs

/** Convert a chart-x position to the expected time value (no snapping). */
function xToTime(x: number): number {
  return MIN_TIME + (x / X_MAX) * (MAX_TIME - MIN_TIME);
}

function makeOptions(onTimeRangeSelected = vi.fn()) {
  return {
    marginLeft: 0,
    xMax: X_MAX,
    minTime: MIN_TIME,
    maxTime: MAX_TIME,
    formatTime: () => '00:00:00',
    hideTooltip: vi.fn(),
    onTimeRangeSelected,
    onResetZoom: vi.fn(),
    getBucketAtIndex: () => undefined,
    xScaleStep: X_SCALE_STEP,
    bucketCount: 100,
  };
}

/**
 * Simulate mouseDown → mouseMove → mouseUp.
 * Re-reads result.current.handlers after each act() to avoid stale closures.
 */
function simulateDrag(
  result: { current: ReturnType<typeof useChartInteraction> },
  startX: number,
  endX: number
) {
  // mouseDown: sets selectionStart and starts isSelecting
  mockLocalPoint.mockReturnValueOnce({ x: startX, y: 50 });
  act(() => {
    result.current.handlers.handleMouseDown({} as React.MouseEvent<SVGRectElement>);
  });

  // mouseMove: updates selectionEnd — read fresh handlers after state update
  mockLocalPoint.mockReturnValueOnce({ x: endX, y: 50 });
  act(() => {
    result.current.handlers.handleMouseMove(
      {} as React.MouseEvent<SVGRectElement>,
      vi.fn()
    );
  });

  // mouseUp: commits the selection — read fresh handlers after state update
  act(() => {
    result.current.handlers.handleMouseUp();
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useChartInteraction — edge snapping', () => {
  beforeEach(() => {
    mockLocalPoint.mockReset();
  });

  it('does NOT snap when selection is comfortably in the middle', () => {
    const onTimeRangeSelected = vi.fn();
    const { result } = renderHook(() => useChartInteraction(makeOptions(onTimeRangeSelected)));

    simulateDrag(result, 200, 800);

    expect(onTimeRangeSelected).toHaveBeenCalledTimes(1);
    const [start, end] = onTimeRangeSelected.mock.calls[0];
    expect(start).toBe(xToTime(200)); // 200 000
    expect(end).toBe(xToTime(800));   // 800 000
  });

  it('snaps startTime to minTime when drag starts within one bucket of the left edge', () => {
    // Drag from x=500 → x=5; rawStart = min(500 000, 5 000) = 5 000
    // 5 000 − 0 = 5 000 < bucketTimeSpan (10 000) → snap to 0
    const onTimeRangeSelected = vi.fn();
    const { result } = renderHook(() => useChartInteraction(makeOptions(onTimeRangeSelected)));

    simulateDrag(result, 500, 5);

    expect(onTimeRangeSelected).toHaveBeenCalledTimes(1);
    const [start, end] = onTimeRangeSelected.mock.calls[0];
    expect(start).toBe(MIN_TIME);
    expect(end).toBe(xToTime(500)); // 500 000 — no snap on end side
  });

  it('snaps endTime to maxTime when drag ends within one bucket of the right edge', () => {
    // Drag from x=200 → x=995; rawEnd = max(200 000, 995 000) = 995 000
    // 1 000 000 − 995 000 = 5 000 < 10 000 → snap to 1 000 000
    const onTimeRangeSelected = vi.fn();
    const { result } = renderHook(() => useChartInteraction(makeOptions(onTimeRangeSelected)));

    simulateDrag(result, 200, 995);

    expect(onTimeRangeSelected).toHaveBeenCalledTimes(1);
    const [start, end] = onTimeRangeSelected.mock.calls[0];
    expect(start).toBe(xToTime(200)); // 200 000 — no snap on start side
    expect(end).toBe(MAX_TIME);
  });

  it('snaps both ends when selection covers essentially the full range', () => {
    // Drag from x=5 → x=995; rawStart=5 000 → 0, rawEnd=995 000 → 1 000 000
    const onTimeRangeSelected = vi.fn();
    const { result } = renderHook(() => useChartInteraction(makeOptions(onTimeRangeSelected)));

    simulateDrag(result, 5, 995);

    expect(onTimeRangeSelected).toHaveBeenCalledTimes(1);
    const [start, end] = onTimeRangeSelected.mock.calls[0];
    expect(start).toBe(MIN_TIME);
    expect(end).toBe(MAX_TIME);
  });

  it('does NOT snap when selection starts just beyond one bucket from the left edge', () => {
    // rawStart = xToTime(15) = 15 000; 15 000 − 0 = 15 000 > 10 000 → no snap
    const onTimeRangeSelected = vi.fn();
    const { result } = renderHook(() => useChartInteraction(makeOptions(onTimeRangeSelected)));

    simulateDrag(result, 500, 15);

    expect(onTimeRangeSelected).toHaveBeenCalledTimes(1);
    const [start] = onTimeRangeSelected.mock.calls[0];
    expect(start).toBe(xToTime(15));
    expect(start).not.toBe(MIN_TIME);
  });

  it('does NOT snap when selection ends just beyond one bucket from the right edge', () => {
    // rawEnd = xToTime(985) = 985 000; 1 000 000 − 985 000 = 15 000 > 10 000 → no snap
    const onTimeRangeSelected = vi.fn();
    const { result } = renderHook(() => useChartInteraction(makeOptions(onTimeRangeSelected)));

    simulateDrag(result, 200, 985);

    expect(onTimeRangeSelected).toHaveBeenCalledTimes(1);
    const [, end] = onTimeRangeSelected.mock.calls[0];
    expect(end).toBe(xToTime(985));
    expect(end).not.toBe(MAX_TIME);
  });

  it('does not fire onTimeRangeSelected for a tiny selection (< 100 ms)', () => {
    // x=500 → x=502: range = 2 000 µs = 2 ms < 100 ms threshold
    const onTimeRangeSelected = vi.fn();
    const { result } = renderHook(() => useChartInteraction(makeOptions(onTimeRangeSelected)));

    simulateDrag(result, 500, 502);

    expect(onTimeRangeSelected).not.toHaveBeenCalled();
  });

  it('fires onTimeRangeSelected exactly once and clears selection state after mouseUp', () => {
    const onTimeRangeSelected = vi.fn();
    const { result } = renderHook(() => useChartInteraction(makeOptions(onTimeRangeSelected)));

    simulateDrag(result, 100, 900);

    expect(onTimeRangeSelected).toHaveBeenCalledTimes(1);
    expect(result.current.state.isSelecting).toBe(false);
    expect(result.current.state.selectionStart).toBeUndefined();
    expect(result.current.state.selectionEnd).toBeUndefined();
  });
});

describe('useChartInteraction — handleMouseDown early-return branches', () => {
  beforeEach(() => {
    mockLocalPoint.mockReset();
  });

  it('does nothing when localPoint returns null (line 72)', () => {
    const { result } = renderHook(() => useChartInteraction(makeOptions()));

    // localPoint returns null → handleMouseDown should early-return without starting selection
    mockLocalPoint.mockReturnValueOnce(null);
    act(() => {
      result.current.handlers.handleMouseDown({} as React.MouseEvent<SVGRectElement>);
    });

    expect(result.current.state.isSelecting).toBe(false);
  });

  it('does nothing when click is left of chart (x < 0, line 75)', () => {
    const { result } = renderHook(() => useChartInteraction(makeOptions()));

    // marginLeft=0, so x = point.x - 0 = -10 < 0 → early return
    mockLocalPoint.mockReturnValueOnce({ x: -10, y: 50 });
    act(() => {
      result.current.handlers.handleMouseDown({} as React.MouseEvent<SVGRectElement>);
    });

    expect(result.current.state.isSelecting).toBe(false);
  });

  it('does nothing when click is right of chart (x > xMax, line 75)', () => {
    const { result } = renderHook(() => useChartInteraction(makeOptions()));

    // X_MAX = 1_000, so x = 1_001 > xMax → early return
    mockLocalPoint.mockReturnValueOnce({ x: X_MAX + 1, y: 50 });
    act(() => {
      result.current.handlers.handleMouseDown({} as React.MouseEvent<SVGRectElement>);
    });

    expect(result.current.state.isSelecting).toBe(false);
  });
});

describe('useChartInteraction — handleMouseUp early-return when not selecting', () => {
  beforeEach(() => {
    mockLocalPoint.mockReset();
  });

  it('sets isSelecting to false and returns without calling onTimeRangeSelected (lines 95-97)', () => {
    const onTimeRangeSelected = vi.fn();
    const { result } = renderHook(() => useChartInteraction(makeOptions(onTimeRangeSelected)));

    // mouseUp without prior mouseDown → !isSelecting branch
    act(() => {
      result.current.handlers.handleMouseUp();
    });

    expect(result.current.state.isSelecting).toBe(false);
    expect(onTimeRangeSelected).not.toHaveBeenCalled();
  });
});

describe('useChartInteraction — handleDoubleClick', () => {
  beforeEach(() => {
    mockLocalPoint.mockReset();
  });

  it('calls onResetZoom when provided', () => {
    const onResetZoom = vi.fn();
    const { result } = renderHook(() => useChartInteraction({ ...makeOptions(), onResetZoom }));

    act(() => {
      result.current.handlers.handleDoubleClick();
    });

    expect(onResetZoom).toHaveBeenCalledTimes(1);
  });

  it('does nothing when onResetZoom is undefined', () => {
    const options = { ...makeOptions(), onResetZoom: undefined };
    const { result } = renderHook(() => useChartInteraction(options));

    // Should not throw
    expect(() => {
      act(() => {
        result.current.handlers.handleDoubleClick();
      });
    }).not.toThrow();
  });
});

describe('useChartInteraction — handleMouseMove branches', () => {
  beforeEach(() => {
    mockLocalPoint.mockReset();
  });

  it('returns early when localPoint returns null during move', () => {
    const { result } = renderHook(() => useChartInteraction(makeOptions()));

    mockLocalPoint.mockReturnValueOnce(null);
    act(() => {
      result.current.handlers.handleMouseMove(
        {} as React.MouseEvent<SVGRectElement>,
        vi.fn()
      );
    });

    // No state changes, no errors
    expect(result.current.state.cursorX).toBeUndefined();
  });

  it('hides tooltip when cursor leaves chart and NOT selecting', () => {
    const hideTooltip = vi.fn();
    const options = { ...makeOptions(), hideTooltip };
    const { result } = renderHook(() => useChartInteraction(options));

    // Move cursor outside chart bounds (x < 0) without starting selection
    mockLocalPoint.mockReturnValueOnce({ x: -10, y: 50 });
    act(() => {
      result.current.handlers.handleMouseMove(
        {} as React.MouseEvent<SVGRectElement>,
        vi.fn()
      );
    });

    expect(hideTooltip).toHaveBeenCalled();
    expect(result.current.state.cursorX).toBeUndefined();
  });

  it('does not show tooltip when no bucket found at index (bucket is undefined)', () => {
    const showTooltipFn = vi.fn();
    // makeOptions has getBucketAtIndex: () => undefined
    const { result } = renderHook(() => useChartInteraction(makeOptions()));

    // Move cursor inside chart, not selecting, bucket=undefined
    mockLocalPoint.mockReturnValueOnce({ x: 200, y: 50 });
    act(() => {
      result.current.handlers.handleMouseMove(
        {} as React.MouseEvent<SVGRectElement>,
        showTooltipFn
      );
    });

    // No tooltip shown, cursorX not set
    expect(showTooltipFn).not.toHaveBeenCalled();
    expect(result.current.state.cursorX).toBeUndefined();
  });

  it('does not show tooltip when index equals bucketCount (cursor at exact right edge)', () => {
    const showTooltipFn = vi.fn();
    const { result } = renderHook(() => useChartInteraction(makeOptions()));

    // x = xMax exactly → index = xMax / xScaleStep = 1000/10 = 100 = bucketCount → out of range
    mockLocalPoint.mockReturnValueOnce({ x: X_MAX, y: 50 });
    act(() => {
      result.current.handlers.handleMouseMove(
        {} as React.MouseEvent<SVGRectElement>,
        showTooltipFn
      );
    });

    expect(showTooltipFn).not.toHaveBeenCalled();
    expect(result.current.state.cursorX).toBeUndefined();
  });

  it('snaps to minTime when cursor leaves chart to the left during selection (line 154)', () => {
    const { result } = renderHook(() => useChartInteraction(makeOptions()));

    // Start a selection first
    mockLocalPoint.mockReturnValueOnce({ x: 500, y: 50 });
    act(() => {
      result.current.handlers.handleMouseDown({} as React.MouseEvent<SVGRectElement>);
    });

    // Now move mouse to x < 0 while selecting → snapTime = minTime
    mockLocalPoint.mockReturnValueOnce({ x: -20, y: 50 });
    act(() => {
      result.current.handlers.handleMouseMove(
        {} as React.MouseEvent<SVGRectElement>,
        vi.fn()
      );
    });

    // selectionEnd should have been set to a snapped time (minTime)
    expect(result.current.state.selectionEnd?.time).toBe(MIN_TIME);
  });

  it('snaps to maxTime when cursor leaves chart to the right during selection (line 154)', () => {
    const { result } = renderHook(() => useChartInteraction(makeOptions()));

    // Start a selection first
    mockLocalPoint.mockReturnValueOnce({ x: 500, y: 50 });
    act(() => {
      result.current.handlers.handleMouseDown({} as React.MouseEvent<SVGRectElement>);
    });

    // Move mouse to x > xMax while selecting → snapTime = maxTime
    mockLocalPoint.mockReturnValueOnce({ x: X_MAX + 50, y: 50 });
    act(() => {
      result.current.handlers.handleMouseMove(
        {} as React.MouseEvent<SVGRectElement>,
        vi.fn()
      );
    });

    // selectionEnd should have been set to a snapped time (maxTime)
    expect(result.current.state.selectionEnd?.time).toBe(MAX_TIME);
  });

  it('shows tooltip and sets cursorX when a valid bucket is found (lines 194-195)', () => {
    const fakeBucket = { timestamp: 100_000, timeLabel: '00:00:00', total: 5 };
    const options = {
      ...makeOptions(),
      getBucketAtIndex: vi.fn().mockReturnValue(fakeBucket),
    };
    const { result } = renderHook(() => useChartInteraction(options));

    const showTooltipFn = vi.fn();

    // Move mouse to a position inside the chart
    mockLocalPoint.mockReturnValueOnce({ x: 400, y: 50 });
    act(() => {
      result.current.handlers.handleMouseMove(
        {} as React.MouseEvent<SVGRectElement>,
        showTooltipFn
      );
    });

    // cursorX should be updated and showTooltip should have been called
    expect(result.current.state.cursorX).toBe(400);
    expect(showTooltipFn).toHaveBeenCalledWith(
      expect.objectContaining({ tooltipData: fakeBucket }),
    );
  });
});

describe('useChartInteraction — null/undefined minTime/maxTime defensive fallbacks', () => {
  beforeEach(() => {
    mockLocalPoint.mockReset();
  });

  it('covers ?? 0 fallbacks when minTime and maxTime are null (handleMouseDown + handleMouseUp)', () => {
    const onTimeRangeSelected = vi.fn();
    const options = {
      ...makeOptions(onTimeRangeSelected),
      minTime: null as unknown as TimestampMicros,
      maxTime: null as unknown as TimestampMicros,
    };
    const { result } = renderHook(() => useChartInteraction(options));

    // handleMouseDown: uses (maxTime ?? 0) - (minTime ?? 0) → covers ?? 0 branches at lines 79-80
    mockLocalPoint.mockReturnValueOnce({ x: 300, y: 50 });
    act(() => {
      result.current.handlers.handleMouseDown({} as React.MouseEvent<SVGRectElement>);
    });

    // Move inside chart while selecting: covers (minTime ?? 0) + ... at lines 165-166
    mockLocalPoint.mockReturnValueOnce({ x: 700, y: 50 });
    act(() => {
      result.current.handlers.handleMouseMove({} as React.MouseEvent<SVGRectElement>, vi.fn());
    });

    // Move to x < 0 while selecting: covers snapTime = x < 0 ? (minTime ?? 0) at line 154
    mockLocalPoint.mockReturnValueOnce({ x: -10, y: 50 });
    act(() => {
      result.current.handlers.handleMouseMove({} as React.MouseEvent<SVGRectElement>, vi.fn());
    });

    // handleMouseUp: uses (minTime ?? 0) and (maxTime ?? 0) in snap logic at lines 107-109
    act(() => {
      result.current.handlers.handleMouseUp();
    });

    expect(result.current.state.isSelecting).toBe(false);
  });

  it('covers maxTime ?? 0 when cursor leaves chart to the right with null maxTime', () => {
    const options = {
      ...makeOptions(),
      minTime: null as unknown as TimestampMicros,
      maxTime: null as unknown as TimestampMicros,
    };
    const { result } = renderHook(() => useChartInteraction(options));

    // Start selection
    mockLocalPoint.mockReturnValueOnce({ x: 300, y: 50 });
    act(() => {
      result.current.handlers.handleMouseDown({} as React.MouseEvent<SVGRectElement>);
    });

    // Move to x > xMax while selecting: covers snapTime = ... ? (maxTime ?? 0) at line 154
    mockLocalPoint.mockReturnValueOnce({ x: X_MAX + 50, y: 50 });
    act(() => {
      result.current.handlers.handleMouseMove({} as React.MouseEvent<SVGRectElement>, vi.fn());
    });

    act(() => {
      result.current.handlers.handleMouseUp();
    });

    expect(result.current.state.isSelecting).toBe(false);
  });

  it('covers xMax=0 branch in bucketTimeSpan calculation', () => {
    const onTimeRangeSelected = vi.fn();
    const options = { ...makeOptions(onTimeRangeSelected), xMax: 0 };
    const { result } = renderHook(() => useChartInteraction(options));

    // With xMax=0: x = 0 (point.x - marginLeft = 0-0), 0 < 0 = false, 0 > 0 = false
    // → proceeds to selection, progress = 0/0 = NaN, clickTime = NaN
    mockLocalPoint.mockReturnValueOnce({ x: 0, y: 50 });
    act(() => {
      result.current.handlers.handleMouseDown({} as React.MouseEvent<SVGRectElement>);
    });

    act(() => {
      result.current.handlers.handleMouseUp();
    });

    // xMax > 0 → false → bucketTimeSpan = 0 (branch 8[1] covered)
    expect(result.current.state.isSelecting).toBe(false);
    expect(onTimeRangeSelected).not.toHaveBeenCalled();
  });
});

describe('useChartInteraction — onCursorMove callback', () => {
  beforeEach(() => {
    mockLocalPoint.mockReset();
  });

  it('fires onCursorMove with the cursor time when the mouse moves in normal mode', () => {
    const onCursorMove = vi.fn();
    const fakeBucket = { timestamp: 100_000, timeLabel: '00:00:00', total: 5 };
    const options = {
      ...makeOptions(),
      getBucketAtIndex: vi.fn().mockReturnValue(fakeBucket),
      onCursorMove,
    };
    const { result } = renderHook(() => useChartInteraction(options));

    mockLocalPoint.mockReturnValueOnce({ x: 400, y: 50 });
    act(() => {
      result.current.handlers.handleMouseMove({} as React.MouseEvent<SVGRectElement>, vi.fn());
    });

    expect(onCursorMove).toHaveBeenCalledWith(xToTime(400));
  });

  it('fires onCursorMove(null) when the mouse leaves the chart', () => {
    const onCursorMove = vi.fn();
    const options = { ...makeOptions(), onCursorMove };
    const { result } = renderHook(() => useChartInteraction(options));

    act(() => {
      result.current.handlers.handleMouseLeave();
    });

    expect(onCursorMove).toHaveBeenCalledWith(null);
  });

  it('does NOT fire onCursorMove during a drag selection', () => {
    const onCursorMove = vi.fn();
    const options = { ...makeOptions(), onCursorMove };
    const { result } = renderHook(() => useChartInteraction(options));

    // Start selection
    mockLocalPoint.mockReturnValueOnce({ x: 300, y: 50 });
    act(() => {
      result.current.handlers.handleMouseDown({} as React.MouseEvent<SVGRectElement>);
    });
    onCursorMove.mockClear();

    // Move during selection — onCursorMove must stay silent
    mockLocalPoint.mockReturnValueOnce({ x: 600, y: 50 });
    act(() => {
      result.current.handlers.handleMouseMove({} as React.MouseEvent<SVGRectElement>, vi.fn());
    });

    expect(onCursorMove).not.toHaveBeenCalled();
  });

  it('fires onCursorMove(null) when a drag selection starts', () => {
    const onCursorMove = vi.fn();
    const options = { ...makeOptions(), onCursorMove };
    const { result } = renderHook(() => useChartInteraction(options));

    mockLocalPoint.mockReturnValueOnce({ x: 300, y: 50 });
    act(() => {
      result.current.handlers.handleMouseDown({} as React.MouseEvent<SVGRectElement>);
    });

    expect(onCursorMove).toHaveBeenCalledWith(null);
  });
});

describe('useChartInteraction — onSelectionChange callback', () => {
  beforeEach(() => {
    mockLocalPoint.mockReset();
  });

  it('fires onSelectionChange with ordered start/end during a drag', () => {
    const onSelectionChange = vi.fn();
    const options = { ...makeOptions(), onSelectionChange };
    const { result } = renderHook(() => useChartInteraction(options));

    // Start selection at x=600
    mockLocalPoint.mockReturnValueOnce({ x: 600, y: 50 });
    act(() => {
      result.current.handlers.handleMouseDown({} as React.MouseEvent<SVGRectElement>);
    });

    // Drag left to x=200 — the reported range must still be startUs < endUs
    mockLocalPoint.mockReturnValueOnce({ x: 200, y: 50 });
    act(() => {
      result.current.handlers.handleMouseMove({} as React.MouseEvent<SVGRectElement>, vi.fn());
    });

    expect(onSelectionChange).toHaveBeenCalledWith({
      startUs: xToTime(200),
      endUs: xToTime(600),
    });
  });

  it('fires onSelectionChange(null) when the selection is committed on mouseUp', () => {
    const onSelectionChange = vi.fn();
    const options = { ...makeOptions(), onSelectionChange };
    const { result } = renderHook(() => useChartInteraction(options));

    simulateDrag(result, 100, 900);

    // The last call must be null (selection cleared after commit)
    const lastCall = onSelectionChange.mock.calls[onSelectionChange.mock.calls.length - 1];
    expect(lastCall[0]).toBeNull();
  });

  it('fires onSelectionChange immediately on mouseDown with a zero-width range', () => {
    const onSelectionChange = vi.fn();
    const options = { ...makeOptions(), onSelectionChange };
    const { result } = renderHook(() => useChartInteraction(options));

    mockLocalPoint.mockReturnValueOnce({ x: 400, y: 50 });
    act(() => {
      result.current.handlers.handleMouseDown({} as React.MouseEvent<SVGRectElement>);
    });

    // First call should be a zero-width range at the click position
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const firstCall = onSelectionChange.mock.calls[0][0];
    expect(firstCall).toEqual({
      startUs: xToTime(400),
      endUs: xToTime(400),
    });
  });
});

describe('useChartInteraction — CTM-based tooltip positioning', () => {
  beforeEach(() => {
    mockLocalPoint.mockReset();
  });

  it('uses CTM-derived screen coordinates when svgRef.current has a working getScreenCTM', () => {
    // The hook now returns svgRef so the component can attach it to the <svg> element.
    // When a real (or mock) SVG is attached, handleMouseMove computes the tooltip
    // position via the SVG's CTM instead of falling back to raw event.clientX/Y —
    // this keeps the bubble pinned to the SVG top edge regardless of scroll position.
    const fakeBucket = { timestamp: 100_000, timeLabel: '00:00:00', total: 5 };
    const options = {
      ...makeOptions(),
      getBucketAtIndex: vi.fn().mockReturnValue(fakeBucket),
    };
    const { result } = renderHook(() => useChartInteraction(options));

    const showTooltipFn = vi.fn();

    // Build a minimal mock SVG: getScreenCTM returns a matrix; createSVGPoint
    // returns a mutable point whose matrixTransform produces the expected screen coords.
    const mockTransformed = { x: 520, y: 80 };
    const mockPoint = { x: 0, y: 0, matrixTransform: vi.fn().mockReturnValue(mockTransformed) };
    const mockSvg = {
      getScreenCTM: vi.fn().mockReturnValue({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      createSVGPoint: vi.fn().mockReturnValue(mockPoint),
    };

    // Attach the mock SVG to the ref that the hook created.
    Object.defineProperty(result.current.svgRef, 'current', {
      value: mockSvg,
      writable: true,
      configurable: true,
    });

    mockLocalPoint.mockReturnValueOnce({ x: 400, y: 50 });
    act(() => {
      result.current.handlers.handleMouseMove(
        { clientX: 999, clientY: 999 } as React.MouseEvent<SVGRectElement>,
        showTooltipFn,
      );
    });

    // Tooltip must use the CTM-derived position, not the raw event coordinates.
    expect(showTooltipFn).toHaveBeenCalledWith(
      expect.objectContaining({
        tooltipData: fakeBucket,
        tooltipLeft: 520,
        tooltipTop: 80,
      }),
    );
    // CTM inputs: pt.x = point.x (400), pt.y = 0 (SVG top edge)
    expect(mockPoint.x).toBe(400);
    expect(mockPoint.y).toBe(0);
  });

  it('uses getBoundingClientRect fallback when svgRef.current.getScreenCTM returns null', () => {
    // When getScreenCTM returns null (e.g. in certain jsdom configurations), the hook
    // falls back to rect-based positioning with viewBox→CSS scaling applied so the
    // horizontal position is correct even when the SVG is rendered responsively.
    const fakeBucket = { timestamp: 100_000, timeLabel: '00:00:00', total: 5 };
    const options = {
      ...makeOptions(),
      getBucketAtIndex: vi.fn().mockReturnValue(fakeBucket),
    };
    const { result } = renderHook(() => useChartInteraction(options));

    const showTooltipFn = vi.fn();

    // SVG rendered at 800 CSS px but has a viewBox of 1000 units → scaleX = 0.8
    const mockSvg = {
      getScreenCTM: vi.fn().mockReturnValue(null),
      getBoundingClientRect: vi.fn().mockReturnValue({ left: 100, top: 200, width: 800 }),
      viewBox: { baseVal: { width: 1000 } },
    };

    Object.defineProperty(result.current.svgRef, 'current', {
      value: mockSvg,
      writable: true,
      configurable: true,
    });

    mockLocalPoint.mockReturnValueOnce({ x: 300, y: 50 });
    act(() => {
      result.current.handlers.handleMouseMove(
        { clientX: 999, clientY: 999 } as React.MouseEvent<SVGRectElement>,
        showTooltipFn,
      );
    });

    // Fallback with viewBox scale: left = rect.left + point.x * (rect.width / viewBoxWidth)
    //   = 100 + 300 * (800 / 1000) = 100 + 240 = 340; top = rect.top = 200
    expect(showTooltipFn).toHaveBeenCalledWith(
      expect.objectContaining({
        tooltipData: fakeBucket,
        tooltipLeft: 340,
        tooltipTop: 200,
      }),
    );
  });
});
