import { useMemo, useCallback, useRef, useEffect, type ReactNode } from 'react';
import { AxisBottom, AxisLeft } from '@visx/axis';
import { Group } from '@visx/group';
import { scaleBand, scaleLinear } from '@visx/scale';
import { Bar, Line } from '@visx/shape';
import { useTooltip, TooltipWithBounds } from '@visx/tooltip';
import type { TimestampMicros } from '../types/time.types';
import { MICROS_PER_MILLISECOND } from '../types/time.types';
import { useChartInteraction } from '../hooks/useChartInteraction';
import type { SelectionRange } from '../hooks/useChartInteraction';

/** Generic bucket structure for activity charts */
export interface ActivityBucket {
  timestamp: number;
  timeLabel: string;
  total: number;
}

interface BaseActivityChartProps<TBucket extends ActivityBucket, TCategory extends string> {
  /** Buckets of time-aggregated data */
  buckets: TBucket[];
  /** Maximum count across all buckets (for y-axis scaling) */
  maxCount: number;
  /** Minimum time in microseconds */
  minTime: TimestampMicros;
  /** Maximum time in microseconds */
  maxTime: TimestampMicros;
  /** Ordered list of categories to render (determines stacking order) */
  categories: TCategory[];
  /** Get the color for a category */
  getCategoryColor: (category: TCategory) => string;
  /** Get the count for a category from a bucket */
  getCategoryCount: (bucket: TBucket, category: TCategory) => number;
  /** Render custom tooltip content */
  renderTooltipContent: (bucket: TBucket, categories: TCategory[]) => ReactNode;
  /** Callback when user selects a time range. Values are in microseconds. */
  onTimeRangeSelected?: (startUs: TimestampMicros, endUs: TimestampMicros) => void;
  /** Callback when user double-clicks to reset zoom */
  onResetZoom?: () => void;
  /** Empty state message */
  emptyMessage?: string;
  /** Chart height in pixels */
  height?: number;
  /** Optional formatter for y-axis tick labels. Defaults to visx's built-in number format.
   * Use this to display KB/MB/GB labels for byte-valued charts. */
  yAxisTickFormat?: (value: { valueOf(): number }) => string;
  /** Left margin in pixels. Increase when y-axis labels are wider than default (e.g. byte labels). Defaults to 50. */
  marginLeft?: number;
  /**
   * When provided, renders a mirrored crosshair at this time position so the
   * user can see where the cursor is on a sibling chart. Only shown when this
   * chart is not locally active (no local cursor and not selecting).
   */
  externalCursorTime?: number | null;
  /**
   * When provided, renders a mirrored selection band so the user can see the
   * drag selection happening on a sibling chart. Only shown when this chart is
   * not currently being used for a local selection.
   */
  externalSelection?: SelectionRange | null;
  /** Fired as the cursor moves across this chart (see `useChartInteraction`). */
  onCursorMove?: (timeUs: number | null) => void;
  /** Fired as a drag selection changes on this chart (see `useChartInteraction`). */
  onSelectionChange?: (selection: SelectionRange | null) => void;
}

/**
 * Base component for stacked bar activity charts.
 * Used by LogActivityChart and HttpActivityChart.
 */
