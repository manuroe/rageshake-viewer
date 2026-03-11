import { useMemo, useCallback } from 'react';
import type { TimestampMicros } from '../types/time.types';
import { MICROS_PER_SECOND, MICROS_PER_MILLISECOND } from '../types/time.types';
import { getHttpStatusColor } from '../utils/httpStatusColors';
import { BaseActivityChart, type ActivityBucket } from './BaseActivityChart';

/** HTTP request with resolved timestamp */
export interface HttpRequestWithTimestamp {
  requestId: string;
  status: string;
  timestampUs: TimestampMicros;
  /** timeout in ms if this is a /sync request; 0=catchup, ≥30000=long-poll */
  timeout?: number;
}

interface HttpActivityChartProps {
  httpRequests: HttpRequestWithTimestamp[];
  /** Time range to use for the chart - must match LogActivityChart for alignment */
  timeRange: { minTime: TimestampMicros; maxTime: TimestampMicros };
  /** Callback when user selects a time range. Values are in microseconds. */
  onTimeRangeSelected?: (startUs: TimestampMicros, endUs: TimestampMicros) => void;
  onResetZoom?: () => void;
}

interface HttpBucket extends ActivityBucket {
  /** Counts per individual status code (e.g., "200", "404", "500") */
  counts: Record<string, number>;
}

/** Synthetic status keys for sync request sub-types and client-side errors */
const SYNC_CATCHUP_KEY = 'sync-catchup';
const SYNC_LONGPOLL_KEY = 'sync-longpoll';
const CLIENT_ERROR_KEY = 'client-error';

/** Resolve the chart bucket key for an HTTP request (handles sync subtypes) */
function getBucketKey(req: HttpRequestWithTimestamp): string {
  if (req.status === CLIENT_ERROR_KEY) return CLIENT_ERROR_KEY;
  const statusCode = req.status ? req.status.split(' ')[0] : 'incomplete';
  const is2xx = statusCode.startsWith('2');
  if (is2xx && req.timeout !== undefined) {
    if (req.timeout === 0) return SYNC_CATCHUP_KEY;
    if (req.timeout >= 30000) return SYNC_LONGPOLL_KEY;
  }
  return statusCode;
}

/** Color for a chart status key (handles synthetic sync keys) */
function getBucketColor(code: string): string {
  if (code === CLIENT_ERROR_KEY) return 'var(--http-client-error)';
  if (code === SYNC_CATCHUP_KEY) return 'var(--sync-catchup-success)';
  if (code === SYNC_LONGPOLL_KEY) return 'var(--sync-longpoll-success)';
  return getHttpStatusColor(code);
}

/** Human-readable label for a chart status key */
function getBucketLabel(code: string): string {
  if (code === CLIENT_ERROR_KEY) return 'Client Error';
  if (code === SYNC_CATCHUP_KEY) return 'sync catchup';
  if (code === SYNC_LONGPOLL_KEY) return 'sync long-poll';
  return code;
}

/** Sort status codes for stacking order (first = bottom of bar, last = top):
 *  1. sync-catchup (bottom - baseline background activity)
 *  2. sync-longpoll (above catchup)
 *  3. all other codes: 5xx → client-error → 4xx → 3xx → 2xx → incomplete (top)
 */
function sortStatusCodes(codes: string[]): string[] {
  // Assign a sort key: lower = bottom of stack
  const sortKey = (c: string): number => {
    if (c === SYNC_CATCHUP_KEY) return -2;
    if (c === SYNC_LONGPOLL_KEY) return -1;
    if (c === CLIENT_ERROR_KEY) return 550; // between 5xx and 4xx
    const n = parseInt(c, 10);
    return isNaN(n) ? 9999 : n; // incomplete/unknown at top
  };
  return [...codes].sort((a, b) => sortKey(b) - sortKey(a));
}

