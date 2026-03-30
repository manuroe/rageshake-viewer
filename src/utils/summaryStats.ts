/**
 * Summary Statistics
 *
 * Pure domain function that derives all statistics displayed by `SummaryView`
 * from the current log data and active time range.  Keeping this logic outside
 * the component means it can be unit-tested without React and without mounting
 * a full component tree.
 *
 * ## Design notes
 * - All filtering is performed here; `SummaryView` is a thin rendering shell.
 * - The function accepts an explicit `timeRangeUs` override so the caller can
 *   inject a local zoom selection without mutating global store state.
 * - `lineNumberIndex` is the precomputed `Map<number, ParsedLogLine>` built
 *   once in `logStore` on parse — O(1) lookups instead of repeated `.find()`.
 */

import type { HttpRequest, HttpRequestWithTimestamp, SyncRequest, ParsedLogLine, SentryEvent, BandwidthRequestEntry } from '../types/log.types';
import type { TimestampMicros } from '../types/time.types';
import { getTimeRangeUs } from './requestFilters';
import { INCOMPLETE_STATUS_KEY } from './statusCodeUtils';
import { getMinMaxTimestamps } from './timeUtils';
import { extractCoreMessage } from './logMessageUtils';
import type { TimeFilterValue } from '../types/time.types';

const CLIENT_ERROR_CHART_STATUS = 'client-error';

/** Time range expressed in microseconds, or `null` meaning "no filter". */
export interface TimeRangeUs {
  readonly startUs: TimestampMicros;
  readonly endUs: TimestampMicros;
}

/** A single row in the error/warning breakdown table. */
export interface MessageCount {
  readonly type: string;
  readonly count: number;
}

/**
 * A single row in the HTTP error status-code breakdown table.
 * Uses `status` (not `type`) to match the domain concept.
 */
export interface HttpStatusCount {
  readonly status: string;
  readonly count: number;
}

/** A single row in the slowest-HTTP-requests table. */
export interface SlowHttpRequest {
  readonly id: string;
  readonly duration: number;
  readonly method: string;
  readonly uri: string;
  readonly status: string;
}

/** A single row in the top-failed-URLs table. */
export interface FailedUrl {
  readonly uri: string;
  readonly count: number;
  readonly statuses: readonly string[];
}

/** A single row in the sync-requests-by-connection table. */
export interface SyncByConnection {
  readonly connId: string;
  readonly count: number;
}

/**
 * All statistics derived from the currently loaded (and optionally filtered) log
 * data.  Returned by {@link computeSummaryStats}.
 */
export interface SummaryStats {
  /** Number of log lines in the active time window. */
  readonly totalLogLines: number;
  /** Log lines in the active window (forwarded to `LogActivityChart`). */
  readonly filteredLogLines: ParsedLogLine[];
  /** Display timestamps of the first and last filtered log lines. */
  readonly timeSpan: { readonly start: string; readonly end: string };
  readonly errors: number;
  readonly warnings: number;
  /** Up to 5 most-frequent error messages with their counts. */
  readonly errorsByType: readonly MessageCount[];
  /** Up to 5 most-frequent warning messages with their counts. */
  readonly warningsByType: readonly MessageCount[];
  /** Sentry events within the active time window. */
  readonly sentryEvents: SentryEvent[];
  /** HTTP error status codes with counts (4xx / 5xx only). */
  readonly httpErrorsByStatus: readonly HttpStatusCount[];
  /** Up to 5 URIs with the highest number of HTTP errors. */
  readonly topFailedUrls: readonly FailedUrl[];
  /** Up to 10 slowest non-sync HTTP requests. */
  readonly slowestHttpRequests: readonly SlowHttpRequest[];
  /** Sync request counts per connection, sorted descending. */
  readonly syncRequestsByConnection: readonly SyncByConnection[];
  /** HTTP request attempts with start timestamps (used by `HttpActivityChart`). */
  readonly httpRequestsWithTimestamps: HttpRequestWithTimestamp[];
  /** HTTP requests with upload/download byte counts (used by `BandwidthChart`). */
  readonly httpRequestsWithBandwidth: readonly BandwidthRequestEntry[];
  /**
   * Total number of unique HTTP requests (completed + incomplete), used for the
   * "N requests" headline. Distinct from `httpRequestsWithTimestamps.length`,
   * which can be larger when retried requests contribute intermediate entries.
   */
  readonly httpRequestCount: number;
  /** Number of HTTP requests that have not yet received a response. */
  readonly incompleteRequestCount: number;
  readonly totalUploadBytes: number;
  readonly totalDownloadBytes: number;
  /** Time range for aligning `HttpActivityChart` with `LogActivityChart`. */
  readonly chartTimeRange: { readonly minTime: TimestampMicros; readonly maxTime: TimestampMicros };
}

