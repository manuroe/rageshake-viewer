import { useMemo, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogStore } from '../stores/logStore';
import { useURLParams } from '../hooks/useURLParams';
import { BurgerMenu } from '../components/BurgerMenu';
import { TimeRangeSelector } from '../components/TimeRangeSelector';
import { LogActivityChart } from '../components/LogActivityChart';
import { HttpActivityChart, type HttpRequestWithTimestamp } from '../components/HttpActivityChart';
import { calculateTimeRangeMicros, formatTimestamp, formatDuration } from '../utils/timeUtils';
import { formatBytes } from '../utils/sizeUtils';
import { getHttpStatusBadgeClass } from '../utils/httpStatusColors';
import { stripMatrixClientPath } from '../utils/uriUtils';
import type { LogLevel, ParsedLogLine, SentryEvent } from '../types/log.types';
import type { TimestampMicros } from '../types/time.types';
import styles from './SummaryView.module.css';
import tableStyles from '../components/Table.module.css';

export function SummaryView() {
  const navigate = useNavigate();
  const {
    rawLogLines,
    allHttpRequests,
    allRequests,
    connectionIds,
    sentryEvents,
    startTime,
    endTime,
    detectedPlatform,
  } = useLogStore();
  const { setTimeFilter } = useURLParams();

  const summaryTitle = `Summary${detectedPlatform ? ` - ${detectedPlatform === 'ios' ? 'iOS' : 'Android'}` : ''}`;

  // Local zoom state (in microseconds)
  const [localStartTime, setLocalStartTime] = useState<TimestampMicros | null>(null);
  const [localEndTime, setLocalEndTime] = useState<TimestampMicros | null>(null);

  // Precompute min/max across ALL raw log lines (keyword anchor)
  const fullDataRange = useMemo(() => {
    if (rawLogLines.length === 0) return { minTime: 0, maxTime: 0 };
    const times = rawLogLines.map((l) => l.timestampUs);
    return { minTime: Math.min(...times), maxTime: Math.max(...times) };
  }, [rawLogLines]);

  /**
   * Format a selection boundary for display.
   * Returns 'start' / 'end' when the value aligns with the full data edge,
   * otherwise returns a HH:MM:SS UTC string.
   */
  const formatSelectionBoundary = useCallback(
    (us: TimestampMicros): string => {
      if (Math.abs(us - fullDataRange.minTime) <= 1000) return 'start';
      if (Math.abs(us - fullDataRange.maxTime) <= 1000) return 'end';
      return formatTimestamp(us, 'HH:MM:SS');
    },
    [fullDataRange]
  );

  // Clear local zoom when global filters change
  useEffect(() => {
    setLocalStartTime(null);
    setLocalEndTime(null);
  }, [startTime, endTime]);

  const handleTimeRangeSelected = useCallback((startUs: TimestampMicros, endUs: TimestampMicros) => {
    setLocalStartTime(startUs);
    setLocalEndTime(endUs);
  }, []);

  const handleResetZoom = useCallback(() => {
    // If there's a local selection, clear it
    if (localStartTime !== null || localEndTime !== null) {
      setLocalStartTime(null);
      setLocalEndTime(null);
    } else if (rawLogLines.length > 0 && startTime && endTime) {
      // No local selection - check if we can zoom out to full range
      const { startUs: currentStartUs, endUs: currentEndUs } = calculateTimeRangeMicros(startTime, endTime, fullDataRange.minTime, fullDataRange.maxTime);
      
      // Only zoom out if current range is narrower than full range (with 1000us = 1ms tolerance)
      if (currentStartUs > fullDataRange.minTime + 1000 || currentEndUs < fullDataRange.maxTime - 1000) {
        // Set as local selection so Apply button appears
        setLocalStartTime(fullDataRange.minTime as TimestampMicros);
        setLocalEndTime(fullDataRange.maxTime as TimestampMicros);
      }
    }
  }, [localStartTime, localEndTime, rawLogLines, startTime, endTime, fullDataRange]);

  const handleApplyGlobally = useCallback(() => {
    if (localStartTime !== null && localEndTime !== null && rawLogLines.length > 0) {
      const startMatchesFull = Math.abs(localStartTime - fullDataRange.minTime) <= 1000;
      const endMatchesFull = Math.abs(localEndTime - fullDataRange.maxTime) <= 1000;

      // If selection matches full range (within 1ms tolerance), clear the filter instead
      if (startMatchesFull && endMatchesFull) {
        setTimeFilter(null, null);
      } else {
        // Use keywords when the selection boundary aligns with the data edge,
        // otherwise find the closest log line and use its original timestamp string.
        let startParam: string;
        if (startMatchesFull) {
          startParam = 'start';
        } else {
          const startLine = rawLogLines.reduce((closest, line) =>
            Math.abs(line.timestampUs - localStartTime) < Math.abs(closest.timestampUs - localStartTime) ? line : closest
          );
          startParam = startLine.isoTimestamp;
        }

        let endParam: string;
        if (endMatchesFull) {
          endParam = 'end';
        } else {
          const endLine = rawLogLines.reduce((closest, line) =>
            Math.abs(line.timestampUs - localEndTime) < Math.abs(closest.timestampUs - localEndTime) ? line : closest
          );
          endParam = endLine.isoTimestamp;
        }

        setTimeFilter(startParam, endParam);
      }

      // Clear local selection state immediately
      setLocalStartTime(null);
      setLocalEndTime(null);
    }
  }, [localStartTime, localEndTime, rawLogLines, fullDataRange, setTimeFilter]);

  // Check if local selection differs from current global filter
  const shouldShowApplyButton = useMemo(() => {
    if (localStartTime === null || localEndTime === null) return false;
    
    // If no global filter, always show apply button
    if (!startTime || !endTime) return true;
    
    const { startUs: globalStartUs, endUs: globalEndUs } = calculateTimeRangeMicros(startTime, endTime, fullDataRange.minTime, fullDataRange.maxTime);
    
    // Show if selection differs from global filter (with 1000us = 1ms tolerance)
    return Math.abs(localStartTime - globalStartUs) > 1000 || Math.abs(localEndTime - globalEndUs) > 1000;
  }, [localStartTime, localEndTime, startTime, endTime, fullDataRange]);

  // Calculate log statistics
  const stats = useMemo(() => {
    if (rawLogLines.length === 0) {
      return {
        totalLogLines: 0,
        filteredLogLines: [] as ParsedLogLine[],
        timeSpan: { start: '', end: '' },
        errors: 0,
        warnings: 0,
        errorsByType: [] as Array<{ type: string; count: number }>,
        warningsByType: [] as Array<{ type: string; count: number }>,
        sentryEvents: [] as SentryEvent[],
        httpErrorsByStatus: [] as Array<{ status: string; count: number }>,
        topFailedUrls: [] as Array<{ uri: string; count: number; statuses: string[] }>,
        slowestHttpRequests: [] as Array<{
          id: string;
          duration: number;
          method: string;
          uri: string;
          status: string;
        }>,
        syncRequestsByConnection: [] as Array<{ connId: string; count: number }>,
        httpRequestsWithTimestamps: [] as HttpRequestWithTimestamp[],
        incompleteRequestCount: 0,
        totalUploadBytes: 0,
        totalDownloadBytes: 0,
        chartTimeRange: { minTime: 0 as TimestampMicros, maxTime: 0 as TimestampMicros },
      };
    }

    // Calculate time range if filters are set (in microseconds)
    let timeRangeUs: { startUs: TimestampMicros; endUs: TimestampMicros } | null = null;
    if (startTime || endTime) {
      const times = rawLogLines.map((line) => line.timestampUs).filter((t) => t > 0);
      const minLogTimeUs = times.length > 0 ? Math.min(...times) : 0;
      const maxLogTimeUs = times.length > 0 ? Math.max(...times) : 0;
      timeRangeUs = calculateTimeRangeMicros(startTime, endTime, minLogTimeUs, maxLogTimeUs);
    }

    // Apply local zoom if set
    if (localStartTime !== null && localEndTime !== null) {
      timeRangeUs = {
        startUs: localStartTime,
        endUs: localEndTime,
      };
    }

    // Filter log lines by time range
    const filteredLogLines = rawLogLines.filter((line) => {
      if (!timeRangeUs) return true;
      return line.timestampUs >= timeRangeUs.startUs && line.timestampUs <= timeRangeUs.endUs;
    });

    // Build a map from line number to timestamp for efficient lookup
    const lineNumberToTimestamp = new Map<number, TimestampMicros>();
    rawLogLines.forEach(line => {
      if (line.timestampUs) {
        lineNumberToTimestamp.set(line.lineNumber, line.timestampUs);
      }
    });

    // Filter sentry events by time range
    const filteredSentryEvents = sentryEvents.filter((event) => {
      if (!timeRangeUs) return true;
      const timestampUs = lineNumberToTimestamp.get(event.lineNumber);
      if (!timestampUs) return false;
      return timestampUs >= timeRangeUs.startUs && timestampUs <= timeRangeUs.endUs;
    });

    // Filter HTTP requests by time range and resolve timestamps
    const filteredHttpRequests = allHttpRequests.filter((req) => {
      if (!timeRangeUs) return true;
      if (!req.responseLineNumber) return false;
      const timestampUs = lineNumberToTimestamp.get(req.responseLineNumber);
      if (!timestampUs) return false;
      return timestampUs >= timeRangeUs.startUs && timestampUs <= timeRangeUs.endUs;
    });

    // Build timeout lookup from sync requests (requestId → timeout ms)
    const timeoutByRequestId = new Map<string, number>();
    for (const req of allRequests) {
      if (req.timeout !== undefined) {
        timeoutByRequestId.set(req.requestId, req.timeout);
      }
    }

    // Create HTTP requests with resolved timestamps for the chart
    const completedRequestsWithTimestamps: HttpRequestWithTimestamp[] = filteredHttpRequests
      .filter(req => req.responseLineNumber)
      .map(req => {
        const timestampUs = lineNumberToTimestamp.get(req.responseLineNumber) ?? (0 as TimestampMicros);
        const timeout = timeoutByRequestId.get(req.requestId);
        return {
          requestId: req.requestId,
          status: req.clientError ? 'client-error' : (req.status ?? ''),
          timestampUs,
          ...(timeout !== undefined && { timeout }),
        };
      })
      .filter(req => req.timestampUs > 0);

    // Add incomplete requests (no response yet) using their send timestamp
    const incompleteRequestsWithTimestamps: HttpRequestWithTimestamp[] = allHttpRequests
      .filter(req => !req.status && !req.clientError)
      .filter(req => {
        if (!timeRangeUs) return true;
        if (!req.sendLineNumber) return false;
        const timestampUs = lineNumberToTimestamp.get(req.sendLineNumber);
        if (!timestampUs) return false;
        return timestampUs >= timeRangeUs.startUs && timestampUs <= timeRangeUs.endUs;
      })
      .map(req => ({
        requestId: req.requestId,
        status: '',
        timestampUs: lineNumberToTimestamp.get(req.sendLineNumber) ?? (0 as TimestampMicros),
      }))
      .filter(req => req.timestampUs > 0);

    const httpRequestsWithTimestamps = [...completedRequestsWithTimestamps, ...incompleteRequestsWithTimestamps];

    // Filter sync requests by time range
    const filteredSyncRequests = allRequests.filter((req) => {
      if (!timeRangeUs) return true;
      if (!req.responseLineNumber) return false;
      const timestampUs = lineNumberToTimestamp.get(req.responseLineNumber);
      if (!timestampUs) return false;
      return timestampUs >= timeRangeUs.startUs && timestampUs <= timeRangeUs.endUs;
    });

    // Calculate chart time range from filtered log lines (for alignment with LogActivityChart)
    const filteredTimestamps = filteredLogLines.map(line => line.timestampUs);
    const chartMinTime = filteredTimestamps.length > 0 ? Math.min(...filteredTimestamps) as TimestampMicros : 0 as TimestampMicros;
    const chartMaxTime = filteredTimestamps.length > 0 ? Math.max(...filteredTimestamps) as TimestampMicros : 0 as TimestampMicros;

    // Time span (from filtered logs)
    const firstTimestamp = filteredLogLines[0]?.displayTime || '';
    const lastTimestamp = filteredLogLines[filteredLogLines.length - 1]?.displayTime || '';

    // Helper function to extract the core error message without timestamp and log level
    const extractCoreMessage = (message: string): string => {
      // Remove timestamp prefix (e.g., "2026-01-28T13:24:43.950890Z")
      // Pattern: ISO timestamp followed by log level
      const match = message.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s+(?:TRACE|DEBUG|INFO|WARN|ERROR)\s+(.+)$/);
      if (match && match[1]) {
        return match[1].trim();
      }
      // If pattern doesn't match, return original message
      return message;
    };

    // Count errors and warnings by level (from filtered logs)
    const levelCounts: Record<LogLevel, number> = {
      TRACE: 0,
      DEBUG: 0,
      INFO: 0,
      WARN: 0,
      ERROR: 0,
      UNKNOWN: 0,
    };

    const errorMessages: Record<string, number> = {};
    const warningMessages: Record<string, number> = {};

    filteredLogLines.forEach((line) => {
      levelCounts[line.level]++;
      if (line.level === 'ERROR') {
        const coreMessage = extractCoreMessage(line.message);
        errorMessages[coreMessage] = (errorMessages[coreMessage] || 0) + 1;
      } else if (line.level === 'WARN') {
        const coreMessage = extractCoreMessage(line.message);
        warningMessages[coreMessage] = (warningMessages[coreMessage] || 0) + 1;
      }
    });

    // Sort errors and warnings by frequency
    const errorsByType = Object.entries(errorMessages)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const warningsByType = Object.entries(warningMessages)
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // HTTP errors by status (from filtered requests)
    const httpStatusCounts: Record<string, number> = {};
    filteredHttpRequests.forEach((req) => {
      if (req.status) {
        const statusCode = req.status.split(' ')[0]; // Extract just the number
        httpStatusCounts[statusCode] =
          (httpStatusCounts[statusCode] || 0) + 1;
      }
    });

    // Filter for error statuses (4xx, 5xx)
    const httpErrorsByStatus = Object.entries(httpStatusCounts)
      .filter(([status]) => {
        const code = parseInt(status, 10);
        return code >= 400;
      })
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);

    // Failed URLs (4xx, 5xx, and client-side transport errors) grouped by URI
    const failedUrlData: Record<string, { count: number; statuses: Set<string> }> = {};
    filteredHttpRequests.forEach((req) => {
      if (req.clientError) {
        if (!failedUrlData[req.uri]) {
          failedUrlData[req.uri] = { count: 0, statuses: new Set() };
        }
        failedUrlData[req.uri].count += 1;
        failedUrlData[req.uri].statuses.add('Client Error');
      } else if (req.status) {
        const statusCode = parseInt(req.status, 10);
        if (statusCode >= 400) {
          if (!failedUrlData[req.uri]) {
            failedUrlData[req.uri] = { count: 0, statuses: new Set() };
          }
          failedUrlData[req.uri].count += 1;
          failedUrlData[req.uri].statuses.add(req.status.split(' ')[0]);
        }
      }
    });

    const topFailedUrls = Object.entries(failedUrlData)
      .map(([uri, data]) => ({ uri, count: data.count, statuses: Array.from(data.statuses) }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Slowest HTTP requests (from filtered requests)
    const slowestHttpRequests = filteredHttpRequests
      .filter(req => !/\/sync(\?|$)/i.test(req.uri))
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

    // Sync requests by connection (from filtered requests)
    const syncByConn: Record<string, number> = {};
    filteredSyncRequests.forEach((req) => {
      syncByConn[req.connId] = (syncByConn[req.connId] || 0) + 1;
    });

    const syncRequestsByConnection = connectionIds
      .map((connId) => ({
        connId,
        count: syncByConn[connId] || 0,
      }))
      .filter((item) => item.count > 0)
      .sort((a, b) => b.count - a.count);

    // Sum uploaded and downloaded bytes over all charted requests (completed + incomplete in range)
    // to match the set represented by the chart and the request count headline.
    // Iterate allHttpRequests directly to avoid requestId-keyed map deduplication issues when
    // multiple requests share the same requestId.
    let totalUploadBytes = 0;
    let totalDownloadBytes = 0;
    for (const req of allHttpRequests) {
      if (req.responseLineNumber) {
        // Completed request: mirrors completedRequestsWithTimestamps filter
        const ts = lineNumberToTimestamp.get(req.responseLineNumber);
        if (!ts || ts === 0) continue;
        if (!timeRangeUs || (ts >= timeRangeUs.startUs && ts <= timeRangeUs.endUs)) {
          totalUploadBytes += req.requestSize;
          totalDownloadBytes += req.responseSize;
        }
      } else if (!req.status && req.sendLineNumber) {
        // Incomplete request: mirrors incompleteRequestsWithTimestamps filter
        const ts = lineNumberToTimestamp.get(req.sendLineNumber);
        if (!ts || ts === 0) continue;
        if (!timeRangeUs || (ts >= timeRangeUs.startUs && ts <= timeRangeUs.endUs)) {
          totalUploadBytes += req.requestSize;
        }
      }
    }

    return {
      totalLogLines: filteredLogLines.length,
      filteredLogLines, // Include for chart
      timeSpan: { start: firstTimestamp, end: lastTimestamp },
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
      incompleteRequestCount: incompleteRequestsWithTimestamps.length,
      totalUploadBytes,
      totalDownloadBytes,
      chartTimeRange: { minTime: chartMinTime, maxTime: chartMaxTime },
    };
  }, [rawLogLines, allHttpRequests, allRequests, connectionIds, sentryEvents, startTime, endTime, localStartTime, localEndTime]);

  if (rawLogLines.length === 0) {
    return (
      <div className="app">
        <div className="header-compact">
          <BurgerMenu />
          <h1 className="header-title">{summaryTitle}</h1>
        </div>
        <div className="content">
          <p>No logs loaded. Please upload a log file to see the summary.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="header-compact">
        <div className="header-left">
          <BurgerMenu />
          <h1 className="header-title">{summaryTitle}</h1>
        </div>
        
        <div className="header-right">
          {shouldShowApplyButton && localStartTime !== null && localEndTime !== null && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ fontSize: '12px', color: 'var(--color-primary)', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                Selected: {formatSelectionBoundary(localStartTime)} – {formatSelectionBoundary(localEndTime)} UTC
              </span>
              <button
                onClick={handleResetZoom}
                className="btn-secondary"
                style={{ padding: '4px 12px', fontSize: '12px' }}
              >
                Cancel
              </button>
              <button
                onClick={handleApplyGlobally}
                className="btn-primary"
                style={{ padding: '4px 12px', fontSize: '12px' }}
              >
                Apply
              </button>
            </div>
          )}
          <TimeRangeSelector />
        </div>
      </div>

      <div className="content">
        {/* Log Overview */}
        <section className={styles.summarySection}>
          <h2>Logs Over Time: {stats.totalLogLines} lines</h2>
          
          {/* Activity Chart */}
          <div className={styles.activityChartContainer}>
            <LogActivityChart 
              logLines={stats.filteredLogLines}
              sentryEvents={stats.sentryEvents}
              onTimeRangeSelected={handleTimeRangeSelected}
              onResetZoom={handleResetZoom}
            />
          </div>
        </section>

        {/* Sentry Reports Section */}
        {stats.sentryEvents.length > 0 && (
          <section className={styles.sentrySectionAlert}>
            <div className={styles.summaryTableContainer}>
              <table className={styles.summaryTable}>
                <thead>
                  <tr>
                    <th>
                      Sentry Reports (
                      <button
                        type="button"
                        className={styles.clickableHeading}
                        onClick={() => navigate('/logs?filter=sentry')}
                        aria-label="View Sentry reports in logs"
                      >
                        {stats.sentryEvents.length}
                      </button>
                      )
                    </th>
                    <th>Sentry ID</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.sentryEvents.map((event) => (
                    <tr key={event.sentryId ?? `line-${event.lineNumber}`}>
                      <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                        <button
                          type="button"
                          onClick={() => navigate(`/logs?filter=${encodeURIComponent(event.sentryId ?? 'Sending error to Sentry')}`)}
                          className={styles.actionLink}
                          style={{ textAlign: 'left', whiteSpace: 'normal' }}
                        >
                          {event.message.substring(0, 150)}
                        </button>
                      </td>
                      <td style={{ fontFamily: 'monospace', fontSize: '12px', whiteSpace: 'nowrap' }}>
                        {event.sentryUrl && event.sentryId ? (
                          <a
                            href={event.sentryUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.actionLink}
                          >
                            {event.sentryId}
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Errors & Warnings Section */}
        <div className={styles.errorsWarningsGrid}>
          {/* Errors Section */}
          {stats.errors > 0 && (
            <section className={styles.summarySection}>
              {stats.errorsByType.length > 0 && (
                <div className={styles.summaryTableContainer}>
                  <table className={styles.summaryTable}>
                    <thead>
                      <tr>
                        <th>
                          Top Errors (
                          <span
                            className={styles.clickableHeading}
                            onClick={() => navigate('/logs?filter=ERROR')}
                          >
                            {stats.errors}
                          </span>
                          )
                        </th>
                        <th style={{ textAlign: 'right' }}>Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.errorsByType.map((error, idx) => (
                        <tr key={idx}>
                          <td>
                            <button
                              className={styles.actionLink}
                              title={error.type}
                              onClick={() =>
                                navigate(
                                  `/logs?filter=${encodeURIComponent(
                                    error.type
                                  )}`
                                )
                              }
                              style={{ textAlign: 'left', whiteSpace: 'normal' }}
                            >
                              {error.type.substring(0, 100)}
                            </button>
                          </td>
                          <td className={styles.alignRight}>{error.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* Warnings Section */}
          {stats.warnings > 0 && (
            <section className={styles.summarySection}>
              {stats.warningsByType.length > 0 && (
                <div className={styles.summaryTableContainer}>
                  <table className={styles.summaryTable}>
                    <thead>
                      <tr>
                        <th>
                          Top Warnings (
                          <span
                            className={styles.clickableHeading}
                            onClick={() => navigate('/logs?filter=WARN')}
                          >
                            {stats.warnings}
                          </span>
                          )
                        </th>
                        <th style={{ textAlign: 'right' }}>Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.warningsByType.map((warning, idx) => (
                        <tr key={idx}>
                          <td>
                            <button
                              className={styles.actionLink}
                              title={warning.type}
                              onClick={() =>
                                navigate(
                                  `/logs?filter=${encodeURIComponent(
                                    warning.type
                                  )}`
                                )
                              }
                              style={{ textAlign: 'left', whiteSpace: 'normal' }}
                            >
                              {warning.type.substring(0, 100)}
                            </button>
                          </td>
                          <td className={styles.alignRight}>{warning.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>

        {/* HTTP Requests Activity Chart */}
        {stats.httpRequestsWithTimestamps.length > 0 && (
          <section className={styles.summarySection}>
            <h2>HTTP Requests Over Time: {stats.httpRequestsWithTimestamps.length} requests{stats.incompleteRequestCount > 0 ? ` (${stats.incompleteRequestCount} incomplete)` : ''}{(stats.totalUploadBytes > 0 || stats.totalDownloadBytes > 0) ? ` — ↑ ${formatBytes(stats.totalUploadBytes)} / ↓ ${formatBytes(stats.totalDownloadBytes)}` : ''}</h2>
            <div className={styles.activityChartContainer}>
              <HttpActivityChart
                httpRequests={stats.httpRequestsWithTimestamps}
                timeRange={stats.chartTimeRange}
                onTimeRangeSelected={handleTimeRangeSelected}
                onResetZoom={handleResetZoom}
              />
            </div>
          </section>
        )}

        {/* HTTP Errors Grid */}
        <div className={styles.errorsWarningsGrid}>
          {/* TOP HTTP Errors Section */}
          {stats.topFailedUrls.length > 0 && (
            <section className={styles.summarySection}>
              {stats.topFailedUrls.length > 0 && (
                <div className={styles.summaryTableContainer}>
                  <table className={styles.summaryTable}>
                    <thead>
                      <tr>
                        <th>
                          Top Failed URLs (
                          <span
                            className={styles.clickableHeading}
                            onClick={() => {
                              const statuses = stats.httpErrorsByStatus.map(e => e.status);
                              const hasClientErrors = stats.topFailedUrls.some(u => u.statuses.includes('Client Error'));
                              if (hasClientErrors) statuses.push('Client Error');
                              void navigate(`/http_requests?status=${encodeURIComponent(statuses.join(','))}`);
                            }}
                          >
                            {stats.topFailedUrls.reduce((sum, e) => sum + e.count, 0)}
                          </span>
                          )
                        </th>
                        <th>Status</th>
                        <th className={styles.alignRight}>Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        return stats.topFailedUrls.map((item, idx) => (
                          <tr key={idx}>
                            <td>
                              <button
                                className={styles.actionLink}
                                title={item.uri}
                                onClick={() => {
                                  // Find all requests matching this URI with error status or client error
                                  const matchingRequests = allHttpRequests.filter(req => {
                                    if (req.uri !== item.uri) return false;
                                    if (req.clientError) return true;
                                    if (!req.status) return false;
                                    const statusCode = parseInt(req.status, 10);
                                    return statusCode >= 400;
                                  });
                                  
                                  // If single occurrence, open with request_id param; else use filter param
                                  if (matchingRequests.length === 1) {
                                    void navigate(`/http_requests?request_id=${encodeURIComponent(matchingRequests[0].requestId)}`);
                                  } else {
                                    void navigate(`/http_requests?filter=${encodeURIComponent(item.uri)}`);
                                  }
                                }}
                                style={{ textAlign: 'left', whiteSpace: 'normal' }}
                              >
                                {stripMatrixClientPath(item.uri)}
                              </button>
                            </td>
                            <td>
                              {item.statuses.map((status, i) => (
                                <span key={status} className={`${tableStyles.badge} ${tableStyles[`badge${getHttpStatusBadgeClass(status)}`]}`}>
                                  {status}{i < item.statuses.length - 1 ? ' ' : ''}
                                </span>
                              ))}
                            </td>
                            <td className={styles.alignRight}>{item.count}</td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* HTTP Errors Section */}
          {stats.httpErrorsByStatus.length > 0 && (
            <section className={styles.summarySection}>
              <div className={styles.summaryTableContainer}>
                <table className={styles.summaryTable}>
                  <thead>
                    <tr>
                      <th>HTTP Error Codes</th>
                      <th style={{ textAlign: 'right' }}>Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.httpErrorsByStatus.map((error, idx) => (
                      <tr key={idx}>
                        <td>
                          <button
                            className={`${styles.actionLink} ${tableStyles.badge} ${tableStyles[`badge${getHttpStatusBadgeClass(error.status)}`]}`}
                            onClick={() =>
                              void navigate(`/http_requests?status=${error.status}`)
                            }
                          >
                            {error.status}
                          </button>
                        </td>
                        <td className={styles.alignRight}>{error.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        {/* Slowest URLs Section */}
        {stats.slowestHttpRequests.length > 0 && (
          <section className={styles.summarySection}>
            <h2>Slowest URLs</h2>
            <div className={styles.summaryTableContainer}>
              <table className={styles.summaryTable}>
                <thead>
                  <tr>
                    <th>Duration</th>
                    <th>Request</th>
                    <th>URI</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const filtered = stats.slowestHttpRequests;
                    return filtered.map((req) => {
                      const badgeClass = req.status ? `badge${getHttpStatusBadgeClass(req.status)}` : 'badgeIncomplete';
                      return (
                      <tr key={req.id}>
                        <td>
                          <span className={styles.durationBadge}>
                            {formatDuration(req.duration)}
                          </span>
                        </td>
                        <td style={{ fontFamily: 'monospace', fontSize: '13px', color: '#007acc' }}>
                          <a
                            href={`#/http_requests?request_id=${req.id}`}
                            className={styles.actionLink}
                            title={req.id}
                            style={{ textDecoration: 'underline', color: '#007acc' }}
                          >
                            {req.id}
                          </a>
                        </td>
                        <td className={styles.uriCell}>
                          {stripMatrixClientPath(req.uri)}
                        </td>
                        <td>
                          <span className={`${tableStyles.badge} ${tableStyles[badgeClass]}`}>
                            {req.status || 'incomplete'}
                          </span>
                        </td>
                      </tr>
                    );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Sync Requests by Connection Section */}
        {stats.syncRequestsByConnection.length > 0 && (
          <section className={styles.summarySection}>
            <h2>Sync Requests by Connection</h2>
            <div className={styles.summaryTableContainer}>
              <table className={styles.summaryTable}>
                <thead>
                  <tr>
                    <th>Connection ID</th>
                    <th className={styles.alignRight}>Request Count</th>
                    <th className={styles.alignRight}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.syncRequestsByConnection.map((item) => (
                    <tr key={item.connId}>
                      <td>{item.connId}</td>
                      <td className={styles.alignRight}>{item.count}</td>
                      <td className={styles.alignRight}>
                        <button
                          className={styles.actionLink}
                          onClick={() =>
                            void navigate(`/http_requests/sync?conn=${item.connId}`)
                          }
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
