import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { LifecycleMarkers } from '../LifecycleMarkers';
import type { LifecycleEvent } from '../../types/log.types';
import type { TimestampMicros } from '../../types/time.types';
import { MARKER_COLOR } from '../../utils/lifecycleEvents';

function ev(kind: LifecycleEvent['kind'], timestampUs: number): LifecycleEvent {
  return { kind, platform: 'ios', lineNumber: 1, timestampUs: timestampUs as TimestampMicros };
}

const timeToX = (us: number) => us / 1000; // simple linear mapping for tests

describe('LifecycleMarkers', () => {
  it('renders nothing when markers is undefined', () => {
    const { container } = render(
      <svg><LifecycleMarkers timeToX={timeToX} bottomY={100} /></svg>,
    );
    expect(container.querySelector('line')).toBeNull();
  });

  it('renders nothing when markers is empty', () => {
    const { container } = render(
      <svg><LifecycleMarkers markers={[]} timeToX={timeToX} bottomY={100} /></svg>,
    );
    expect(container.querySelector('line')).toBeNull();
  });

  it('renders nothing when all events are non-marker kinds (background, foreground)', () => {
    const markers = [ev('background', 1000), ev('foreground', 2000)];
    const { container } = render(
      <svg><LifecycleMarkers markers={markers} timeToX={timeToX} bottomY={100} /></svg>,
    );
    expect(container.querySelector('line')).toBeNull();
  });

  it('renders a line for each coldStart marker', () => {
    const markers = [ev('coldStart', 1000), ev('coldStart', 2000)];
    const { container } = render(
      <svg><LifecycleMarkers markers={markers} timeToX={timeToX} bottomY={100} /></svg>,
    );
    const lines = container.querySelectorAll('line');
    expect(lines).toHaveLength(2);
  });

  it('renders a line for each crash marker', () => {
    const markers = [ev('crash', 5000)];
    const { container } = render(
      <svg><LifecycleMarkers markers={markers} timeToX={timeToX} bottomY={200} /></svg>,
    );
    const lines = container.querySelectorAll('line');
    expect(lines).toHaveLength(1);
    // y extents
    expect(lines[0].getAttribute('y1')).toBe('0');
    expect(lines[0].getAttribute('y2')).toBe('200');
  });

  it('applies correct colors from MARKER_COLOR', () => {
    const markers = [ev('coldStart', 1000), ev('crash', 2000)];
    const { container } = render(
      <svg><LifecycleMarkers markers={markers} timeToX={timeToX} bottomY={100} /></svg>,
    );
    const lines = Array.from(container.querySelectorAll('line'));
    const strokes = lines.map((l) => l.getAttribute('stroke'));
    expect(strokes).toContain(MARKER_COLOR.coldStart);
    expect(strokes).toContain(MARKER_COLOR.crash);
  });

  it('maps timestamps to x coordinates via timeToX', () => {
    const markers = [ev('coldStart', 4000)];
    const { container } = render(
      <svg><LifecycleMarkers markers={markers} timeToX={timeToX} bottomY={100} /></svg>,
    );
    const line = container.querySelector('line')!;
    expect(line.getAttribute('x1')).toBe('4'); // 4000 / 1000
    expect(line.getAttribute('x2')).toBe('4');
  });

  it('filters out non-marker events mixed with marker events', () => {
    const markers = [
      ev('coldStart', 1000),
      ev('background', 1500),
      ev('crash', 2000),
      ev('foreground', 2500),
    ];
    const { container } = render(
      <svg><LifecycleMarkers markers={markers} timeToX={timeToX} bottomY={100} /></svg>,
    );
    // Only coldStart and crash are marker kinds
    expect(container.querySelectorAll('line')).toHaveLength(2);
  });
});
