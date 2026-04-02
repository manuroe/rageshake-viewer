import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { localPoint } from '@visx/event';
import type { TimestampMicros } from '../types/time.types';
import { MICROS_PER_MILLISECOND } from '../types/time.types';
import type { SelectionRange } from './useChartInteraction';
import { xToTime, snapToEdge } from '../utils/chartUtils';

/** A point captured during a drag-selection gesture. */
interface SelectionPoint {
  readonly x: number;
  readonly time: number;
}

/**
 * Options for {@link useStepChartInteraction}.
 *
 * Each chart supplies its own `getTooltipData` callback so the hook can produce
 * chart-specific tooltip content without knowing the data shape.
 */
export interface UseStepChartInteractionOptions<TTooltipData> {
  /** Pixel width of the chart plot area (excluding left/right margins). */
  readonly xMax: number;
  /** SVG viewBox width — used to compute CTM-based tooltip screen position. */
  readonly svgWidth: number;
  /** Left margin of the chart plot area within the SVG, in pixels. */
  readonly marginLeft: number;
  /** Chart domain start in microseconds. */
  readonly minTime: TimestampMicros;
  /** Chart domain end in microseconds. */
  readonly maxTime: TimestampMicros;
  /** Mirrored cursor time from a sibling chart (microseconds). */
  readonly externalCursorTime?: number | null;
  /** Mirrored selection from a sibling chart. */
  readonly externalSelection?: SelectionRange | null;
  /** Fired when the local cursor moves; `null` when it leaves the chart. */
  readonly onCursorMove?: (timeUs: number | null) => void;
  /** Fired on drag-move with the live selection range, or `null` when cleared. */
  readonly onSelectionChange?: (selection: SelectionRange | null) => void;
  /** Fired when the user completes a drag large enough to trigger a zoom. */
  readonly onTimeRangeSelected?: (startUs: TimestampMicros, endUs: TimestampMicros) => void;
  /** Fired when the user double-clicks to reset zoom. */
  readonly onResetZoom?: () => void;
  /**
   * Returns chart-specific tooltip data for the given timestamp in microseconds.
   * Called whenever the hook needs to display a tooltip.
   *
   * @example
   * // HttpConcurrencyChart
   * getTooltipData={(timeUs) => ({
   *   timeUs,
   *   total: getCountAtTime(stepPoints, timeUs),
   *   statusCounts: [],
   * })}
   */
  readonly getTooltipData: (timeUs: number) => TTooltipData;
  /** `showTooltip` provided by `useTooltip<TTooltipData>()`. */
  readonly showTooltip: (params: { tooltipData: TTooltipData; tooltipLeft: number; tooltipTop: number }) => void;
  /** `hideTooltip` provided by `useTooltip()`. */
  readonly hideTooltip: () => void;
}

/** Values and handlers returned by {@link useStepChartInteraction}. */
export interface UseStepChartInteractionResult {
  /** Ref to attach to the `<svg>` element; used internally for CTM tooltip positioning. */
  readonly svgRef: React.RefObject<SVGSVGElement | null>;
  /** Raw SVG x-coordinate of the cursor (includes left margin). */
  readonly cursorX: number | undefined;
  /** Chart time at the cursor position, in microseconds. */
  readonly cursorTimeUs: number | undefined;
  /** True while the user is drag-selecting a time range. */
  readonly isSelecting: boolean;
  /** Start point of an in-progress selection gesture. */
  readonly selectionStart: SelectionPoint | undefined;
  /** Current end point of an in-progress selection gesture. */
  readonly selectionEnd: SelectionPoint | undefined;
  /** Converts a microsecond timestamp to chart-area x pixels (clamped to [0, xMax]). */
  readonly timeToX: (timeUs: number) => number;
  readonly handleMouseMove: (event: MouseEvent<SVGRectElement>) => void;
  readonly handleMouseDown: (event: MouseEvent<SVGRectElement>) => void;
  readonly handleMouseUp: () => void;
  readonly handleMouseLeave: () => void;
  readonly handleDoubleClick: () => void;
  /** True when an external (sibling-chart) selection is currently active. */
  readonly hasExternalSelection: boolean;
  /**
   * True when there is no local cursor/selection and the tooltip is driven by
   * an external (sibling-chart) cursor rather than local hover.
   */
  readonly isExternalTooltipActive: boolean;
}

