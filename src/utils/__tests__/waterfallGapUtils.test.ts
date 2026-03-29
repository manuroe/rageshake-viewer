import { describe, it, expect } from 'vitest';
import {
  IDLE_GAP_THRESHOLD_MS,
  COLLAPSED_GAP_PX,
  buildCompressedTimeline,
  buildLinearTimeline,
  formatGapDuration,
} from '../waterfallGapUtils';

// ---------------------------------------------------------------------------
// buildCompressedTimeline
// ---------------------------------------------------------------------------

describe('buildCompressedTimeline', () => {
  describe('no idle gaps', () => {
    it('produces only active segments when gaps are below the threshold', () => {
      // Two requests separated by 100ms – well below the 5s threshold.
      const timeData = [
        { startTime: 1_000, endTime: 1_500 },
        { startTime: 1_600, endTime: 2_000 },
      ];
      const timeline = buildCompressedTimeline(timeData, 1_000, 2_000, 10);

      const gapSegs = timeline.segments.filter(s => s.type === 'gap');
      expect(gapSegs).toHaveLength(0);
    });

    it('total pixel width equals the sum of active durations / msPerPixel (no collapsed gaps)', () => {
      // totalActiveDuration = 1000ms (all segments active) → 100px at 10ms/px
      const timeData = [
        { startTime: 1_000, endTime: 2_000 },
      ];
      const timeline = buildCompressedTimeline(timeData, 1_000, 2_000, 10);

      expect(timeline.totalWidthPx).toBe(100);
    });
  });

  describe('single gap above threshold', () => {
    // Two bursts separated by a 59.5s gap.
    // Segments: active(500ms=50px), gap(59500ms=28px), active(500ms=50px)
    const timeData = [
      { startTime: 1_000, endTime: 1_500 },
      { startTime: 61_000, endTime: 61_500 },
    ];
    const timeline = buildCompressedTimeline(timeData, 1_000, 61_500, 10);

    it('inserts exactly one gap segment', () => {
      expect(timeline.segments.filter(s => s.type === 'gap')).toHaveLength(1);
    });

    it('gap segment has the right duration and fixed pixel width', () => {
      const gap = timeline.segments.find(s => s.type === 'gap')!;
      expect(gap.durationMs).toBe(59_500);
      expect(gap.widthPx).toBe(COLLAPSED_GAP_PX);
    });

    it('active segments have the expected width', () => {
      const actives = timeline.segments.filter(s => s.type === 'active');
      // Each burst is 500ms at 10ms/px = 50px
      for (const seg of actives) {
        expect(seg.widthPx).toBe(50);
      }
    });

    it('totalWidthPx is sum of segment widths', () => {
      const sum = timeline.segments.reduce((acc, s) => acc + s.widthPx, 0);
      expect(timeline.totalWidthPx).toBe(sum);
      // 50 + 28 + 50 = 128
      expect(timeline.totalWidthPx).toBe(128);
    });

    it('segments have correct startPx / endPx chain', () => {
      for (let i = 0; i < timeline.segments.length; i++) {
        const seg = timeline.segments[i];
        expect(seg.endPx).toBeCloseTo(seg.startPx + seg.widthPx, 5);
        if (i > 0) {
          expect(seg.startPx).toBeCloseTo(timeline.segments[i - 1].endPx, 5);
        }
      }
    });
  });

  describe('gap exactly at the threshold', () => {
    it('does NOT collapse a gap equal to the threshold', () => {
      // Gap of exactly IDLE_GAP_THRESHOLD_MS (5000ms) is not > threshold, so stays active.
      const timeData = [
        { startTime: 1_000, endTime: 1_500 },
        { startTime: 1_500 + IDLE_GAP_THRESHOLD_MS, endTime: 7_000 },
      ];
      const timeline = buildCompressedTimeline(timeData, 1_000, 7_000, 10);

      expect(timeline.segments.filter(s => s.type === 'gap')).toHaveLength(0);
    });

    it('collapses a gap one ms above the threshold', () => {
      const timeData = [
        { startTime: 1_000, endTime: 1_500 },
        { startTime: 1_500 + IDLE_GAP_THRESHOLD_MS + 1, endTime: 7_001 },
      ];
      const timeline = buildCompressedTimeline(timeData, 1_000, 7_001, 10);

      expect(timeline.segments.filter(s => s.type === 'gap')).toHaveLength(1);
    });
  });

  describe('overlapping requests (windows get merged)', () => {
    it('produces no gap when requests overlap', () => {
      const timeData = [
        { startTime: 1_000, endTime: 3_000 },
        { startTime: 2_000, endTime: 4_000 }, // overlaps the first
      ];
      const timeline = buildCompressedTimeline(timeData, 1_000, 4_000, 10);

      expect(timeline.segments.filter(s => s.type === 'gap')).toHaveLength(0);
    });

    it('total width equals merged duration / msPerPixel', () => {
      // Merged: 1000→4000 = 3000ms → 300px at 10ms/px
      const timeData = [
        { startTime: 1_000, endTime: 3_000 },
        { startTime: 2_000, endTime: 4_000 },
      ];
      const timeline = buildCompressedTimeline(timeData, 1_000, 4_000, 10);

      expect(timeline.totalWidthPx).toBe(300);
    });
  });

  describe('zero-timestamp entries are ignored', () => {
    it('filters out entries with startTime = 0', () => {
      // The zero entry should not create a false window at t=0.
      const timeData = [
        { startTime: 0, endTime: 0 },       // invalid / missing timestamp
        { startTime: 1_000, endTime: 1_500 },
        { startTime: 61_000, endTime: 61_500 },
      ];
      const timeline = buildCompressedTimeline(timeData, 1_000, 61_500, 10);

      // Should still collapse the large gap between the two valid requests.
      expect(timeline.segments.filter(s => s.type === 'gap')).toHaveLength(1);
    });
  });

  describe('timeToPixel', () => {
    const timeData = [
      { startTime: 1_000, endTime: 1_500 },
      { startTime: 61_000, endTime: 61_500 },
    ];
    const timeline = buildCompressedTimeline(timeData, 1_000, 61_500, 10);

    it('maps minTime to pixel 0', () => {
      expect(timeline.timeToPixel(1_000)).toBe(0);
    });

    it('maps end of first active segment correctly (500ms / 10 = 50px)', () => {
      expect(timeline.timeToPixel(1_500)).toBeCloseTo(50, 5);
    });

    it('maps start of second active segment to after the gap', () => {
      // 50px (active) + 28px (gap) = 78px
      expect(timeline.timeToPixel(61_000)).toBeCloseTo(78, 5);
    });

    it('maps maxTime to totalWidthPx', () => {
      expect(timeline.timeToPixel(61_500)).toBeCloseTo(timeline.totalWidthPx, 5);
    });

    it('clamps times before minTime to 0', () => {
      expect(timeline.timeToPixel(0)).toBe(0);
      expect(timeline.timeToPixel(-1_000)).toBe(0);
    });

    it('clamps times past maxTime to totalWidthPx', () => {
      expect(timeline.timeToPixel(999_999)).toBe(timeline.totalWidthPx);
    });
  });

  describe('durationToPixels', () => {
    const timeData = [
      { startTime: 1_000, endTime: 1_500 },
      { startTime: 61_000, endTime: 61_500 },
    ];
    const timeline = buildCompressedTimeline(timeData, 1_000, 61_500, 10);

    it('returns duration / msPerPixel for requests in active segments', () => {
      // 500ms / 10 = 50px
      expect(timeline.durationToPixels(1_000, 1_500)).toBe(50);
      expect(timeline.durationToPixels(61_000, 61_500)).toBe(50);
    });

    it('enforces a 1px minimum for very short durations', () => {
      // 5ms / 10 = 0.5 → clamped to 1
      expect(timeline.durationToPixels(1_000, 1_005)).toBe(1);
    });
  });

  describe('custom threshold', () => {
    it('respects a caller-supplied thresholdMs', () => {
      const timeData = [
        { startTime: 1_000, endTime: 1_500 },
        { startTime: 4_000, endTime: 4_500 }, // 2.5s gap
      ];
      // Default threshold (5s) would not collapse; custom (1s) should.
      const defaultTimeline = buildCompressedTimeline(timeData, 1_000, 4_500, 10);
      const customTimeline = buildCompressedTimeline(timeData, 1_000, 4_500, 10, 1_000);

      expect(defaultTimeline.segments.filter(s => s.type === 'gap')).toHaveLength(0);
      expect(customTimeline.segments.filter(s => s.type === 'gap')).toHaveLength(1);
    });
  });
});