/**
 * Empty result returned when there is no loaded log data.
 * Arrays are fresh (not frozen) so both empty and non-empty results share the
 * same mutable array contract, avoiding unsafe casts and runtime inconsistencies.
 */
const EMPTY_STATS: SummaryStats = Object.freeze({
  totalLogLines: 0,
  filteredLogLines: [] as ParsedLogLine[],
  timeSpan: Object.freeze({ start: '', end: '' }),
  errors: 0,
  warnings: 0,
  errorsByType: [] as readonly MessageCount[],
  warningsByType: [] as readonly MessageCount[],
  sentryEvents: [] as SentryEvent[],
  httpErrorsByStatus: [] as readonly HttpStatusCount[],
  topFailedUrls: [] as readonly FailedUrl[],
  slowestHttpRequests: [] as readonly SlowHttpRequest[],
  syncRequestsByConnection: [] as readonly SyncByConnection[],
  httpRequestsWithTimestamps: [] as HttpRequestWithTimestamp[],
  httpRequestsWithBandwidth: [] as readonly BandwidthRequestEntry[],
  httpRequestCount: 0,
  incompleteRequestCount: 0,
  totalUploadBytes: 0,
  totalDownloadBytes: 0,
  chartTimeRange: Object.freeze({ minTime: 0 as TimestampMicros, maxTime: 0 as TimestampMicros }),
});

/**
 * Compute all statistics shown in `SummaryView`.
 *
 * @param rawLogLines - All parsed log lines in the loaded file.
 * @param allHttpRequests - All HTTP requests extracted from the log.
 * @param allRequests - All sync (sliding-sync) requests extracted from the log.
 * @param connectionIds - Ordered list of connection IDs (defines table row order).
 * @param sentryEvents - All Sentry events extracted from the log.
 * @param startTime - Global start-time filter from the store (or `null`).
 * @param endTime - Global end-time filter from the store (or `null`).
 * @param localTimeRangeUs - Optional local zoom override.  When provided this
 *   takes precedence over `startTime` / `endTime`.
 * @param lineNumberIndex - Precomputed `Map<lineNumber, ParsedLogLine>` (from
 *   `logStore`) used for O(1) timestamp lookups.
 * @returns A {@link SummaryStats} object with all derived values.
 */