/**
 * Shared interaction logic for step-function area charts
 * (`HttpConcurrencyChart`, `BandwidthConcurrencyChart`).
 *
 * Manages cursor tracking, drag-to-zoom selection, window-level mouseup,
 * external cursor/selection mirroring, and CTM-based tooltip positioning —
 * all of which are identical between the two concurrency chart variants.
 *
 * Each chart retains ownership of its own `useTooltip()` state and supplies a
 * `getTooltipData` callback so the hook can request chart-specific data without
 * knowing the shape of that data.
 *
 * @example
 * const {
 *   svgRef, cursorX, isSelecting, handleMouseMove, handleMouseDown,
 *   handleMouseUp, handleMouseLeave, handleDoubleClick,
 * } = useStepChartInteraction({
 *   xMax, svgWidth: SVG_WIDTH, marginLeft: MARGIN.left, minTime, maxTime,
 *   externalCursorTime, externalSelection,
 *   onCursorMove, onSelectionChange, onTimeRangeSelected, onResetZoom,
 *   getTooltipData, showTooltip, hideTooltip,
 * });
 */
export function useStepChartInteraction<TTooltipData>({
  xMax,
  svgWidth,
  marginLeft,
  minTime,
  maxTime,
  externalCursorTime,
  externalSelection,
  onCursorMove,
  onSelectionChange,
  onTimeRangeSelected,
  onResetZoom,
  getTooltipData,
  showTooltip,
  hideTooltip,
}: UseStepChartInteractionOptions<TTooltipData>): UseStepChartInteractionResult {
  const [cursorX, setCursorX] = useState<number | undefined>();
  const [cursorTimeUs, setCursorTimeUs] = useState<number | undefined>();
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<SelectionPoint | undefined>();
  const [selectionEnd, setSelectionEnd] = useState<SelectionPoint | undefined>();

  const svgRef = useRef<SVGSVGElement>(null);

  /** Converts a microsecond timestamp to chart-area x pixels, clamped to [0, xMax]. */
  const timeToX = useCallback(
    (timeUs: number): number => {
      const clamped = Math.max(minTime, Math.min(maxTime, timeUs));
      return maxTime === minTime ? 0 : ((clamped - minTime) / (maxTime - minTime)) * xMax;
    },
    [xMax, minTime, maxTime],
  );

  /**
   * Computes CTM-based screen coordinates for `chartX` and shows the tooltip.
   * `chartX` is in chart-area pixels (excludes the left margin).
   */
  const showTooltipAtX = useCallback(
    (chartX: number) => {
      const timeUs = xToTime(chartX, xMax, minTime as TimestampMicros, maxTime as TimestampMicros);
      const tooltipData = getTooltipData(timeUs);
      const svg = svgRef.current;
      if (!svg) return;
      const viewBoxX = chartX + marginLeft;
      const ctm = typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
      let tooltipScreenX = 0;
      let tooltipScreenY = 0;
      if (ctm && typeof svg.createSVGPoint === 'function') {
        const pt = svg.createSVGPoint();
        pt.x = viewBoxX;
        pt.y = 0;
        const tp = pt.matrixTransform(ctm);
        tooltipScreenX = tp.x;
        tooltipScreenY = tp.y;
      } else {
        const rect = svg.getBoundingClientRect();
        const scale = rect.width / svgWidth;
        tooltipScreenX = rect.left + viewBoxX * scale;
        tooltipScreenY = rect.top;
      }
      showTooltip({ tooltipData, tooltipLeft: tooltipScreenX, tooltipTop: tooltipScreenY });
    },
    [xMax, minTime, maxTime, marginLeft, svgWidth, getTooltipData, showTooltip],
  );

  const handleMouseMove = useCallback(
    (event: MouseEvent<SVGRectElement>) => {
      if (isSelecting) {
        const point = localPoint(event);
        if (!point || !selectionStart) return;
        const x = point.x - marginLeft;
        if (x < 0 || x > xMax) return;
        const time = xToTime(x, xMax, minTime as TimestampMicros, maxTime as TimestampMicros);
        setSelectionEnd({ x: point.x, time });
        onSelectionChange?.({ startUs: selectionStart.time as TimestampMicros, endUs: time as TimestampMicros });
        return;
      }
      const point = localPoint(event);
      if (!point) return;
      const x = point.x - marginLeft;
      if (x < 0 || x > xMax) return;
      const timeUs = xToTime(x, xMax, minTime as TimestampMicros, maxTime as TimestampMicros);
      setCursorX(point.x);
      setCursorTimeUs(timeUs);
      onCursorMove?.(timeUs);
      showTooltipAtX(x);
    },
    [isSelecting, xMax, marginLeft, minTime, maxTime, selectionStart, onSelectionChange, onCursorMove, showTooltipAtX],
  );

  const handleMouseDown = useCallback(
    (event: MouseEvent<SVGRectElement>) => {
      const point = localPoint(event);
      if (!point) return;
      const x = point.x - marginLeft;
      if (x < 0 || x > xMax) return;
      const time = xToTime(x, xMax, minTime as TimestampMicros, maxTime as TimestampMicros);
      setIsSelecting(true);
      setSelectionStart({ x: point.x, time });
      setSelectionEnd({ x: point.x, time });
      hideTooltip();
      setCursorX(undefined);
      setCursorTimeUs(undefined);
      onCursorMove?.(null);
      onSelectionChange?.({ startUs: time as TimestampMicros, endUs: time as TimestampMicros });
    },
    [xMax, marginLeft, minTime, maxTime, hideTooltip, onCursorMove, onSelectionChange],
  );

  const commitSelection = useCallback(() => {
    if (!isSelecting || !selectionStart || !selectionEnd) {
      setIsSelecting(false);
      return;
    }
    const rawStart = Math.min(selectionStart.time, selectionEnd.time) as TimestampMicros;
    const rawEnd = Math.max(selectionStart.time, selectionEnd.time) as TimestampMicros;
    const bucketTimeSpan = xMax > 0 ? (1 / xMax) * (maxTime - minTime) : 0;
    const [startSnapped, endSnapped] = snapToEdge(
      rawStart,
      rawEnd,
      minTime as TimestampMicros,
      maxTime as TimestampMicros,
      bucketTimeSpan,
    );
    if (endSnapped - startSnapped > 100 * MICROS_PER_MILLISECOND && onTimeRangeSelected) {
      onTimeRangeSelected(startSnapped, endSnapped);
    }
    setIsSelecting(false);
    setSelectionStart(undefined);
    setSelectionEnd(undefined);
    onSelectionChange?.(null);
  }, [isSelecting, selectionStart, selectionEnd, xMax, minTime, maxTime, onTimeRangeSelected, onSelectionChange]);

  const handleMouseUp = useCallback(() => commitSelection(), [commitSelection]);

  const handleMouseLeave = useCallback(() => {
    if (isSelecting) return;
    setCursorX(undefined);
    setCursorTimeUs(undefined);
    onCursorMove?.(null);
    hideTooltip();
  }, [isSelecting, onCursorMove, hideTooltip]);

  const handleDoubleClick = useCallback(() => onResetZoom?.(), [onResetZoom]);

  // Commit selection on window mouseup (handles release outside the SVG).
  useEffect(() => {
    if (!isSelecting) return;
    const onWindowMouseUp = () => commitSelection();
    window.addEventListener('mouseup', onWindowMouseUp);
    return () => window.removeEventListener('mouseup', onWindowMouseUp);
  }, [isSelecting, commitSelection]);

  // Mirror external cursor as a tooltip when no local interaction is active.
  const hasExternalSelection = externalSelection !== null && externalSelection !== undefined;
  const isExternalTooltipActive =
    !isSelecting &&
    cursorX === undefined &&
    !hasExternalSelection &&
    externalCursorTime !== null &&
    externalCursorTime !== undefined;

  useEffect(() => {
    if (
      externalCursorTime === null ||
      externalCursorTime === undefined ||
      hasExternalSelection ||
      isSelecting ||
      cursorX !== undefined
    ) {
      if (cursorX === undefined && !isSelecting) hideTooltip();
      return;
    }
    if (externalCursorTime < minTime || externalCursorTime > maxTime) {
      hideTooltip();
      return;
    }
    showTooltipAtX(timeToX(externalCursorTime));
  }, [externalCursorTime, hasExternalSelection, isSelecting, cursorX, minTime, maxTime, showTooltipAtX, timeToX, hideTooltip]);

  return {
    svgRef,
    cursorX,
    cursorTimeUs,
    isSelecting,
    selectionStart,
    selectionEnd,
    timeToX,
    handleMouseMove,
    handleMouseDown,
    handleMouseUp,
    handleMouseLeave,
    handleDoubleClick,
    hasExternalSelection,
    isExternalTooltipActive,
  };
}
