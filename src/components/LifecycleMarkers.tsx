import { Group } from '@visx/group';
import type { LifecycleEvent } from '../types/log.types';
import { MARKER_COLOR, isMarkerKind } from '../utils/lifecycleEvents';

interface LifecycleMarkersProps {
  /** Lifecycle events to mark, already time-filtered to the chart window. */
  readonly markers?: readonly LifecycleEvent[];
  /** Maps an event timestamp (µs) to an x-coordinate within the chart area. */
  readonly timeToX: (timeUs: number) => number;
  /** Bottom y-coordinate the marker line extends to (chart-area height). */
  readonly bottomY: number;
}

/**
 * Vertical markers drawn at the point-in-time lifecycle signals — coldStart and
 * crash only (background/foreground/refresh are durations shown as the app-state
 * band instead). Colours come from the shared `MARKER_COLOR` tokens (theme-aware).
 *
 * Solid (chart cursors are dashed) and `pointerEvents="none"` so they never
 * block the chart's drag-select overlay.
 *
 * @example
 * <LifecycleMarkers markers={stats.lifecycleEvents} timeToX={timeToX} bottomY={axisTop} />
 */
export function LifecycleMarkers({ markers, timeToX, bottomY }: LifecycleMarkersProps) {
  const lines = markers?.filter((e) => isMarkerKind(e.kind)) ?? [];
  if (lines.length === 0) return null;
  return (
    <Group>
      {lines.map((event) => {
        if (!isMarkerKind(event.kind)) return null; // narrows kind for MARKER_COLOR
        const x = timeToX(event.timestampUs);
        return (
          <line
            key={`${event.lineNumber}-${event.kind}`}
            x1={x}
            y1={0}
            x2={x}
            y2={bottomY}
            stroke={MARKER_COLOR[event.kind]}
            strokeWidth={1.5}
            pointerEvents="none"
          />
        );
      })}
    </Group>
  );
}
