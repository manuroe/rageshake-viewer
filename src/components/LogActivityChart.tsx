import { useMemo, useCallback } from 'react';
import type { ParsedLogLine, LogLevel, SentryEvent } from '../types/log.types';
import type { TimestampMicros } from '../types/time.types';
import { MICROS_PER_SECOND, MICROS_PER_MILLISECOND } from '../types/time.types';
import { BaseActivityChart, type ActivityBucket } from './BaseActivityChart';

interface LogActivityChartProps {
  logLines: ParsedLogLine[];
  sentryEvents?: SentryEvent[];
  /** Callback when user selects a time range. Values are in microseconds. */
  onTimeRangeSelected?: (startUs: TimestampMicros, endUs: TimestampMicros) => void;
  onResetZoom?: () => void;
}

type ChartCategory = LogLevel | 'SENTRY';

interface LogBucket extends ActivityBucket {
  counts: Record<ChartCategory, number>;
}

const LOG_LEVEL_COLORS: Record<ChartCategory, string> = {
  TRACE: '#808080',
  DEBUG: '#569cd6',
  INFO: '#4ec9b0',
  WARN: '#ff9800',
  ERROR: '#f44336',
  UNKNOWN: '#858585',
  SENTRY: '#a855f7',
};

const LOG_LEVEL_ORDER: ChartCategory[] = ['SENTRY', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE', 'UNKNOWN'];

export function LogActivityChart({ logLines, sentryEvents, onTimeRangeSelected, onResetZoom }: LogActivityChartProps) {
  // Helper to format timestamp as HH:MM:SS in UTC (converts from microseconds)
  const formatTime = useCallback((timestampUs: number): string => {
    const date = new Date(timestampUs / MICROS_PER_MILLISECOND);
    return date.toISOString().split('T')[1].split('.')[0]; // Gets HH:MM:SS in UTC
  }, []);

  const chartData = useMemo(() => {
    if (logLines.length === 0) {
      return { buckets: [] as LogBucket[], maxCount: 0, minTime: 0 as TimestampMicros, maxTime: 0 as TimestampMicros };
    }

    const sentryLineNumbers = new Set((sentryEvents ?? []).map(e => e.lineNumber));

    // Find time range (all in microseconds)
    const timestamps = logLines.map((line) => line.timestampUs);
    const dataMinTime = Math.min(...timestamps) as TimestampMicros;
    const dataMaxTime = Math.max(...timestamps) as TimestampMicros;
    const timeRange = dataMaxTime - dataMinTime;

    // Calculate bucket size to display ~100 bars (in microseconds)
    const targetBars = 100;
    let bucketSize = MICROS_PER_SECOND; // Start with 1 second
    if (timeRange > 0) {
      bucketSize = Math.max(MICROS_PER_SECOND, Math.ceil(timeRange / targetBars));
    }

    // Create buckets for the entire time range
    const bucketMap = new Map<number, LogBucket>();

    // Initialize all buckets in the time range
    const firstBucketKey = Math.floor(dataMinTime / bucketSize) * bucketSize;
    const lastBucketKey = Math.floor(dataMaxTime / bucketSize) * bucketSize;

    for (let bucketKey = firstBucketKey; bucketKey <= lastBucketKey; bucketKey += bucketSize) {
      bucketMap.set(bucketKey, {
        timestamp: bucketKey,
        timeLabel: formatTime(bucketKey),
        counts: {
          TRACE: 0,
          DEBUG: 0,
          INFO: 0,
          WARN: 0,
          ERROR: 0,
          UNKNOWN: 0,
          SENTRY: 0,
        },
        total: 0,
      });
    }

    // Fill buckets with log data; Sentry lines get their own category
    logLines.forEach((line) => {
      const bucketKey = Math.floor(line.timestampUs / bucketSize) * bucketSize;
      const bucket = bucketMap.get(bucketKey);
      if (bucket) {
        const category: ChartCategory = sentryLineNumbers.has(line.lineNumber) ? 'SENTRY' : line.level;
        bucket.counts[category]++;
        bucket.total++;
      }
    });

    // Convert to sorted array
    const dataBuckets = Array.from(bucketMap.values()).sort((a, b) => a.timestamp - b.timestamp);
    const dataMaxCount = Math.max(...dataBuckets.map((b) => b.total));

    return { buckets: dataBuckets, maxCount: dataMaxCount, minTime: dataMinTime, maxTime: dataMaxTime };
  }, [logLines, sentryEvents, formatTime]);

  const getCategoryColor = useCallback((level: ChartCategory) => LOG_LEVEL_COLORS[level], []);

  const getCategoryCount = useCallback((bucket: LogBucket, level: ChartCategory) => bucket.counts[level], []);

  const renderTooltipContent = useCallback(
    (bucket: LogBucket) => (
      <>
        <div style={{ marginBottom: '2px', fontWeight: 'bold', fontSize: '10px' }}>{bucket.timeLabel}</div>
        {LOG_LEVEL_ORDER.map((level) => {
          const count = bucket.counts[level];
          if (count === 0) return null;
          return (
            <div key={level} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '1px' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: '6px',
                  height: '6px',
                  backgroundColor: LOG_LEVEL_COLORS[level],
                  borderRadius: '1px',
                }}
              />
              <span style={{ fontSize: '9px' }}>
                {level === 'SENTRY' ? 'Sentry' : level}: {count}
              </span>
            </div>
          );
        })}
        <div style={{ marginTop: '2px', paddingTop: '2px', borderTop: '1px solid #555', fontSize: '9px' }}>
          Total: {bucket.total}
        </div>
      </>
    ),
    []
  );

  return (
    <BaseActivityChart
      buckets={chartData.buckets}
      maxCount={chartData.maxCount}
      minTime={chartData.minTime}
      maxTime={chartData.maxTime}
      categories={LOG_LEVEL_ORDER}
      getCategoryColor={getCategoryColor}
      getCategoryCount={getCategoryCount}
      renderTooltipContent={renderTooltipContent}
      onTimeRangeSelected={onTimeRangeSelected}
      onResetZoom={onResetZoom}
      emptyMessage="No log data to display"
    />
  );
}
