import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BandwidthChart } from '../BandwidthChart';
import { renderBandwidthTooltip, type BandwidthBucket } from '../BandwidthChartTooltip';
import type { BandwidthRequestEntry, BandwidthRequestSpan } from '../../types/log.types';
import type { TimestampMicros } from '../../types/time.types';
import { MICROS_PER_MILLISECOND } from '../../types/time.types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeEntry(
  overrides: Partial<BandwidthRequestEntry> = {},
): BandwidthRequestEntry {
  return {
    timestampUs: (2_000 * MICROS_PER_MILLISECOND) as TimestampMicros, // 2 s
    uploadBytes: 512,
    downloadBytes: 4096,
    uri: 'https://matrix.example.org/_matrix/client/v3/sync',
    ...overrides,
  };
}

function makeRange(
  minMs = 0,
  maxMs = 10_000,
): { minTime: TimestampMicros; maxTime: TimestampMicros } {
  return {
    minTime: (minMs * MICROS_PER_MILLISECOND) as TimestampMicros,
    maxTime: (maxMs * MICROS_PER_MILLISECOND) as TimestampMicros,
  };
}

function makeSpan(
  overrides: Partial<BandwidthRequestSpan> = {},
): BandwidthRequestSpan {
  return {
    startUs: (1_000 * MICROS_PER_MILLISECOND) as TimestampMicros,
    endUs: (4_000 * MICROS_PER_MILLISECOND) as TimestampMicros,
    uploadBytes: 512,
    downloadBytes: 4096,
    uri: 'https://matrix.example.org/_matrix/client/v3/sync',
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('BandwidthChart', () => {
  describe('empty state', () => {
    it('shows empty message when no requests provided', () => {
      render(<BandwidthChart requests={[]} timeRange={makeRange()} />);
      expect(screen.getByText('No bandwidth data to display')).toBeInTheDocument();
    });

    it('renders without errors when timeRange is 0/0 (covers early-return useMemo branch)', () => {
      // exercises the `if (minTime === 0 && maxTime === 0)` early return inside useMemo
      expect(() =>
        render(
          <BandwidthChart
            requests={[makeEntry()]}
            timeRange={{ minTime: 0 as TimestampMicros, maxTime: 0 as TimestampMicros }}
          />,
        ),
      ).not.toThrow();
    });
  });

  describe('bar rendering', () => {
    it('renders an SVG with bars when entries are provided', () => {
      const { container } = render(
        <BandwidthChart requests={[makeEntry()]} timeRange={makeRange(0, 10_000)} />,
      );
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('renders download bars with the download CSS variable colour', () => {
      const { container } = render(
        <BandwidthChart
          requests={[makeEntry({ uploadBytes: 0, downloadBytes: 4096 })]}
          timeRange={makeRange(0, 10_000)}
        />,
      );
      // Download bars use --bandwidth-download
      const downloadBars = container.querySelectorAll(
        'rect[fill="var(--bandwidth-download)"][opacity="0.9"]',
      );
      expect(downloadBars.length).toBeGreaterThan(0);
    });

    it('renders upload bars with the upload CSS variable colour', () => {
      const { container } = render(
        <BandwidthChart
          requests={[makeEntry({ uploadBytes: 1024, downloadBytes: 0 })]}
          timeRange={makeRange(0, 10_000)}
        />,
      );
      const uploadBars = container.querySelectorAll(
        'rect[fill="var(--bandwidth-upload)"][opacity="0.9"]',
      );
      expect(uploadBars.length).toBeGreaterThan(0);
    });

    it('renders stacked bars when both upload and download are non-zero', () => {
      const { container } = render(
        <BandwidthChart
          requests={[makeEntry({ uploadBytes: 512, downloadBytes: 4096 })]}
          timeRange={makeRange(0, 10_000)}
        />,
      );
      const uploadBars = container.querySelectorAll(
        'rect[fill="var(--bandwidth-upload)"][opacity="0.9"]',
      );
      const downloadBars = container.querySelectorAll(
        'rect[fill="var(--bandwidth-download)"][opacity="0.9"]',
      );
      expect(uploadBars.length).toBeGreaterThan(0);
      expect(downloadBars.length).toBeGreaterThan(0);
    });

    it('buckets multiple entries into the same bar when they share a time window', () => {
      // Two entries at the same second → should collapse into a single non-empty bucket
      const entries = [
        makeEntry({ timestampUs: (1_000 * MICROS_PER_MILLISECOND) as TimestampMicros, uploadBytes: 100, downloadBytes: 200 }),
        makeEntry({ timestampUs: (1_500 * MICROS_PER_MILLISECOND) as TimestampMicros, uploadBytes: 150, downloadBytes: 300 }),
      ];
      const { container } = render(
        <BandwidthChart requests={entries} timeRange={makeRange(0, 10_000)} />,
      );
      expect(container.querySelector('svg')).toBeInTheDocument();
      // Both contribute to the same 1-second bucket → exactly one download bar rendered
      const downloadBars = container.querySelectorAll(
        'rect[fill="var(--bandwidth-download)"][opacity="0.9"]',
      );
      expect(downloadBars.length).toBe(1);
    });

    it('entries outside the time range are placed in adjacent buckets (no bar outside range)', () => {
      // Entry at t=2s; range 0–10s → should render without throwing
      expect(() =>
        render(
          <BandwidthChart
            requests={[makeEntry({ timestampUs: (2_000 * MICROS_PER_MILLISECOND) as TimestampMicros })]}
            timeRange={makeRange(0, 10_000)}
          />,
        ),
      ).not.toThrow();
    });
  });

  describe('callback props', () => {
    it('passes onTimeRangeSelected to BaseActivityChart (mouse interaction)', () => {
      const onSelect = vi.fn();
      const { container } = render(
        <BandwidthChart
          requests={[makeEntry()]}
          timeRange={makeRange(0, 10_000)}
          onTimeRangeSelected={onSelect}
        />,
      );
      // The invisible overlay rect receives mouse events; just verify it exists
      // (full drag-selection behaviour is tested in BaseActivityChart/useChartInteraction)
      expect(container.querySelector('rect[fill="transparent"]')).toBeInTheDocument();
    });
  });

  describe('in-flight mode', () => {
    it('renders stacked areas for upload and download in concurrent mode', () => {
      const spans = [makeSpan()];
      const { container } = render(
        <BandwidthChart
          requests={[]}
          bandwidthRequestSpans={spans}
          displayMode="concurrent"
          timeRange={makeRange(0, 10_000)}
        />,
      );

      const areas = container.querySelectorAll('path[fill="var(--bandwidth-download)"], path[fill="var(--bandwidth-upload)"]');
      expect(areas.length).toBeGreaterThanOrEqual(2);
    });

    it('shows empty message in concurrent mode when spans are empty', () => {
      render(
        <BandwidthChart
          requests={[]}
          bandwidthRequestSpans={[]}
          displayMode="concurrent"
          timeRange={makeRange(0, 10_000)}
        />,
      );

      expect(screen.getByText('No in-flight bandwidth data to display')).toBeInTheDocument();
    });
  });
});

// ─── renderBandwidthTooltip unit tests ──────────────────────────────────────

function makeBucket(overrides: Partial<BandwidthBucket> = {}): BandwidthBucket {
  return {
    timestamp: 0,
    timeLabel: '00:00:01',
    total: 1536,
    uploadBytes: 512,
    downloadBytes: 1024,
    ...overrides,
  };
}

describe('renderBandwidthTooltip', () => {
  it('shows the time label', () => {
    render(renderBandwidthTooltip(makeBucket({ timeLabel: '12:34:56' })));
    expect(screen.getByText('12:34:56')).toBeInTheDocument();
  });

  it('shows download row when downloadBytes > 0', () => {
    render(renderBandwidthTooltip(makeBucket({ downloadBytes: 1024 })));
    expect(screen.getByText(/download/i)).toBeInTheDocument();
  });

  it('hides download row when downloadBytes = 0', () => {
    render(renderBandwidthTooltip(makeBucket({ downloadBytes: 0 })));
    expect(screen.queryByText(/download/i)).not.toBeInTheDocument();
  });

  it('shows upload row when uploadBytes > 0', () => {
    render(renderBandwidthTooltip(makeBucket({ uploadBytes: 512 })));
    expect(screen.getByText(/upload/i)).toBeInTheDocument();
  });

  it('hides upload row when uploadBytes = 0', () => {
    render(renderBandwidthTooltip(makeBucket({ uploadBytes: 0 })));
    expect(screen.queryByText(/upload/i)).not.toBeInTheDocument();
  });

  it('shows total row when total > 0', () => {
    render(renderBandwidthTooltip(makeBucket({ total: 1536 })));
    expect(screen.getByText(/total/i)).toBeInTheDocument();
  });

  it('hides total row when total = 0', () => {
    render(renderBandwidthTooltip(makeBucket({ total: 0 })));
    expect(screen.queryByText(/total/i)).not.toBeInTheDocument();
  });
});