export function BaseActivityChart<TBucket extends ActivityBucket, TCategory extends string>({
  buckets,
  maxCount,
  minTime,
  maxTime,
  categories,
  getCategoryColor,
  getCategoryCount,
  renderTooltipContent,
  onTimeRangeSelected,
  onResetZoom,
  emptyMessage = 'No data to display',
  height = 120,
  yAxisTickFormat,
  marginLeft = 50,
  externalCursorTime,
  externalSelection,
  onCursorMove,
  onSelectionChange,
}: BaseActivityChartProps<TBucket, TCategory>) {
  const { tooltipData, tooltipLeft, tooltipTop, showTooltip, hideTooltip } = useTooltip<TBucket>();
  const tooltipOffsetLeft = 12;
  const tooltipOffsetTop = 12;

  // Helper to format timestamp as HH:MM:SS in UTC (converts from microseconds)
  const formatTime = useCallback((timestampUs: number): string => {
    const date = new Date(timestampUs / MICROS_PER_MILLISECOND);
    return date.toISOString().split('T')[1].split('.')[0]; // Gets HH:MM:SS in UTC
  }, []);

  const width = 800;
  const margin = useMemo(() => ({ top: 10, right: 10, bottom: 30, left: marginLeft }), [marginLeft]);
  const xMax = width - margin.left - margin.right;
  const yMax = height - margin.top - margin.bottom;

  // Scales
  const xScale = useMemo(
    () =>
      scaleBand<string>({
        domain: buckets.map((d) => d.timeLabel),
        range: [0, xMax],
        padding: 0,
      }),
    [buckets, xMax]
  );

  const yScale = useMemo(
    () =>
      scaleLinear<number>({
        domain: [0, maxCount],
        range: [yMax, 0],
        nice: true,
      }),
    [maxCount, yMax]
  );

  const getBucketAtIndex = useCallback(
    (index: number): TBucket | undefined => buckets[index],
    [buckets]
  );

  const { state, handlers } = useChartInteraction<TBucket>({
    marginLeft: margin.left,
    xMax,
    minTime,
    maxTime,
    formatTime,
    hideTooltip,
    onTimeRangeSelected,
    onResetZoom,
    getBucketAtIndex,
    xScaleStep: xScale.step(),
    bucketCount: buckets.length,
    onCursorMove,
    onSelectionChange,
  });

  /** Convert a microsecond timestamp to an SVG x-coordinate within the chart area. */
  const timeToX = useCallback(
    (timeUs: number): number => {
      if (maxTime === minTime) return 0;
      return ((timeUs - minTime) / (maxTime - minTime)) * xMax;
    },
    [minTime, maxTime, xMax],
  );

  const svgRef = useRef<SVGSVGElement>(null);

  const { cursorX, cursorTimeLabel, isSelecting, selectionStart, selectionEnd } = state;
  const hasExternalSelection = externalSelection !== null && externalSelection !== undefined;
  const isExternalTooltipActive =
    !isSelecting &&
    cursorX === undefined &&
    !hasExternalSelection &&
    externalCursorTime !== null &&
    externalCursorTime !== undefined;

  /**
   * Returns the bucket whose time slot contains the given timestamp.
   * Used to look up data for the externally-provided cursor position so that
   * this chart can show its own tooltip while a sibling chart is being hovered.
   */
  const getBucketAtExternalTime = useCallback(
    (timeUs: number): TBucket | undefined => {
      if (buckets.length === 0) return undefined;
      const x = timeToX(timeUs);
      const index = Math.max(0, Math.min(buckets.length - 1, Math.floor(x / xScale.step())));
      return buckets[index];
    },
    [buckets, timeToX, xScale],
  );

  // When a sibling chart drives the cursor, show this chart's own tooltip at
  // the same time position so the user can compare data across all charts.
  useEffect(() => {
    if (
      externalCursorTime === null ||
      externalCursorTime === undefined ||
      hasExternalSelection ||
      isSelecting ||
      cursorX !== undefined
    ) {
      // Clear any external-cursor tooltip only when no local interaction is
      // keeping the tooltip open (local hover or selection).
      if (cursorX === undefined && !isSelecting) {
        hideTooltip();
      }
      return;
    }

    const svg = svgRef.current;
    if (!svg) return;

    const bucket = getBucketAtExternalTime(externalCursorTime);
    if (!bucket) return;

    // Convert the chart-space coordinate to viewport coordinates using the
    // SVG's actual screen transform. This matches the browser's rendering even
    // when the viewBox is letterboxed or otherwise not scaled by svgRect.width.
    const viewBoxX = timeToX(externalCursorTime) + margin.left;
    const ctm = typeof svg.getScreenCTM === 'function' ? svg.getScreenCTM() : null;
    let tooltipScreenX: number | null = null;
    let tooltipScreenY: number | null = null;

    if (ctm && typeof svg.createSVGPoint === 'function') {
      const svgPoint = svg.createSVGPoint();
      svgPoint.x = viewBoxX;
      svgPoint.y = 0;
      const transformedPoint = svgPoint.matrixTransform(ctm);
      tooltipScreenX = transformedPoint.x;
      tooltipScreenY = transformedPoint.y;
    }

    // Fallback for environments where getScreenCTM is unavailable.
    if (tooltipScreenX === null || tooltipScreenY === null) {
      const svgRect = svg.getBoundingClientRect();
      const scale = svgRect.width / width;
      tooltipScreenX = svgRect.left + viewBoxX * scale;
      tooltipScreenY = svgRect.top;
    }

    showTooltip({
      tooltipData: bucket,
      tooltipLeft: tooltipScreenX,
      tooltipTop: tooltipScreenY,
    });
  }, [externalCursorTime, hasExternalSelection, isSelecting, cursorX, getBucketAtExternalTime, timeToX, margin, width, showTooltip, hideTooltip]);

  if (buckets.length === 0) {
    return (
      <div className="chart-empty" style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <svg ref={svgRef} width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>
          <Group left={margin.left} top={margin.top}>
            {/* Render stacked bars */}
            {buckets.map((bucket) => {
              const barX = xScale(bucket.timeLabel) ?? 0;
              const barWidth = xScale.bandwidth();
              let currentY = yMax;

              return (
                <Group key={bucket.timestamp}>
                  {categories.map((category) => {
                    const count = getCategoryCount(bucket, category);
                    if (count === 0) return null;

                    const barHeight = yMax - yScale(count);
                    const barY = currentY - barHeight;

                    const bar = (
                      <Bar
                        key={category}
                        x={barX}
                        y={barY}
                        width={barWidth}
                        height={barHeight}
                        fill={getCategoryColor(category)}
                        opacity={0.9}
                      >
                        <title>{`${bucket.timeLabel} - ${category}: ${count}`}</title>
                      </Bar>
                    );

                    currentY = barY;
                    return bar;
                  })}
                </Group>
              );
            })}

            {/* Invisible overlay for mouse events - must be after bars to be on top */}
            <rect
              width={xMax}
              height={yMax}
              fill="transparent"
              onMouseDown={handlers.handleMouseDown}
              onMouseUp={handlers.handleMouseUp}
              onMouseMove={(e) => handlers.handleMouseMove(e, showTooltip)}
              onDoubleClick={handlers.handleDoubleClick}
              onMouseLeave={handlers.handleMouseLeave}
              style={{ cursor: isSelecting ? 'col-resize' : 'crosshair' }}
            />

            {/* Axes */}
            <AxisBottom
              top={yMax}
              scale={xScale}
              tickFormat={() => ''} // Hide automatic ticks
              stroke="#666"
              tickStroke="#666"
              tickLabelProps={() => ({
                fill: '#666',
                fontSize: 9,
                textAnchor: 'middle',
              })}
            />

            {/* Manual start and end time labels - use actual min/max times from data */}
            {buckets.length > 0 && (
              <>
                {/* Start time label - actual minimum time */}
                <text
                  x={xScale(buckets[0].timeLabel) ?? 0}
                  y={yMax + 16}
                  textAnchor="start"
                  fontSize={9}
                  fill="#666"
                  pointerEvents="none"
                >
                  {formatTime(minTime)}
                </text>
                {/* End time label - actual maximum time */}
                <text
                  x={(xScale(buckets[buckets.length - 1].timeLabel) ?? 0) + (xScale.bandwidth() ?? 0)}
                  y={yMax + 16}
                  textAnchor="end"
                  fontSize={9}
                  fill="#666"
                  pointerEvents="none"
                >
                  {formatTime(maxTime)}
                </text>
              </>
            )}
            <AxisLeft
              scale={yScale}
              stroke="#666"
              tickStroke="#666"
              numTicks={4}
              tickFormat={yAxisTickFormat}
              tickLabelProps={() => ({
                fill: '#666',
                fontSize: 10,
                textAnchor: 'end',
                dx: -4,
              })}
            />

            {/* Selection mode: two cursors and highlighted area */}
            {isSelecting && selectionStart && selectionEnd && (
              <>
                {/* Highlighted selection area */}
                <rect
                  x={Math.min(selectionStart.x, selectionEnd.x) - margin.left}
                  y={0}
                  width={Math.abs(selectionEnd.x - selectionStart.x)}
                  height={yMax}
                  fill="rgba(33, 150, 243, 0.2)"
                  pointerEvents="none"
                />
                {/* Start cursor */}
                <Line
                  from={{ x: selectionStart.x - margin.left, y: 0 }}
                  to={{ x: selectionStart.x - margin.left, y: yMax }}
                  stroke="#2196f3"
                  strokeWidth={2}
                  pointerEvents="none"
                />
                {/* End cursor */}
                <Line
                  from={{ x: selectionEnd.x - margin.left, y: 0 }}
                  to={{ x: selectionEnd.x - margin.left, y: yMax }}
                  stroke="#2196f3"
                  strokeWidth={2}
                  pointerEvents="none"
                />
                {/* Time labels */}
                <text
                  x={selectionStart.x - margin.left}
                  y={yMax + 20}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#2196f3"
                  fontWeight="bold"
                  pointerEvents="none"
                >
                  {formatTime(selectionStart.time)}
                </text>
                <text
                  x={selectionEnd.x - margin.left}
                  y={yMax + 20}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#2196f3"
                  fontWeight="bold"
                  pointerEvents="none"
                >
                  {formatTime(selectionEnd.time)}
                </text>
              </>
            )}

            {/* Normal mode: single cursor line and tooltip */}
            {!isSelecting && tooltipData && cursorX !== undefined && (
              <>
                <Line
                  from={{ x: cursorX - margin.left, y: 0 }}
                  to={{ x: cursorX - margin.left, y: yMax }}
                  stroke="#666"
                  strokeWidth={1}
                  pointerEvents="none"
                  strokeDasharray="4,2"
                />
                {/* Time label on x-axis */}
                <text
                  x={cursorX - margin.left}
                  y={yMax + 20}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#333"
                  fontWeight="bold"
                  pointerEvents="none"
                >
                  {cursorTimeLabel}
                </text>
              </>
            )}

            {/* External cursor: mirrored crosshair from a sibling chart */}
            {!isSelecting && cursorX === undefined && externalCursorTime !== null && externalCursorTime !== undefined && (
              <>
                <Line
                  from={{ x: timeToX(externalCursorTime), y: 0 }}
                  to={{ x: timeToX(externalCursorTime), y: yMax }}
                  stroke="#666"
                  strokeWidth={1}
                  pointerEvents="none"
                  strokeDasharray="4,2"
                />
                <text
                  x={timeToX(externalCursorTime)}
                  y={yMax + 20}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#333"
                  fontWeight="bold"
                  pointerEvents="none"
                >
                  {formatTime(externalCursorTime)}
                </text>
              </>
            )}

            {/* External selection: mirrored selection band from a sibling chart */}
            {!isSelecting && externalSelection !== null && externalSelection !== undefined && (
              <>
                <rect
                  x={timeToX(externalSelection.startUs)}
                  y={0}
                  width={timeToX(externalSelection.endUs) - timeToX(externalSelection.startUs)}
                  height={yMax}
                  fill="rgba(33, 150, 243, 0.2)"
                  pointerEvents="none"
                />
                <Line
                  from={{ x: timeToX(externalSelection.startUs), y: 0 }}
                  to={{ x: timeToX(externalSelection.startUs), y: yMax }}
                  stroke="#2196f3"
                  strokeWidth={2}
                  pointerEvents="none"
                />
                <Line
                  from={{ x: timeToX(externalSelection.endUs), y: 0 }}
                  to={{ x: timeToX(externalSelection.endUs), y: yMax }}
                  stroke="#2196f3"
                  strokeWidth={2}
                  pointerEvents="none"
                />
                <text
                  x={timeToX(externalSelection.startUs)}
                  y={yMax + 20}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#2196f3"
                  fontWeight="bold"
                  pointerEvents="none"
                >
                  {formatTime(externalSelection.startUs)}
                </text>
                <text
                  x={timeToX(externalSelection.endUs)}
                  y={yMax + 20}
                  textAnchor="middle"
                  fontSize={10}
                  fill="#2196f3"
                  fontWeight="bold"
                  pointerEvents="none"
                >
                  {formatTime(externalSelection.endUs)}
                </text>
              </>
            )}
          </Group>
        </svg>

        {/* Tooltip - local hover uses bounds-aware positioning, mirrored tooltip is pinned to chart top */}
        {!isSelecting && tooltipData && tooltipLeft !== undefined && tooltipTop !== undefined && !isExternalTooltipActive && (
          <TooltipWithBounds
            left={tooltipLeft}
            top={tooltipTop}
            offsetLeft={tooltipOffsetLeft}
            offsetTop={tooltipOffsetTop}
            style={{
              position: 'absolute',
              backgroundColor: 'rgba(0, 0, 0, 0.85)',
              color: 'white',
              padding: '4px 6px',
              borderRadius: '3px',
              fontSize: '10px',
              pointerEvents: 'none',
              lineHeight: '1.3',
            }}
          >
            {renderTooltipContent(tooltipData, categories)}
          </TooltipWithBounds>
        )}
        {!isSelecting && tooltipData && tooltipLeft !== undefined && tooltipTop !== undefined && isExternalTooltipActive && (
          <div
            style={{
              position: 'fixed',
              left: tooltipLeft + tooltipOffsetLeft,
              top: tooltipTop,
              backgroundColor: 'rgba(0, 0, 0, 0.85)',
              color: 'white',
              padding: '4px 6px',
              borderRadius: '3px',
              fontSize: '10px',
              pointerEvents: 'none',
              lineHeight: '1.3',
              zIndex: 1000,
            }}
          >
            {renderTooltipContent(tooltipData, categories)}
          </div>
        )}
      </div>
    </div>
  );
}
