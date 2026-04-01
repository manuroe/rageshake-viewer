import { useMemo, useCallback, useRef, useEffect, useState, type MouseEvent } from 'react';
import { Group } from '@visx/group';
import { Area, Line } from '@visx/shape';
import { scaleLinear } from '@visx/scale';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { useTooltip, TooltipWithBounds } from '@visx/tooltip';
import { localPoint } from '@visx/event';
import { curveStepAfter } from 'd3-shape';
import type { TimestampMicros } from '../types/time.types';
import { MICROS_PER_MILLISECOND } from '../types/time.types';
import type { HttpRequestSpan } from '../types/log.types';
import type { SelectionRange } from '../hooks/useChartInteraction';
import { xToTime, snapToEdge } from '../utils/chartUtils';
import { computeStepPoints, getCountAtTime } from '../utils/concurrencyUtils';
import { getBucketKey, getBucketColor, getBucketLabel, sortStatusCodes } from '../utils/httpStatusBuckets';

// Re-export for consumers that need the type alongside the component.
export type { StepPoint } from '../utils/concurrencyUtils';

interface HttpConcurrencyChartProps {
  /** Per-request time spans, each with precise start/end timestamps. */
  httpRequestSpans: readonly HttpRequestSpan[];
  /** Time range that defines the chart's x-axis domain, shared with sibling charts. */
  timeRange: { minTime: TimestampMicros; maxTime: TimestampMicros };
  /** Callback when user drag-selects a time range. */
  onTimeRangeSelected?: (startUs: TimestampMicros, endUs: TimestampMicros) => void;
  /** Callback when user double-clicks to reset zoom. */
  onResetZoom?: () => void;
  /** Mirrored cursor time from a sibling chart (microseconds). */
  externalCursorTime?: number | null;
  /** Mirrored selection from a sibling chart. */
  externalSelection?: SelectionRange | null;
  /** Fired as the cursor moves across this chart. */
  onCursorMove?: (timeUs: number | null) => void;
  /** Fired as a drag selection changes on this chart. */
  onSelectionChange?: (selection: SelectionRange | null) => void;
  /** Chart height in pixels. */
  height?: number;
}

interface TooltipStatusCount {
  readonly key: string;
  readonly count: number;
}

interface TooltipData {
  readonly timeUs: number;
  readonly total: number;
  /** Per-status counts in display order (reversed from stack order so highest is first). */
  readonly statusCounts: readonly TooltipStatusCount[];
}


interface SelectionPoint {
  readonly x: number;
  readonly time: number;
}

const SVG_WIDTH = 800;
const MARGIN = { top: 10, right: 10, bottom: 30, left: 50 };

/**
 * Step-function area chart for the "Show in-flight" concurrent mode on the /summary screen.
 *
 * Unlike the bar histogram, this chart uses the precise `startUs`/`endUs` timestamps
 * from `HttpRequestSpan` to compute an exact concurrency waveform — no bucketing
 * approximation.  The area rises exactly when a request begins and drops exactly when
 * it completes.
 */
