import { useMemo, useCallback, useRef, useEffect, useState, type MouseEvent } from 'react';
import { Group } from '@visx/group';
import { Area, Line } from '@visx/shape';
import { scaleLinear } from '@visx/scale';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { useTooltip, TooltipWithBounds } from '@visx/tooltip';
import { localPoint } from '@visx/event';
import { curveStepAfter } from 'd3-shape';
import type { BandwidthRequestSpan } from '../types/log.types';
import type { TimestampMicros } from '../types/time.types';
import { MICROS_PER_MILLISECOND } from '../types/time.types';
import type { SelectionRange } from '../hooks/useChartInteraction';
import { xToTime, snapToEdge } from '../utils/chartUtils';
import { formatBytes } from '../utils/sizeUtils';

interface BandwidthConcurrencyChartProps {
  /** Per-request time spans, each with precise start/end timestamps and byte counts. */
  bandwidthRequestSpans: readonly BandwidthRequestSpan[];
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

interface StepPoint {
  readonly timeUs: number;
  readonly value: number;
}

interface LayerPoint {
  readonly timeUs: number;
  readonly y0: number;
  readonly y1: number;
}

interface TooltipData {
  readonly timeUs: number;
  readonly downloadBytes: number;
  readonly uploadBytes: number;
}

interface SelectionPoint {
  readonly x: number;
  readonly time: number;
}

const SVG_WIDTH = 800;
const MARGIN = { top: 10, right: 10, bottom: 30, left: 60 };
const UPLOAD_COLOR = 'var(--bandwidth-upload)';
const DOWNLOAD_COLOR = 'var(--bandwidth-download)';

function getValueAtTime(points: readonly StepPoint[], timeUs: number): number {
  if (points.length === 0) return 0;
  if (timeUs < points[0].timeUs) return 0;

  const lastIndex = points.length - 1;
  if (timeUs >= points[lastIndex].timeUs) return points[lastIndex].value;

  // Binary search for the last point with timeUs <= target.
  let lo = 0;
  let hi = lastIndex;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].timeUs === timeUs) return points[mid].value;
    if (points[mid].timeUs < timeUs) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi >= 0 ? points[hi].value : 0;
}

function computeStepSeries(
  spans: readonly BandwidthRequestSpan[],
  minTime: TimestampMicros,
  maxTime: TimestampMicros,
  pickBytes: (span: BandwidthRequestSpan) => number,
): StepPoint[] {
  const deltas = new Map<number, number>();
  const addDelta = (t: number, d: number): void => {
    deltas.set(t, (deltas.get(t) ?? 0) + d);
  };

  for (const span of spans) {
    const bytes = pickBytes(span);
    if (bytes <= 0) continue;

    const startUs = Math.max(minTime, span.startUs);
    const endUs = Math.min(maxTime, span.endUs ?? maxTime);
    if (endUs < startUs) continue;

    addDelta(startUs, bytes);
    addDelta(endUs, -bytes);
  }

  const sortedTimes = Array.from(deltas.keys()).sort((a, b) => a - b);
  const points: StepPoint[] = [{ timeUs: minTime, value: 0 }];
  let running = 0;

  for (const t of sortedTimes) {
    if (t > minTime) points.push({ timeUs: t, value: running });
    running += deltas.get(t) ?? 0;
    points.push({ timeUs: t, value: Math.max(0, running) });
  }

  if (points[points.length - 1]?.timeUs !== maxTime) {
    points.push({ timeUs: maxTime, value: Math.max(0, running) });
  }

  return points.sort((a, b) => a.timeUs - b.timeUs);
}

/**
 * Step-function area chart for the "Show in-flight" concurrent mode on the /summary screen.
 *
 * Unlike the bar histogram, this chart uses the precise `startUs`/`endUs` timestamps
 * from `BandwidthRequestSpan` to compute an exact in-flight waveform — no bucketing
 * approximation.  Download and upload bytes are tracked independently in separate event
 * sweeps, then stacked (download below, upload above) for rendering.
 *
 * Interaction model mirrors `HttpConcurrencyChart`: drag-to-zoom, cursor sync, and
 * external selection mirroring are all supported via the same prop surface.
 */
