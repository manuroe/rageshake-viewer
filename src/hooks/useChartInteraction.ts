import { useCallback, useState, useEffect, type MouseEvent } from 'react';
import { localPoint } from '@visx/event';
import type { TimestampMicros } from '../types/time.types';
import { MICROS_PER_MILLISECOND } from '../types/time.types';
import { xToTime, snapToEdge } from '../utils/chartUtils';

interface SelectionPoint {
  x: number;
  time: number;
}

/**
 * A committed or in-progress time selection range, in microseconds.
 * Emitted via `onSelectionChange` as the user drags across a chart so sibling
 * charts can mirror the selection overlay in real time.
 */
export interface SelectionRange {
  readonly startUs: number;
  readonly endUs: number;
}

interface ChartInteractionState {
  cursorX: number | undefined;
  cursorTimeLabel: string | undefined;
  isSelecting: boolean;
  selectionStart: SelectionPoint | undefined;
  selectionEnd: SelectionPoint | undefined;
}

interface ChartInteractionHandlers<TBucket> {
  handleMouseDown: (event: MouseEvent<SVGRectElement>) => void;
  handleMouseUp: () => void;
  handleMouseMove: (event: MouseEvent<SVGRectElement>, showTooltipFn: (params: { tooltipData: TBucket; tooltipLeft: number; tooltipTop: number }) => void) => void;
  handleMouseLeave: () => void;
  handleDoubleClick: () => void;
}

interface UseChartInteractionOptions<TBucket> {
  marginLeft: number;
  xMax: number;
  minTime: TimestampMicros;
  maxTime: TimestampMicros;
  formatTime: (timestampUs: number) => string;
  hideTooltip: () => void;
  onTimeRangeSelected?: (startUs: TimestampMicros, endUs: TimestampMicros) => void;
  onResetZoom?: () => void;
  getBucketAtIndex: (index: number) => TBucket | undefined;
  xScaleStep: number;
  bucketCount: number;
  /**
   * Fired whenever the cursor moves to a new time position, or `null` when
   * the cursor leaves the chart. Used to sync a crosshair across sibling charts.
   */
  onCursorMove?: (timeUs: number | null) => void;
  /**
   * Fired on every drag-move with the current in-progress selection range, or
   * `null` when the selection is cleared. Used to mirror the selection band on
   * sibling charts in real time.
   */
  onSelectionChange?: (selection: SelectionRange | null) => void;
}

export interface ChartInteractionResult<TBucket> {
  state: ChartInteractionState;
  handlers: ChartInteractionHandlers<TBucket>;
}

/**
 * Shared hook for chart mouse interaction (selection, cursor, tooltips).
 * Used by LogActivityChart and HttpActivityChart.
 */