export function HttpConcurrencyChart({
  httpRequestSpans,
  timeRange,
  onTimeRangeSelected,
  onResetZoom,
  externalCursorTime,
  externalSelection,
  onCursorMove,
  onSelectionChange,
  height = 120,
}: HttpConcurrencyChartProps) {
  const { minTime, maxTime } = timeRange;

  const xMax = SVG_WIDTH - MARGIN.left - MARGIN.right;
  const yMax = height - MARGIN.top - MARGIN.bottom;

  // ── Step-function data preparation ───────────────────────────────────────
  /** Total concurrency at each event boundary — used for y-scale domain. */
  const stepPoints = useMemo(
    () => computeStepPoints(httpRequestSpans, minTime, maxTime),
    [httpRequestSpans, minTime, maxTime],
  );

  /** Ordered status-bucket keys derived from the spans (same ordering as bar mode). */
  const orderedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const span of httpRequestSpans) keys.add(getBucketKey(span));
    return sortStatusCodes(Array.from(keys));
  }, [httpRequestSpans]);

  /** Per-key step points for each status bucket. */
  const stepPointsByKey = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeStepPoints>>();
    const grouped = new Map<string, typeof httpRequestSpans[number][]>();
    for (const key of orderedKeys) grouped.set(key, []);
    for (const span of httpRequestSpans) {
      const k = getBucketKey(span);
      grouped.get(k)?.push(span);
    }
    for (const key of orderedKeys) {
      map.set(key, computeStepPoints(grouped.get(key) ?? [], minTime, maxTime));
    }
    return map;
  }, [orderedKeys, httpRequestSpans, minTime, maxTime]);

  /**
   * Unified timeline merging all per-key event boundaries.
   * Each point carries the cumulative `y0` and `y1` for every key so that
   * each `Area` layer can be rendered independently without re-scanning.
   */
  const stackedLayers = useMemo(() => {
    // Collect every time breakpoint from all key series.
    const allTimes = new Set([minTime, maxTime]);
    for (const pts of stepPointsByKey.values()) {
      for (const p of pts) allTimes.add(p.timeUs);
    }
    const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);

    // Precompute per-key counts at each time in `sortedTimes` once (O(keys × times)).
    const countsByKey = new Map<string, number[]>();
    for (const key of orderedKeys) {
      const pts = stepPointsByKey.get(key) ?? [];
      const counts: number[] = [];
      for (const timeUs of sortedTimes) {
        counts.push(getCountAtTime(pts, timeUs));
      }
      countsByKey.set(key, counts);
    }

    // Build stacked layers using cumulative prefix sums so each key's y0/y1
    // is derived in O(keys × times) instead of O(keys² × times).
    const cumulativeAtTime = new Array<number>(sortedTimes.length).fill(0);

    return orderedKeys.map((key) => {
      const counts = countsByKey.get(key) ?? [];
      const points = sortedTimes.map((timeUs, idx) => {
        const y0 = cumulativeAtTime[idx];
        const countHere = counts[idx] ?? 0;
        const y1 = y0 + countHere;
        cumulativeAtTime[idx] = y1;
        return { timeUs, y0, y1 };
      });
      return {
        key,
        color: getBucketColor(key),
        points,
      };
    });
  }, [orderedKeys, stepPointsByKey, minTime, maxTime]);

  const maxCount = useMemo(
    () => Math.max(...stepPoints.map((p) => p.count), 1),
    [stepPoints],
  );

  const xScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [minTime, maxTime],
        range: [0, xMax],
        clamp: true,
      }),
    [minTime, maxTime, xMax],
  );

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, maxCount],
        range: [yMax, 0],
        nice: true,
      }),
    [maxCount, yMax],
  );

  const formatTime = useCallback((timestampUs: number): string => {
    const date = new Date(timestampUs / MICROS_PER_MILLISECOND);
    return date.toISOString().split('T')[1].split('.')[0];
  }, []);

  // ── Tooltip ──────────────────────────────────────────────────────────────
  const { tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip } =
    useTooltip<TooltipData>();

  // ── Interaction state ────────────────────────────────────────────────────
  const [cursorX, setCursorX] = useState<number | undefined>();
  const [cursorTimeUs, setCursorTimeUs] = useState<number | undefined>();
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionStart, setSelectionStart] = useState<SelectionPoint | undefined>();
  const [selectionEnd, setSelectionEnd] = useState<SelectionPoint | undefined>();

  const svgRef = useRef<SVGSVGElement>(null);

  /** Convert a microsecond timestamp to SVG x-coordinate within the chart area. */
  const timeToX = useCallback(
    (timeUs: number): number => xScale(Math.max(minTime, Math.min(maxTime, timeUs))),
    [xScale, minTime, maxTime],
  );

  const showTooltipAtX = useCallback(
    (chartX: number) => {
      const timeUs = xToTime(chartX, xMax, minTime as TimestampMicros, maxTime as TimestampMicros);
      const total = getCountAtTime(stepPoints, timeUs);
      const statusCounts = [...orderedKeys]
        .reverse()
        .map((key) => ({ key, count: getCountAtTime(stepPointsByKey.get(key) ?? [], timeUs) }))
        .filter((s) => s.count > 0);
      const svg = svgRef.current;
      if (!svg) return;
      const viewBoxX = chartX + MARGIN.left;
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
        const scale = rect.width / SVG_WIDTH;
        tooltipScreenX = rect.left + viewBoxX * scale;
        tooltipScreenY = rect.top;
      }
      showTooltip({
        tooltipData: { timeUs, total, statusCounts },
        tooltipLeft: tooltipScreenX,
        tooltipTop: tooltipScreenY,
      });
    },
    [xMax, minTime, maxTime, stepPoints, orderedKeys, stepPointsByKey, showTooltip],
  );

  // ── Mouse handlers ────────────────────────────────────────────────────────
  const handleMouseMove = useCallback(
    (event: MouseEvent<SVGRectElement>) => {
      if (isSelecting) {
        const point = localPoint(event);
        if (!point) return;
        const x = point.x - MARGIN.left;
        if (x < 0 || x > xMax) return;
        const time = xToTime(x, xMax, minTime as TimestampMicros, maxTime as TimestampMicros);
        setSelectionEnd({ x: point.x, time });
        onSelectionChange?.({ startUs: selectionStart!.time as TimestampMicros, endUs: time as TimestampMicros });
        return;
      }
      const point = localPoint(event);
      if (!point) return;
      const x = point.x - MARGIN.left;
      if (x < 0 || x > xMax) return;
      const timeUs = xToTime(x, xMax, minTime as TimestampMicros, maxTime as TimestampMicros);
      setCursorX(point.x);
      setCursorTimeUs(timeUs);
      onCursorMove?.(timeUs);
      showTooltipAtX(x);
    },
    [isSelecting, xMax, minTime, maxTime, selectionStart, onSelectionChange, onCursorMove, showTooltipAtX],
  );

  const handleMouseDown = useCallback(
    (event: MouseEvent<SVGRectElement>) => {
      const point = localPoint(event);
      if (!point) return;
      const x = point.x - MARGIN.left;
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
    [xMax, minTime, maxTime, hideTooltip, onCursorMove, onSelectionChange],
  );

  const commitSelection = useCallback(() => {
    if (!isSelecting || !selectionStart || !selectionEnd) {
      setIsSelecting(false);
      return;
    }
    const rawStart = Math.min(selectionStart.time, selectionEnd.time) as TimestampMicros;
    const rawEnd = Math.max(selectionStart.time, selectionEnd.time) as TimestampMicros;
    // Snap to edges: treat a time range spanning the chart width as "bucketTimeSpan"
    const bucketTimeSpan = xMax > 0 ? ((1 / xMax) * (maxTime - minTime)) : 0;
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

  const handleMouseUp = useCallback(() => {
    commitSelection();
  }, [commitSelection]);

  const handleMouseLeave = useCallback(() => {
    if (isSelecting) return;
    setCursorX(undefined);
    setCursorTimeUs(undefined);
    onCursorMove?.(null);
    hideTooltip();
  }, [isSelecting, onCursorMove, hideTooltip]);

  const handleDoubleClick = useCallback(() => {
    onResetZoom?.();
  }, [onResetZoom]);

  // Commit selection on window mouseup (handles release outside SVG).
  useEffect(() => {
    if (!isSelecting) return;
    const onWindowMouseUp = () => commitSelection();
    window.addEventListener('mouseup', onWindowMouseUp);
    return () => window.removeEventListener('mouseup', onWindowMouseUp);
  }, [isSelecting, commitSelection]);

  // ── External cursor tooltip ───────────────────────────────────────────────
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

  // ── Empty state ────────────────────────────────────────────────────────────
  if (stepPoints.length === 0) {
    return (
      <div className="chart-empty" style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
        No in-flight request data to display
      </div>
    );
  }

  const activeCursorX = cursorX !== undefined ? cursorX - MARGIN.left : undefined;
  const activeCursorTime = cursorTimeUs !== undefined ? formatTime(cursorTimeUs) : undefined;

  return (
    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <svg
          ref={svgRef}
          width="100%"
          height={height}
          viewBox={`0 0 ${SVG_WIDTH} ${height}`}
          style={{ display: 'block' }}
        >
          <Group left={MARGIN.left} top={MARGIN.top}>
            {/* Stacked area fills — one layer per status bucket (bottom to top) */}
            {stackedLayers.map((layer) => (
              <Area
                key={layer.key}
                data={layer.points}
                x={(d) => xScale(d.timeUs)}
                y1={(d) => yScale(d.y1)}
                y0={(d) => yScale(d.y0)}
                curve={curveStepAfter}
                fill={layer.color}
                fillOpacity={0.7}
              />
            ))}

            {/* Axes */}
            <AxisBottom
              top={yMax}
              scale={xScale}
              tickFormat={() => ''}
              stroke="#666"
              tickStroke="#666"
            />
            <AxisLeft
              scale={yScale}
              stroke="#666"
              tickStroke="#666"
              numTicks={4}
              tickLabelProps={() => ({
                fill: '#666',
                fontSize: 10,
                textAnchor: 'end',
                dx: -4,
              })}
            />

            {/* Start/end time labels */}
            <text x={0} y={yMax + 16} textAnchor="start" fontSize={9} fill="#666" pointerEvents="none">
              {formatTime(minTime)}
            </text>
            <text x={xMax} y={yMax + 16} textAnchor="end" fontSize={9} fill="#666" pointerEvents="none">
              {formatTime(maxTime)}
            </text>

            {/* Invisible overlay for mouse events */}
            <rect
              width={xMax}
              height={yMax}
              fill="transparent"
              onMouseDown={handleMouseDown}
              onMouseUp={handleMouseUp}
              onMouseMove={handleMouseMove}
              onDoubleClick={handleDoubleClick}
              onMouseLeave={handleMouseLeave}
              style={{ cursor: isSelecting ? 'col-resize' : 'crosshair' }}
            />

            {/* Selection: two cursor lines + highlighted band */}
            {isSelecting && selectionStart && selectionEnd && (
              <>
                <rect
                  x={Math.min(selectionStart.x, selectionEnd.x) - MARGIN.left}
                  y={0}
                  width={Math.abs(selectionEnd.x - selectionStart.x)}
                  height={yMax}
                  fill="rgba(33, 150, 243, 0.2)"
                  pointerEvents="none"
                />
                <Line
                  from={{ x: selectionStart.x - MARGIN.left, y: 0 }}
                  to={{ x: selectionStart.x - MARGIN.left, y: yMax }}
                  stroke="#2196f3"
                  strokeWidth={2}
                  pointerEvents="none"
                />
                <Line
                  from={{ x: selectionEnd.x - MARGIN.left, y: 0 }}
                  to={{ x: selectionEnd.x - MARGIN.left, y: yMax }}
                  stroke="#2196f3"
                  strokeWidth={2}
                  pointerEvents="none"
                />
                <text x={selectionStart.x - MARGIN.left} y={yMax + 20} textAnchor="middle" fontSize={10} fill="#2196f3" fontWeight="bold" pointerEvents="none">
                  {formatTime(selectionStart.time)}
                </text>
                <text x={selectionEnd.x - MARGIN.left} y={yMax + 20} textAnchor="middle" fontSize={10} fill="#2196f3" fontWeight="bold" pointerEvents="none">
                  {formatTime(selectionEnd.time)}
                </text>
              </>
            )}

            {/* Local cursor line + time label */}
            {!isSelecting && activeCursorX !== undefined && (
              <>
                <Line
                  from={{ x: activeCursorX, y: 0 }}
                  to={{ x: activeCursorX, y: yMax }}
                  stroke="#666"
                  strokeWidth={1}
                  pointerEvents="none"
                  strokeDasharray="4,2"
                />
                <text x={activeCursorX} y={yMax + 20} textAnchor="middle" fontSize={10} fill="#333" fontWeight="bold" pointerEvents="none">
                  {activeCursorTime}
                </text>
              </>
            )}

            {/* External cursor: mirrored crosshair from a sibling chart */}
            {!isSelecting && !hasExternalSelection && cursorX === undefined && externalCursorTime !== null && externalCursorTime !== undefined && (
              <>
                <Line
                  from={{ x: timeToX(externalCursorTime), y: 0 }}
                  to={{ x: timeToX(externalCursorTime), y: yMax }}
                  stroke="#666"
                  strokeWidth={1}
                  pointerEvents="none"
                  strokeDasharray="4,2"
                />
                <text x={timeToX(externalCursorTime)} y={yMax + 20} textAnchor="middle" fontSize={10} fill="#333" fontWeight="bold" pointerEvents="none">
                  {formatTime(externalCursorTime)}
                </text>
              </>
            )}

            {/* External selection: mirrored selection band from a sibling chart */}
            {!isSelecting && externalSelection !== null && externalSelection !== undefined && (() => {
              const selStartX = timeToX(Math.min(externalSelection.startUs, externalSelection.endUs));
              const selEndX = timeToX(Math.max(externalSelection.startUs, externalSelection.endUs));
              return (
                <>
                  <rect x={selStartX} y={0} width={selEndX - selStartX} height={yMax} fill="rgba(33, 150, 243, 0.2)" pointerEvents="none" />
                  <Line from={{ x: selStartX, y: 0 }} to={{ x: selStartX, y: yMax }} stroke="#2196f3" strokeWidth={2} pointerEvents="none" />
                  <Line from={{ x: selEndX, y: 0 }} to={{ x: selEndX, y: yMax }} stroke="#2196f3" strokeWidth={2} pointerEvents="none" />
                  <text x={selStartX} y={yMax + 20} textAnchor="middle" fontSize={10} fill="#2196f3" fontWeight="bold" pointerEvents="none">
                    {formatTime(Math.min(externalSelection.startUs, externalSelection.endUs))}
                  </text>
                  <text x={selEndX} y={yMax + 20} textAnchor="middle" fontSize={10} fill="#2196f3" fontWeight="bold" pointerEvents="none">
                    {formatTime(Math.max(externalSelection.startUs, externalSelection.endUs))}
                  </text>
                </>
              );
            })()}
          </Group>
        </svg>

        {/* Tooltip — local hover */}
        {!isSelecting && tooltipData && tooltipLeft !== undefined && tooltipTop !== undefined && !isExternalTooltipActive && (
          <TooltipWithBounds
            left={tooltipLeft}
            top={tooltipTop}
            offsetLeft={12}
            offsetTop={12}
            style={{
              position: 'absolute',
              backgroundColor: 'rgba(0,0,0,0.85)',
              color: 'white',
              padding: '4px 6px',
              borderRadius: '3px',
              fontSize: '10px',
              pointerEvents: 'none',
              lineHeight: '1.3',
            }}
          >
            <div style={{ marginBottom: '2px', fontWeight: 'bold', fontSize: '10px' }}>{formatTime(tooltipData.timeUs)}</div>
            {tooltipData.statusCounts.map(({ key, count }) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '1px' }}>
                <span style={{ display: 'inline-block', width: '6px', height: '6px', backgroundColor: getBucketColor(key), borderRadius: '1px' }} />
                <span style={{ fontSize: '9px' }}>{getBucketLabel(key)}: {count}</span>
              </div>
            ))}
            <div style={{ marginTop: '2px', paddingTop: '2px', borderTop: '1px solid #555', fontSize: '9px' }}>
              In-flight: {tooltipData.total}
            </div>
          </TooltipWithBounds>
        )}

        {/* Tooltip — external/mirrored cursor */}
        {!isSelecting && tooltipData && tooltipLeft !== undefined && tooltipTop !== undefined && isExternalTooltipActive && (
          <div
            style={{
              position: 'fixed',
              left: tooltipLeft + 12,
              top: tooltipTop,
              backgroundColor: 'rgba(0,0,0,0.85)',
              color: 'white',
              padding: '4px 6px',
              borderRadius: '3px',
              fontSize: '10px',
              pointerEvents: 'none',
              lineHeight: '1.3',
              zIndex: 1000,
            }}
          >
            <div style={{ marginBottom: '2px', fontWeight: 'bold', fontSize: '10px' }}>{formatTime(tooltipData.timeUs)}</div>
            {tooltipData.statusCounts.map(({ key, count }) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '1px' }}>
                <span style={{ display: 'inline-block', width: '6px', height: '6px', backgroundColor: getBucketColor(key), borderRadius: '1px' }} />
                <span style={{ fontSize: '9px' }}>{getBucketLabel(key)}: {count}</span>
              </div>
            ))}
            <div style={{ marginTop: '2px', paddingTop: '2px', borderTop: '1px solid #555', fontSize: '9px' }}>
              In-flight: {tooltipData.total}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