export function BandwidthConcurrencyChart({
  bandwidthRequestSpans,
  timeRange,
  onTimeRangeSelected,
  onResetZoom,
  externalCursorTime,
  externalSelection,
  onCursorMove,
  onSelectionChange,
  height = 120,
}: BandwidthConcurrencyChartProps) {
  const { minTime, maxTime } = timeRange;
  const xMax = SVG_WIDTH - MARGIN.left - MARGIN.right;
  const yMax = height - MARGIN.top - MARGIN.bottom;

  const uploadSeries = useMemo(
    () => computeStepSeries(bandwidthRequestSpans, minTime, maxTime, (s) => s.uploadBytes),
    [bandwidthRequestSpans, minTime, maxTime],
  );
  const downloadSeries = useMemo(
    () => computeStepSeries(bandwidthRequestSpans, minTime, maxTime, (s) => s.downloadBytes),
    [bandwidthRequestSpans, minTime, maxTime],
  );

  const layers = useMemo(() => {
    const allTimes = new Set<number>([minTime, maxTime]);
    for (const p of uploadSeries) allTimes.add(p.timeUs);
    for (const p of downloadSeries) allTimes.add(p.timeUs);
    const sortedTimes = Array.from(allTimes).sort((a, b) => a - b);

    const downloadLayer: LayerPoint[] = [];
    const uploadLayer: LayerPoint[] = [];
    for (const t of sortedTimes) {
      const download = getValueAtTime(downloadSeries, t);
      const upload = getValueAtTime(uploadSeries, t);
      downloadLayer.push({ timeUs: t, y0: 0, y1: download });
      uploadLayer.push({ timeUs: t, y0: download, y1: download + upload });
    }
    return { downloadLayer, uploadLayer };
  }, [uploadSeries, downloadSeries, minTime, maxTime]);

  const maxBytes = useMemo(
    () => Math.max(...layers.uploadLayer.map((p) => p.y1), 1),
    [layers],
  );

  const hasData = useMemo(
    () => bandwidthRequestSpans.some((s) => s.uploadBytes > 0 || s.downloadBytes > 0),
    [bandwidthRequestSpans],
  );

  const xScale = useMemo(
    () => scaleLinear<number>({ domain: [minTime, maxTime], range: [0, xMax], clamp: true }),
    [minTime, maxTime, xMax],
  );
  const yScale = useMemo(
    () => scaleLinear<number>({ domain: [0, maxBytes], range: [yMax, 0], nice: true }),
    [maxBytes, yMax],
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
      const download = getValueAtTime(downloadSeries, timeUs);
      const upload = getValueAtTime(uploadSeries, timeUs);
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
        tooltipData: { timeUs, downloadBytes: download, uploadBytes: upload },
        tooltipLeft: tooltipScreenX,
        tooltipTop: tooltipScreenY,
      });
    },
    [xMax, minTime, maxTime, downloadSeries, uploadSeries, showTooltip],
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
  if (!hasData) {
    return (
      <div className="chart-empty" style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
        No in-flight bandwidth data to display
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
            <Area<LayerPoint>
              data={layers.downloadLayer}
              x={(d) => xScale(d.timeUs)}
              y0={(d) => yScale(d.y0)}
              y1={(d) => yScale(d.y1)}
              curve={curveStepAfter}
              fill={DOWNLOAD_COLOR}
              fillOpacity={0.7}
            />
            <Area<LayerPoint>
              data={layers.uploadLayer}
              x={(d) => xScale(d.timeUs)}
              y0={(d) => yScale(d.y0)}
              y1={(d) => yScale(d.y1)}
              curve={curveStepAfter}
              fill={UPLOAD_COLOR}
              fillOpacity={0.7}
            />

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
              tickFormat={(value) => formatBytes(value.valueOf())}
              tickLabelProps={() => ({ fill: '#666', fontSize: 10, textAnchor: 'end', dx: -4 })}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '1px' }}>
              <span style={{ display: 'inline-block', width: '6px', height: '6px', backgroundColor: DOWNLOAD_COLOR, borderRadius: '1px' }} />
              <span style={{ fontSize: '9px' }}>Download: {formatBytes(tooltipData.downloadBytes)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '1px' }}>
              <span style={{ display: 'inline-block', width: '6px', height: '6px', backgroundColor: UPLOAD_COLOR, borderRadius: '1px' }} />
              <span style={{ fontSize: '9px' }}>Upload: {formatBytes(tooltipData.uploadBytes)}</span>
            </div>
            <div style={{ marginTop: '2px', paddingTop: '2px', borderTop: '1px solid #555', fontSize: '9px' }}>
              In-flight: {formatBytes(tooltipData.downloadBytes + tooltipData.uploadBytes)}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '1px' }}>
              <span style={{ display: 'inline-block', width: '6px', height: '6px', backgroundColor: DOWNLOAD_COLOR, borderRadius: '1px' }} />
              <span style={{ fontSize: '9px' }}>Download: {formatBytes(tooltipData.downloadBytes)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '1px' }}>
              <span style={{ display: 'inline-block', width: '6px', height: '6px', backgroundColor: UPLOAD_COLOR, borderRadius: '1px' }} />
              <span style={{ fontSize: '9px' }}>Upload: {formatBytes(tooltipData.uploadBytes)}</span>
            </div>
            <div style={{ marginTop: '2px', paddingTop: '2px', borderTop: '1px solid #555', fontSize: '9px' }}>
              In-flight: {formatBytes(tooltipData.downloadBytes + tooltipData.uploadBytes)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
