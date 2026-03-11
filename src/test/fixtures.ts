/**
 * Shared test fixtures and factory functions.
 * Use these for creating test data in unit tests to avoid duplication.
 *
 * For large-scale performance testing, use generators from performanceFixtures.ts instead.
 */
import type { ParsedLogLine, HttpRequest, SyncRequest, LogLevel } from '../types/log.types';

const DEFAULT_BASE_TIME = new Date('2024-01-15T10:00:00Z');
const MICROS_PER_MS = 1000;

/**
 * Create a single ParsedLogLine with sensible defaults.
 * All properties can be overridden.
 */
export function createParsedLogLine(
  overrides: Partial<ParsedLogLine> & { lineNumber: number }
): ParsedLogLine {
  const lineNumber = overrides.lineNumber;
  const timestamp = overrides.timestampUs !== undefined
    ? new Date(overrides.timestampUs / MICROS_PER_MS)
    : new Date(DEFAULT_BASE_TIME.getTime() + lineNumber * 1000);

  const isoTimestamp = overrides.isoTimestamp ?? timestamp.toISOString().replace(/\.\d{3}Z$/, '.000000Z');
  const displayTime = overrides.displayTime ?? (isoTimestamp.match(/T([\d:.]+)Z?$/)?.[1] || '00:00:00.000000');
  const level: LogLevel = overrides.level ?? 'INFO';
  const message = overrides.message ?? `line ${lineNumber}`;
  const strippedMessage = overrides.strippedMessage ?? message;

  return {
    lineNumber,
    rawText: overrides.rawText ?? `${isoTimestamp} ${level} ${message}`,
    isoTimestamp,
    timestampUs: overrides.timestampUs ?? timestamp.getTime() * MICROS_PER_MS,
    displayTime,
    level,
    message,
    strippedMessage,
    filePath: overrides.filePath,
    sourceLineNumber: overrides.sourceLineNumber,
  };
}

export interface CreateLogLinesOptions {
  /** Base timestamp for first line (default: 2024-01-15T10:00:00Z) */
  baseTime?: Date;
  /** Milliseconds between log lines (default: 1000) */
  intervalMs?: number;
  /** Starting line number (default: 0) */
  startLineNumber?: number;
  /** Callback to customize each line */
  customize?: (line: ParsedLogLine, index: number) => ParsedLogLine;
}

/**
 * Create multiple ParsedLogLines with sequential timestamps.
 */
export function createParsedLogLines(
  count: number,
  options: CreateLogLinesOptions = {}
): ParsedLogLine[] {
  const {
    baseTime = DEFAULT_BASE_TIME,
    intervalMs = 1000,
    startLineNumber = 0,
    customize,
  } = options;

  const lines: ParsedLogLine[] = [];
  for (let i = 0; i < count; i++) {
    const lineNumber = startLineNumber + i;
    const timestamp = new Date(baseTime.getTime() + i * intervalMs);
    const timestampUs = timestamp.getTime() * MICROS_PER_MS;
    const level: LogLevel = (['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'] as LogLevel[])[i % 5];

    let line = createParsedLogLine({
      lineNumber,
      timestampUs,
      level,
      message: `message ${lineNumber}`,
    });

    if (customize) {
      line = customize(line, i);
    }

    lines.push(line);
  }

  return lines;
}

/**
 * Create a single HttpRequest with sensible defaults.
 */
export function createHttpRequest(
  overrides: Partial<HttpRequest> & { requestId: string }
): HttpRequest {
  const lineNumber = overrides.sendLineNumber ?? 0;

  return {
    requestId: overrides.requestId,
    method: overrides.method ?? 'POST',
    uri: overrides.uri ?? `https://matrix.example.org/_matrix/client/v3/sync?request=${lineNumber}`,
    status: overrides.status ?? '200',
    requestSizeString: overrides.requestSizeString ?? '100B',
    responseSizeString: overrides.responseSizeString ?? '500B',
    requestSize: overrides.requestSize ?? 100,
    responseSize: overrides.responseSize ?? 500,
    requestDurationMs: overrides.requestDurationMs ?? 500,
    sendLineNumber: lineNumber,
    responseLineNumber: overrides.responseLineNumber ?? lineNumber + 1,
    clientError: overrides.clientError,
  };
}

/**
 * Create multiple HttpRequests.
 */
export function createHttpRequests(count: number, startIndex: number = 0): HttpRequest[] {
  return Array.from({ length: count }, (_, i) =>
    createHttpRequest({
      requestId: `REQ-${startIndex + i}`,
      sendLineNumber: (startIndex + i) * 2,
      responseLineNumber: (startIndex + i) * 2 + 1,
    })
  );
}

/**
 * Create a single SyncRequest with sensible defaults.
 */
export function createSyncRequest(
  overrides: Partial<SyncRequest> & { requestId: string }
): SyncRequest {
  const httpRequest = createHttpRequest(overrides);

  return {
    ...httpRequest,
    connId: overrides.connId ?? 'conn-1',
    timeout: overrides.timeout,
  };
}

/**
 * Create multiple SyncRequests.
 */
export function createSyncRequests(
  count: number,
  connId: string = 'conn-1',
  startIndex: number = 0
): SyncRequest[] {
  return Array.from({ length: count }, (_, i) =>
    createSyncRequest({
      requestId: `SYNC-${startIndex + i}`,
      connId,
      sendLineNumber: (startIndex + i) * 2,
      responseLineNumber: (startIndex + i) * 2 + 1,
    })
  );
}

/**
 * Create log lines where specific indices contain a search term.
 * Useful for testing search/filter functionality.
 */
export function createLogsWithMatches(
  total: number,
  matchIndices: number[],
  matchTerm: string = 'MATCH'
): ParsedLogLine[] {
  return createParsedLogLines(total, {
    customize: (line, index) => {
      if (matchIndices.includes(index)) {
        return {
          ...line,
          message: `${matchTerm} ${line.lineNumber}`,
          strippedMessage: `${matchTerm} ${line.lineNumber}`,
          rawText: `${line.isoTimestamp} ${line.level} ${matchTerm} ${line.lineNumber}`,
        };
      }
      return line;
    },
  });
}

// Re-export scale generators from performanceFixtures for convenience
export { generateLogLines, generateHttpRequests, generateSyncRequests } from './performanceFixtures';