export function useChartInteraction<TBucket>({
  marginLeft,
  xMax,
  minTime,
  maxTime,
  formatTime,
  hideTooltip,
  onTimeRangeSelected,
  onResetZoom,
  getBucketAtIndex,
  xScaleStep,
  bucketCount,
  onCursorMove,
  onSelectionChange,
}: UseChartInteractionOptions<TBucket>): ChartInteractionResult<TBucket> {
  const [cursorX, setCursorX] = useState<number | undefined>();
  const [cursorTimeLabel, setCursorTimeLabel] = useState<string | undefined>();
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<SelectionPoint | undefined>();
  const [selectionEnd, setSelectionEnd] = useState<SelectionPoint | undefined>();

  const handleMouseDown = useCallback(
    (event: MouseEvent<SVGRectElement>) => {
      const point = localPoint(event);
      if (!point) return;

      const x = point.x - marginLeft;
      if (x < 0 || x > xMax) return;

      // Calculate time at click position
      const clickTime = xToTime(x, xMax, (minTime ?? 0) as TimestampMicros, (maxTime ?? 0) as TimestampMicros);

      // Start selection mode
      setIsSelecting(true);
      setSelectionStart({ x: point.x, time: clickTime });
      setSelectionEnd({ x: point.x, time: clickTime });

      // Hide tooltip during selection
      hideTooltip();
      setCursorX(undefined);
      setCursorTimeLabel(undefined);
      onCursorMove?.(null);
    },
    [marginLeft, xMax, minTime, maxTime, hideTooltip, onCursorMove]
  );

  const handleMouseUp = useCallback(() => {
    if (!isSelecting || !selectionStart || !selectionEnd) {
      setIsSelecting(false);
      return;
    }

    // Apply time filter (values are in microseconds)
    const rawStart = Math.min(selectionStart.time, selectionEnd.time) as TimestampMicros;
    const rawEnd = Math.max(selectionStart.time, selectionEnd.time) as TimestampMicros;

    // Snap to data edges when the selection boundary falls within one bucket's
    // time span of min/maxTime (handles the case where the user drags to the
    // first/last visible bar but the computed time is slightly inside the bucket).
    const bucketTimeSpan = xMax > 0 ? (xScaleStep / xMax) * ((maxTime ?? 0) - (minTime ?? 0)) : 0;
    const [startTime, endTime] = snapToEdge(
      rawStart,
      rawEnd,
      (minTime ?? 0) as TimestampMicros,
      (maxTime ?? 0) as TimestampMicros,
      bucketTimeSpan
    );

    // Only apply if there's a meaningful range (> 100ms = 100,000 microseconds)
    if (endTime - startTime > 100 * MICROS_PER_MILLISECOND && onTimeRangeSelected) {
      onTimeRangeSelected(startTime, endTime);
    }

    // Clear selection and return to normal mode
    setIsSelecting(false);
    setSelectionStart(undefined);
    setSelectionEnd(undefined);
    onSelectionChange?.(null);
  }, [isSelecting, selectionStart, selectionEnd, onTimeRangeSelected, minTime, maxTime, xScaleStep, xMax, onSelectionChange]);

  // Commit the selection even when the mouse is released outside the chart
  useEffect(() => {
    if (!isSelecting) return;

    const onWindowMouseUp = () => {
      handleMouseUp();
    };

    window.addEventListener('mouseup', onWindowMouseUp);
    return () => {
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
  }, [isSelecting, handleMouseUp]);

  const handleDoubleClick = useCallback(() => {
    if (onResetZoom) {
      onResetZoom();
    }
  }, [onResetZoom]);

  const handleMouseMove = useCallback(
    (
      event: MouseEvent<SVGRectElement>,
      showTooltipFn: (params: { tooltipData: TBucket; tooltipLeft: number; tooltipTop: number }) => void
    ) => {
      const point = localPoint(event);
      if (!point) return;

      const x = point.x - marginLeft;
      if (x < 0 || x > xMax) {
        if (isSelecting) {
          // Cursor left the chart during a drag — snap end to the nearest data boundary
          const snapTime = x < 0 ? (minTime ?? 0) : (maxTime ?? 0);
          setSelectionEnd({ x: point.x, time: snapTime });
        } else {
          hideTooltip();
          setCursorX(undefined);
        }
        return;
      }

      // Calculate actual cursor time based on position
      const cursorTime = xToTime(x, xMax, (minTime ?? 0) as TimestampMicros, (maxTime ?? 0) as TimestampMicros);

      if (isSelecting) {
        // Selection mode: update end cursor position and notify siblings
        setSelectionEnd({ x: point.x, time: cursorTime });
        const startTime = selectionStart?.time ?? cursorTime;
        onSelectionChange?.({
          startUs: Math.min(startTime, cursorTime),
          endUs: Math.max(startTime, cursorTime),
        });
      } else {
        // Normal mode: show tooltip
        const index = Math.floor(x / xScaleStep);

        if (index >= 0 && index < bucketCount) {
          const bucket = getBucketAtIndex(index);

          if (bucket) {
            setCursorX(point.x);
            setCursorTimeLabel(formatTime(cursorTime));
            onCursorMove?.(cursorTime);
            showTooltipFn({
              tooltipData: bucket,
              tooltipLeft: event.clientX,
              tooltipTop: event.clientY,
            });
          }
        }
      }
    },
    [xScaleStep, bucketCount, xMax, marginLeft, minTime, maxTime, formatTime, hideTooltip, isSelecting, getBucketAtIndex, selectionStart, onCursorMove, onSelectionChange]
  );

  const handleMouseLeave = useCallback(() => {
    hideTooltip();
    setCursorX(undefined);
    onCursorMove?.(null);
  }, [hideTooltip, onCursorMove]);

  return {
    state: {
      cursorX,
      cursorTimeLabel,
      isSelecting,
      selectionStart,
      selectionEnd,
    },
    handlers: {
      handleMouseDown,
      handleMouseUp,
      handleMouseMove,
      handleMouseLeave,
      handleDoubleClick,
    },
  };
}