export function HttpActivityChart({
  httpRequests,
  timeRange,
  onTimeRangeSelected,
  onResetZoom,
}: HttpActivityChartProps) {
  // Helper to format timestamp as HH:MM:SS in UTC (converts from microseconds)
  const formatTime = useCallback((timestampUs: number): string => {
    const date = new Date(timestampUs / MICROS_PER_MILLISECOND);
    return date.toISOString().split('T')[1].split('.')[0]; // Gets HH:MM:SS in UTC
  }, []);

  const chartData = useMemo(() => {
    const { minTime, maxTime } = timeRange;

    if (minTime === 0 && maxTime === 0) {
      return {
        buckets: [] as HttpBucket[],
        maxCount: 0,
        minTime: 0 as TimestampMicros,
        maxTime: 0 as TimestampMicros,
        statusCodes: [] as string[],
      };
    }

    const dataTimeRange = maxTime - minTime;

    // Calculate bucket size to display ~100 bars (in microseconds)
    // Must match LogActivityChart's bucket calculation for alignment
    const targetBars = 100;
    let bucketSize = MICROS_PER_SECOND; // Start with 1 second
    if (dataTimeRange > 0) {
      bucketSize = Math.max(MICROS_PER_SECOND, Math.ceil(dataTimeRange / targetBars));
    }

    // Track all unique status codes
    const allStatusCodes = new Set<string>();

    // Create buckets for the entire time range
    const bucketMap = new Map<number, HttpBucket>();

    // Initialize all buckets in the time range
    const firstBucketKey = Math.floor(minTime / bucketSize) * bucketSize;
    const lastBucketKey = Math.floor(maxTime / bucketSize) * bucketSize;

    for (let bucketKey = firstBucketKey; bucketKey <= lastBucketKey; bucketKey += bucketSize) {
      bucketMap.set(bucketKey, {
        timestamp: bucketKey,
        timeLabel: formatTime(bucketKey),
        counts: {},
        total: 0,
      });
    }

    // Fill buckets with HTTP request data
    httpRequests.forEach((req) => {
      const time = req.timestampUs;
      const bucketKey = Math.floor(time / bucketSize) * bucketSize;

      const bucket = bucketMap.get(bucketKey);
      if (bucket) {
        // Resolve to bucket key (sync subtypes get synthetic keys)
        const statusCode = getBucketKey(req);
        allStatusCodes.add(statusCode);
        bucket.counts[statusCode] = (bucket.counts[statusCode] || 0) + 1;
        bucket.total++;
      }
    });

    // Convert to sorted array
    const dataBuckets = Array.from(bucketMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    const dataMaxCount = Math.max(...dataBuckets.map((b) => b.total), 1);

    // Sort status codes: 5xx first (top of stack), then 4xx, 3xx, 2xx, incomplete last
    const sortedStatusCodes = sortStatusCodes(Array.from(allStatusCodes));

    return { buckets: dataBuckets, maxCount: dataMaxCount, minTime, maxTime, statusCodes: sortedStatusCodes };
  }, [httpRequests, timeRange, formatTime]);

  const getCategoryColor = useCallback((code: string) => getBucketColor(code), []);

  const getCategoryCount = useCallback((bucket: HttpBucket, code: string) => bucket.counts[code] || 0, []);

  const renderTooltipContent = useCallback(
    (bucket: HttpBucket) => (
      <>
        <div style={{ marginBottom: '2px', fontWeight: 'bold', fontSize: '10px' }}>{bucket.timeLabel}</div>
        {[...chartData.statusCodes].reverse().map((code) => {
          const count = bucket.counts[code] || 0;
          if (count === 0) return null;
          return (
            <div key={code} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '1px' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: '6px',
                  height: '6px',
                  backgroundColor: getBucketColor(code),
                  borderRadius: '1px',
                }}
              />
              <span style={{ fontSize: '9px' }}>
                {getBucketLabel(code)}: {count}
              </span>
            </div>
          );
        })}
        <div style={{ marginTop: '2px', paddingTop: '2px', borderTop: '1px solid #555', fontSize: '9px' }}>
          Total: {bucket.total}
        </div>
      </>
    ),
    [chartData.statusCodes]
  );

  if (httpRequests.length === 0) {
    return (
      <div className="chart-empty" style={{ padding: '20px', textAlign: 'center', color: '#666' }}>
        No HTTP request data to display
      </div>
    );
  }

  return (
    <BaseActivityChart
      buckets={chartData.buckets}
      maxCount={chartData.maxCount}
      minTime={chartData.minTime}
      maxTime={chartData.maxTime}
      categories={chartData.statusCodes}
      getCategoryColor={getCategoryColor}
      getCategoryCount={getCategoryCount}
      renderTooltipContent={renderTooltipContent}
      onTimeRangeSelected={onTimeRangeSelected}
      onResetZoom={onResetZoom}
      emptyMessage="No HTTP request data to display"
    />
  );
}
