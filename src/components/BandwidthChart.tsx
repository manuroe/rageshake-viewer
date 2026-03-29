import { useMemo, useCallback } from 'react';
import type { TimestampMicros } from '../types/time.types';
import { MICROS_PER_SECOND, MICROS_PER_MILLISECOND } from '../types/time.types';
import { BaseActivityChart } from './BaseActivityChart';
import { formatBytes } from '../utils/sizeUtils';
import type { BandwidthRequestEntry } from '../types/log.types';
import { renderBandwidthTooltip, type BandwidthBucket } from './BandwidthChartTooltip';

/**
 * Upload category key for the bandwidth stacked bar chart.
 * Rendered on top of the download bar so the upward direction is visually
 * associated with "sending" data.
 */
const UPLOAD_KEY = 'upload' as const;

/**
 * Download category key for the bandwidth stacked bar chart.
 * Rendered at the bottom of each bar — downloads are typically dominant and
 * placing them at the base keeps the chart stable.
 */
const DOWNLOAD_KEY = 'download' as const;

type BandwidthCategory = typeof UPLOAD_KEY | typeof DOWNLOAD_KEY;

/** Blue — consistent with the "outgoing/send" direction convention. */
const UPLOAD_COLOR = 'var(--bandwidth-upload)';

/** Orange — distinct from the upload blue and from HTTP status greens/reds. */
const DOWNLOAD_COLOR = 'var(--bandwidth-download)';

/**
 * Stacking order: download at bottom (largest contributor, visual anchor),
 * upload on top.
 */
const CATEGORIES: BandwidthCategory[] = [DOWNLOAD_KEY, UPLOAD_KEY];

interface BandwidthChartProps {
  /** Bandwidth data points to chart, one per HTTP request. */
  requests: readonly BandwidthRequestEntry[];
  /**
   * Time range for the chart — should match the sibling activity charts
   * (LogActivityChart, HttpActivityChart) so that all three are aligned.
   */
  timeRange: { readonly minTime: TimestampMicros; readonly maxTime: TimestampMicros };
  /** Callback when user drag-selects a time range. Values are in microseconds. */
  onTimeRangeSelected?: (startUs: TimestampMicros, endUs: TimestampMicros) => void;
  /** Callback when user double-clicks to reset zoom. */
  onResetZoom?: () => void;
}

/**
 * Bandwidth chart component.
 *
 * Plots HTTP bandwidth (upload and download bytes) aggregated into ~100 time
 * buckets as a stacked bar chart. The bucket resolution matches
 * `HttpActivityChart` so bandwidth peaks align with request-count peaks when
 * both charts are displayed together in `SummaryView`.
 *
 * The y-axis displays human-readable byte labels (B / KB / MB) via
 * `formatBytes`, which is passed to `BaseActivityChart` as `yAxisTickFormat`.
 *
 * @example
 * <BandwidthChart
 *   requests={stats.httpRequestsWithBandwidth}
 *   timeRange={stats.chartTimeRange}
 *   onTimeRangeSelected={handleTimeRangeSelected}
 *   onResetZoom={handleResetZoom}
 * />
 */
export function BandwidthChart({
  requests,
  timeRange,
  onTimeRangeSelected,
  onResetZoom,
}: BandwidthChartProps) {
  const formatTime = useCallback((timestampUs: number): string => {
    const date = new Date(timestampUs / MICROS_PER_MILLISECOND);
    return date.toISOString().split('T')[1].split('.')[0]; // HH:MM:SS in UTC
  }, []);

  const chartData = useMemo(() => {
    const { minTime, maxTime } = timeRange;

    if (minTime === 0 && maxTime === 0) {
      return {
        buckets: [] as BandwidthBucket[],
        maxCount: 0,
        minTime: 0 as TimestampMicros,
        maxTime: 0 as TimestampMicros,
      };
    }

    // Use the same bucket resolution as HttpActivityChart (~100 bars) so that
    // the two charts are visually aligned when compared side-by-side.
    const dataTimeRange = maxTime - minTime;
    const targetBars = 100;
    let bucketSize = MICROS_PER_SECOND;
    if (dataTimeRange > 0) {
      bucketSize = Math.max(MICROS_PER_SECOND, Math.ceil(dataTimeRange / targetBars));
    }

    // Initialise all bucket slots up-front so empty buckets appear as zero-height
    // bars, keeping the time axis continuous.
    const bucketMap = new Map<number, BandwidthBucket>();
    const firstBucketKey = Math.floor(minTime / bucketSize) * bucketSize;
    const lastBucketKey = Math.floor(maxTime / bucketSize) * bucketSize;
    for (let k = firstBucketKey; k <= lastBucketKey; k += bucketSize) {
      bucketMap.set(k, {
        timestamp: k,
        timeLabel: formatTime(k),
        total: 0,
        uploadBytes: 0,
        downloadBytes: 0,
      });
    }

    for (const req of requests) {
      const k = Math.floor(req.timestampUs / bucketSize) * bucketSize;
      const bucket = bucketMap.get(k);
      if (bucket) {
        bucket.uploadBytes += req.uploadBytes;
        bucket.downloadBytes += req.downloadBytes;
        bucket.total += req.uploadBytes + req.downloadBytes;
      }
    }

    const dataBuckets = Array.from(bucketMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    const maxCount = Math.max(...dataBuckets.map((b) => b.total), 1);
    return { buckets: dataBuckets, maxCount, minTime, maxTime };
  }, [requests, timeRange, formatTime]);

  const getCategoryColor = useCallback(
    (category: BandwidthCategory): string =>
      category === UPLOAD_KEY ? UPLOAD_COLOR : DOWNLOAD_COLOR,
    [],
  );

  const getCategoryCount = useCallback(
    (bucket: BandwidthBucket, category: BandwidthCategory): number =>
      category === UPLOAD_KEY ? bucket.uploadBytes : bucket.downloadBytes,
    [],
  );

  const renderTooltipContent = useCallback(
    (bucket: BandwidthBucket) => renderBandwidthTooltip(bucket),
    [],
  );

  /** Format y-axis tick values as human-readable byte sizes (B / KB / MB). */
  const yAxisTickFormat = useCallback(
    (value: { valueOf(): number }): string => formatBytes(value.valueOf()),
    [],
  );

  if (requests.length === 0) {
    return (
      <div className="chart-empty" style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
        No bandwidth data to display
      </div>
    );
  }

  return (
    <BaseActivityChart
      buckets={chartData.buckets}
      maxCount={chartData.maxCount}
      minTime={chartData.minTime}
      maxTime={chartData.maxTime}
      categories={CATEGORIES}
      getCategoryColor={getCategoryColor}
      getCategoryCount={getCategoryCount}
      renderTooltipContent={renderTooltipContent}
      onTimeRangeSelected={onTimeRangeSelected}
      onResetZoom={onResetZoom}
      emptyMessage="No bandwidth data to display"
      yAxisTickFormat={yAxisTickFormat}
      marginLeft={60}
    />
  );
}
