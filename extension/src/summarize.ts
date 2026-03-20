import { parseLogFile } from '../../src/utils/logParser';
import { parseSizeString } from '../../src/utils/sizeUtils';
import type { LogParserResult } from '../../src/types/log.types';

/**
 * A compact statistical summary derived from a single parsed log file.
 * All counts are derived purely from the `LogParserResult` produced by the
 * shared `parseLogFile` utility — no extra parsing logic lives here.
 *
 * Used by the browser extension content script to replace raw `.log.gz` links
 * on rageshakes listing pages with human-readable summary cards.
 */
export interface LogSummary {
  /** Total number of non-blank log lines. */
  readonly totalLines: number;
  /** Lines whose log level is ERROR. */
  readonly errorCount: number;
  /** Lines whose log level is WARN. */
  readonly warnCount: number;
  /** Number of Sentry event links detected in the log. */
  readonly sentryCount: number;
  /** Total number of completed HTTP requests (send + response pairs). */
  readonly httpCount: number;
  /** Total upload bytes across all HTTP requests (sum of request sizes). */
  readonly totalUploadBytes: number;
  /** Total download bytes across all HTTP requests (sum of response sizes). */
  readonly totalDownloadBytes: number;
  /**
   * Map of HTTP status code (or synthetic key such as "incomplete" / "client-error")
   * to the count of requests with that status.
   *
   * @example { "200": 42, "404": 3, "client-error": 1 }
   */
  readonly statusCodes: Readonly<Record<string, number>>;
}

/**
 * Derive a `LogSummary` from already-parsed log content.
 *
 * Prefer `summarizeLog` when you already have the raw text string; this
 * function is exposed separately for callers that already hold a
 * `LogParserResult` (e.g. unit tests that want to avoid re-parsing).
 *
 * @example
 * const result = parseLogFile(rawLogText);
 * const summary = summarizeLogResult(result);
 */
export function summarizeLogResult(result: LogParserResult): LogSummary {
  const { rawLogLines, httpRequests, sentryEvents } = result;

  let errorCount = 0;
  let warnCount = 0;
  for (const line of rawLogLines) {
    if (line.level === 'ERROR') errorCount++;
    else if (line.level === 'WARN') warnCount++;
  }

  let totalUploadBytes = 0;
  let totalDownloadBytes = 0;
  const statusCodes: Record<string, number> = {};

  for (const req of httpRequests) {
    totalUploadBytes += parseSizeString(req.requestSizeString ?? '');
    totalDownloadBytes += parseSizeString(req.responseSizeString ?? '');

    const code = req.clientError ? `client-error` : (req.status || 'incomplete');
    statusCodes[code] = (statusCodes[code] ?? 0) + 1;
  }

  return {
    totalLines: rawLogLines.length,
    errorCount,
    warnCount,
    sentryCount: sentryEvents.length,
    httpCount: httpRequests.length,
    totalUploadBytes,
    totalDownloadBytes,
    statusCodes,
  };
}

/**
 * Parse `rawLogText` and return a `LogSummary` describing its contents.
 *
 * This is the main entry point called by the extension background service
 * worker after decompressing a `.log.gz` file fetched from the rageshakes
 * listing page.
 *
 * Returns a zero-filled summary for empty or blank input rather than throwing,
 * so the extension content script can always render a card without error handling
 * for edge cases like zero-byte log files.
 *
 * @example
 * const summary = summarizeLog(decompressedText);
 * // { totalLines: 9843, errorCount: 2, warnCount: 17, ... }
 */
export function summarizeLog(rawLogText: string): LogSummary {
  if (!rawLogText.trim()) {
    return {
      totalLines: 0,
      errorCount: 0,
      warnCount: 0,
      sentryCount: 0,
      httpCount: 0,
      totalUploadBytes: 0,
      totalDownloadBytes: 0,
      statusCodes: {},
    };
  }
  const result = parseLogFile(rawLogText);
  return summarizeLogResult(result);
}