export function computeSummaryStats(
  rawLogLines: readonly ParsedLogLine[],
  allHttpRequests: readonly HttpRequest[],
  allRequests: readonly SyncRequest[],
  connectionIds: readonly string[],
  sentryEvents: readonly SentryEvent[],
  startTime: TimeFilterValue | null,
  endTime: TimeFilterValue | null,
  localTimeRangeUs: TimeRangeUs | null,
  lineNumberIndex: ReadonlyMap<number, ParsedLogLine>
): SummaryStats {
  if (rawLogLines.length === 0) return EMPTY_STATS;

  const isTimestampInRange = (timestampUs: TimestampMicros): boolean => {
    if (!timeRangeUs) return true;
    return timestampUs >= timeRangeUs.startUs && timestampUs <= timeRangeUs.endUs;
  };

  const getLineTimestampUs = (lineNumber: number): TimestampMicros | null => {
    const timestampUs = lineNumberIndex.get(lineNumber)?.timestampUs;
    return typeof timestampUs === 'number' && timestampUs > 0 ? timestampUs : null;
  };

  const mapAttemptOutcomeToChartStatus = (outcome: string | undefined): string => {
    if (!outcome || outcome === INCOMPLETE_STATUS_KEY) return '';
    if (/^\d+$/.test(outcome)) return outcome;
    return CLIENT_ERROR_CHART_STATUS;
  };

  // Resolve time range: local zoom wins over global store filter.
  let timeRangeUs = getTimeRangeUs(rawLogLines, startTime, endTime);
  if (localTimeRangeUs !== null) {
    timeRangeUs = localTimeRangeUs;
  }

  // ── Filter by time range ───────────────────────────────────────────────────
  const filteredLogLines = rawLogLines.filter((line) => {
    if (!timeRangeUs) return true;
    return line.timestampUs >= timeRangeUs.startUs && line.timestampUs <= timeRangeUs.endUs;
  });

  const filteredSentryEvents = sentryEvents.filter((event) => {
    if (!timeRangeUs) return true;
    const ts = getLineTimestampUs(event.lineNumber);
    if (!ts) return false;
    return isTimestampInRange(ts);
  });

  const filteredHttpRequests = allHttpRequests.filter((req) => {
    if (!timeRangeUs) return true;
    const ts = getLineTimestampUs(req.responseLineNumber);
    if (!ts) return false;
    return isTimestampInRange(ts);
  });

  const filteredSyncRequests = allRequests.filter((req) => {
    if (!timeRangeUs) return true;
    const ts = getLineTimestampUs(req.responseLineNumber);
    if (!ts) return false;
    return isTimestampInRange(ts);
  });

  // ── Error / warning breakdown ─────────────────────────────────────────────
  const levelCounts = { TRACE: 0, DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0, UNKNOWN: 0 };
  const errorMessages: Record<string, number> = {};
  const warningMessages: Record<string, number> = {};

  for (const line of filteredLogLines) {
    levelCounts[line.level]++;
    if (line.level === 'ERROR') {
      const core = extractCoreMessage(line.message);
      errorMessages[core] = (errorMessages[core] ?? 0) + 1;
    } else if (line.level === 'WARN') {
      const core = extractCoreMessage(line.message);
      warningMessages[core] = (warningMessages[core] ?? 0) + 1;
    }
  }

  const errorsByType: MessageCount[] = Object.entries(errorMessages)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  const warningsByType: MessageCount[] = Object.entries(warningMessages)
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // ── HTTP error breakdown ───────────────────────────────────────────────────
  const httpStatusCounts: Record<string, number> = {};
  for (const req of filteredHttpRequests) {
    if (req.status) {
      const code = req.status.split(' ')[0];
      httpStatusCounts[code] = (httpStatusCounts[code] ?? 0) + 1;
    }
    // Count intermediate attempt outcomes separately (e.g. 503 from a retry that
    // eventually succeeded with 200) so they appear in the error breakdown.
    // Slice stops before the last element to avoid double-counting the final outcome.
    req.attemptOutcomes?.slice(0, (req.numAttempts ?? 1) - 1).forEach((outcome) => {
      if (/^\d+$/.test(outcome)) {
        httpStatusCounts[outcome] = (httpStatusCounts[outcome] ?? 0) + 1;
      }
    });
  }

  const httpErrorsByStatus: HttpStatusCount[] = Object.entries(httpStatusCounts)
    .filter(([status]) => parseInt(status, 10) >= 400)
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  // ── Failed URL grouping ────────────────────────────────────────────────────
  const failedUrlData: Record<string, { count: number; statuses: Set<string> }> = {};
  const recordFailedUrl = (uri: string, statusLabel: string) => {
    if (!failedUrlData[uri]) failedUrlData[uri] = { count: 0, statuses: new Set() };
    failedUrlData[uri].count += 1;
    failedUrlData[uri].statuses.add(statusLabel);
  };
  for (const req of filteredHttpRequests) {
    if (req.clientError) {
      recordFailedUrl(req.uri, 'Client Error');
    } else if (req.status) {
      const code = parseInt(req.status, 10);
      if (code >= 400) {
        recordFailedUrl(req.uri, req.status.split(' ')[0]);
      }
    }
    // Count intermediate failed attempt outcomes from retried requests
    // (e.g. a 503 → 200 request still surfaces its URI in Top Failed URLs).
    req.attemptOutcomes?.slice(0, (req.numAttempts ?? 1) - 1).forEach((outcome) => {
      if (/^\d+$/.test(outcome)) {
        const attemptCode = parseInt(outcome, 10);
        if (attemptCode >= 400) recordFailedUrl(req.uri, outcome);
      } else if (outcome !== INCOMPLETE_STATUS_KEY) {
        // Non-numeric outcome is a client error name (e.g. 'TimedOut'); skip 'Incomplete' placeholders.
        recordFailedUrl(req.uri, 'Client Error');
      }
    });
  }

  const topFailedUrls: FailedUrl[] = Object.entries(failedUrlData)
    .map(([uri, data]) => ({ uri, count: data.count, statuses: Array.from(data.statuses) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // ── Slowest HTTP requests (excluding /sync) ────────────────────────────────
  const slowestHttpRequests: SlowHttpRequest[] = filteredHttpRequests
    .filter((req) => !/\/sync(\?|$)/i.test(req.uri))
    .map((req) => ({
      id: req.requestId,
      duration:
        typeof req.requestDurationMs === 'number'
          ? req.requestDurationMs
          : parseInt(req.requestDurationMs as string, 10) || 0,
      method: req.method,
      uri: req.uri,
      status: req.clientError ? 'Client Error' : req.status,
    }))
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 10);

  // ── Sync requests by connection ────────────────────────────────────────────
  const syncByConn: Record<string, number> = {};
  for (const req of filteredSyncRequests) {
    syncByConn[req.connId] = (syncByConn[req.connId] ?? 0) + 1;
  }

  const syncRequestsByConnection: SyncByConnection[] = connectionIds
    .map((connId) => ({ connId, count: syncByConn[connId] ?? 0 }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count);

  // ── HTTP requests with timestamps (for chart) ─────────────────────────────
  // Build timeout lookup (requestId → timeout ms) from sync requests.
  const timeoutByRequestId = new Map<string, number>();
  for (const req of allRequests) {
    if (req.timeout !== undefined) timeoutByRequestId.set(req.requestId, req.timeout);
  }

  const buildChartEntries = (req: HttpRequest): HttpRequestWithTimestamp[] => {
    const timeout = timeoutByRequestId.get(req.requestId);
    const sendTimestampUs = getLineTimestampUs(req.sendLineNumber);
    const attemptStartTimestampsUs = req.attemptTimestampsUs ?? [];
    const finalStatus = req.clientError ? CLIENT_ERROR_CHART_STATUS : (req.status ?? '');

    if ((req.numAttempts ?? 1) > 1 && attemptStartTimestampsUs.length > 1) {
      // Preserve alignment between attempt timestamps and outcomes by operating on
      // original indices and skipping invalid timestamps without reindexing.
      const validAttemptIndices = attemptStartTimestampsUs
        .map((timestampUs, index) => (timestampUs > 0 ? index : -1))
        .filter((index) => index >= 0);

      if (validAttemptIndices.length > 1) {
        const lastValidIndex = validAttemptIndices[validAttemptIndices.length - 1];
        return validAttemptIndices
          .map((attemptIndex) => {
            const timestampUs = attemptStartTimestampsUs[attemptIndex] as TimestampMicros;
            return {
              requestId: req.requestId,
              status: mapAttemptOutcomeToChartStatus(
                req.attemptOutcomes?.[attemptIndex] ??
                  (attemptIndex === lastValidIndex ? finalStatus : undefined),
              ),
              timestampUs,
              ...(timeout !== undefined && { timeout }),
            };
          })
          .filter((entry) => isTimestampInRange(entry.timestampUs));
      }
    }

    if (!sendTimestampUs || !isTimestampInRange(sendTimestampUs)) {
      return [];
    }

    return [
      {
        requestId: req.requestId,
        status: finalStatus,
        timestampUs: sendTimestampUs,
        ...(timeout !== undefined && { timeout }),
      },
    ];
  };

  const httpRequestsWithTimestamps: HttpRequestWithTimestamp[] = [];
  let httpRequestCount = 0;
  let incompleteRequestCount = 0;

  // The chart headline mirrors the request set represented in the start-based
  // chart: each logical request contributes its bytes and request count once,
  // while retries contribute one chart bar per attempt start.
  let totalUploadBytes = 0;
  let totalDownloadBytes = 0;

  for (const req of allHttpRequests) {
    const chartEntries = buildChartEntries(req);
    if (chartEntries.length === 0) continue;

    httpRequestsWithTimestamps.push(...chartEntries);
    httpRequestCount += 1;
    totalUploadBytes += req.requestSize;
    totalDownloadBytes += req.responseSize;

    if (!req.status && !req.clientError) {
      incompleteRequestCount += 1;
    }
  }

  // ── HTTP requests with bandwidth data (for BandwidthChart) ───────────────
  // Uses completion-based timestamps (responseLineNumber) for finished
  // requests, falling back to sendLineNumber for in‑flight ones, and captures
  // requestSize / responseSize instead of status. Note this differs from the
  // start‑based HTTP activity chart, so cross‑chart alignment uses different
  // reference points (start vs. end of the transfer).
  const httpRequestsWithBandwidth: BandwidthRequestEntry[] = [];

  for (const req of allHttpRequests) {
    if (req.responseLineNumber) {
      const ts = getLineTimestampUs(req.responseLineNumber);
      if (!ts || ts === 0) continue;
      if (isTimestampInRange(ts)) {
        if (req.requestSize > 0 || req.responseSize > 0) {
          httpRequestsWithBandwidth.push({
            timestampUs: ts,
            uploadBytes: req.requestSize,
            downloadBytes: req.responseSize,
            uri: req.uri,
          });
        }
      }
    } else if (!req.status) {
      const ts = getLineTimestampUs(req.sendLineNumber);
      if (!ts || ts === 0) continue;
      if (isTimestampInRange(ts)) {
        if (req.requestSize > 0) {
          httpRequestsWithBandwidth.push({
            timestampUs: ts,
            uploadBytes: req.requestSize,
            downloadBytes: 0,
            uri: req.uri,
          });
        }
      }
    }
  }

  // ── Chart time range ───────────────────────────────────────────────────────
  const { min: chartMinTime, max: chartMaxTime } = getMinMaxTimestamps(filteredLogLines);

  return {
    totalLogLines: filteredLogLines.length,
    filteredLogLines,
    timeSpan: {
      start: filteredLogLines[0]?.displayTime ?? '',
      end: filteredLogLines[filteredLogLines.length - 1]?.displayTime ?? '',
    },
    errors: levelCounts.ERROR,
    warnings: levelCounts.WARN,
    errorsByType,
    warningsByType,
    sentryEvents: filteredSentryEvents,
    httpErrorsByStatus,
    topFailedUrls,
    slowestHttpRequests,
    syncRequestsByConnection,
    httpRequestsWithTimestamps,
    httpRequestCount,
    incompleteRequestCount,
    totalUploadBytes,
    totalDownloadBytes,
    httpRequestsWithBandwidth,
    chartTimeRange: { minTime: chartMinTime, maxTime: chartMaxTime },
  };
}