// ---------------------------------------------------------------------------
// buildLinearTimeline
// ---------------------------------------------------------------------------

describe('buildLinearTimeline', () => {
  const timeline = buildLinearTimeline(1_000, 5_000, 500, 10);

  it('returns a single active segment spanning the full range', () => {
    expect(timeline.segments).toHaveLength(1);
    expect(timeline.segments[0].type).toBe('active');
    expect(timeline.segments[0].durationMs).toBe(5_000);
  });

  it('totalWidthPx equals the supplied timelineWidth', () => {
    expect(timeline.totalWidthPx).toBe(500);
  });

  it('timeToPixel(minTime) returns 0', () => {
    expect(timeline.timeToPixel(1_000)).toBe(0);
  });

  it('timeToPixel(minTime + totalDuration) returns timelineWidth', () => {
    // (5000/5000)*500 = 500; dynamicMin = 5000/10 = 500 → same
    expect(timeline.timeToPixel(6_000)).toBe(500);
  });

  it('timeToPixel interpolates correctly', () => {
    // midpoint: (2500/5000)*500 = 250
    expect(timeline.timeToPixel(3_500)).toBe(250);
  });

  it('durationToPixels returns proportional width', () => {
    // (500/5000)*500 = 50; dynamicMin = 500/10 = 50 → 50
    expect(timeline.durationToPixels(1_000, 1_500)).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// formatGapDuration
// ---------------------------------------------------------------------------

describe('formatGapDuration', () => {
  it('formats hours without remainder minutes', () => {
    expect(formatGapDuration(3_600_000)).toBe('1h');
    expect(formatGapDuration(7_200_000)).toBe('2h');
  });

  it('formats hours with remainder minutes', () => {
    expect(formatGapDuration(5_400_000)).toBe('1h 30m');
    expect(formatGapDuration(3_660_000)).toBe('1h 1m');
  });

  it('formats minutes without remainder seconds', () => {
    expect(formatGapDuration(60_000)).toBe('1m');
    expect(formatGapDuration(120_000)).toBe('2m');
  });

  it('formats minutes with remainder seconds', () => {
    expect(formatGapDuration(90_000)).toBe('1m 30s');
    expect(formatGapDuration(65_000)).toBe('1m 5s');
  });

  it('formats seconds to one decimal place', () => {
    expect(formatGapDuration(5_200)).toBe('5.2s');
    expect(formatGapDuration(10_000)).toBe('10.0s');
    expect(formatGapDuration(1_000)).toBe('1.0s');
  });

  it('formats sub-second durations in ms', () => {
    expect(formatGapDuration(800)).toBe('800ms');
    expect(formatGapDuration(0)).toBe('0ms');
  });
});
