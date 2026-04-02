/**
 * Performance testing fixtures and generators.
 * Generates realistic log data at various scales for benchmarking parsing,
 * rendering, and filtering operations.
 */
import type { ParsedLogLine, HttpRequest, SyncRequest, LogLevel } from '../types/log.types';
import { MICROS_PER_MILLISECOND } from '../types/time.types';

const LOG_LEVELS: LogLevel[] = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR'];
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const URIS = [
  '/sync',
  '/api/v1/messages',
  '/api/v1/state',
  '/api/v1/rooms/create',
  '/api/v1/user/profile',
  '/api/v1/logout',
  '/api/v1/account/password',
];

/**
 * Create a single log line with realistic Matrix SDK format.
 * Timestamps are evenly distributed across the base time.
 */
function createLogLine(
  lineNumber: number,
  baseTimeMs: number,
  offsetMs: number = 0,
): ParsedLogLine {
  const timestampMs = baseTimeMs + offsetMs + lineNumber * 100; // 100ms apart
  const timestampUs = timestampMs * MICROS_PER_MILLISECOND;
  const date = new Date(timestampMs);
  const isoTimestamp = date.toISOString().replace(/\.\d{3}Z$/, '.000000Z'); // Pad to microseconds
  const level = LOG_LEVELS[lineNumber % LOG_LEVELS.length];
  const timeStr = isoTimestamp.match(/T([\d:.]+)Z?$/)?.[1] || isoTimestamp;
  const message = `message ${lineNumber}: processing event`;

  return {
    lineNumber,
    rawText: `${isoTimestamp} ${level} [matrix-rust-sdk] ${message}`,
    isoTimestamp,
    timestampUs,
    displayTime: timeStr,
    level,
    message,
    strippedMessage: `[matrix-rust-sdk] ${message}`,
  };
}

/**
 * Create realistic HTTP request log data.
 * Simulates request/response pairs with varying durations and outcomes.
 */
function createHttpRequest(
  requestId: string,
  lineNumber: number,
  baseTimeMs: number,
): HttpRequest {
  const requestTimeMs = baseTimeMs + lineNumber * 1000; // 1 second apart
  const responseTimeMs = requestTimeMs + (Math.random() * 500) + 50; // 50-550ms duration
  const durationMs = Math.round(responseTimeMs - requestTimeMs);

  const method = METHODS[lineNumber % METHODS.length];
  const uri = URIS[lineNumber % URIS.length];
  const status = Math.random() > 0.1 ? '200' : (Math.random() > 0.5 ? '400' : '500');
  const reqSizeBytes = Math.floor(Math.random() * 2000) + 100;
  const respSizeBytes = Math.floor(Math.random() * 5000) + 500;

  return {
    requestId,
    method,
    uri,
    status,
    requestSizeString: `${reqSizeBytes}B`,
    responseSizeString: `${respSizeBytes}B`,
    requestSize: reqSizeBytes,
    responseSize: respSizeBytes,
    requestDurationMs: durationMs,
    sendLineNumber: lineNumber,
    responseLineNumber: lineNumber + 1,
  };
}

/**
 * Create a SyncRequest (extends HttpRequest with connId).
 */
function createSyncRequest(
  requestId: string,
  connId: string,
  lineNumber: number,
  baseTimeMs: number,
): SyncRequest {
  return {
    ...createHttpRequest(requestId, lineNumber, baseTimeMs),
    connId,
  };
}

/**
 * Generate parsed log lines at a given scale.
 * Useful for benchmarking parsing and rendering performance.
 *
 * @param count - Number of log lines to generate
 * @param options - Configuration options
 * @returns Array of ParsedLogLine objects
 */
export function generateLogLines(
  count: number,
  options: { baseTimeMs?: number; seed?: number } = {},
): ParsedLogLine[] {
  const baseTimeMs = options.baseTimeMs ?? new Date('2025-01-15T10:00:00Z').getTime();
  const lines: ParsedLogLine[] = [];

  for (let i = 0; i < count; i++) {
    lines.push(createLogLine(i, baseTimeMs, 0));
  }

  return lines;
}

/**
 * Generate HTTP request data at a given scale.
 * Each request is represented as a pair of send/response lines.
 *
 * @param count - Number of requests to generate
 * @param options - Configuration options
 * @returns Array of HttpRequest objects
 */
export function generateHttpRequests(
  count: number,
  options: { baseTimeMs?: number } = {},
): HttpRequest[] {
  const baseTimeMs = options.baseTimeMs ?? new Date('2025-01-15T10:00:00Z').getTime();
  const requests: HttpRequest[] = [];

  for (let i = 0; i < count; i++) {
    const requestId = `req_${i}`;
    requests.push(createHttpRequest(requestId, i, baseTimeMs));
  }

  return requests;
}

/**
 * Generate Sync request data (requests with connection IDs).
 * Simulates Matrix Sync operations grouped by connection.
 *
 * @param count - Number of sync requests to generate
 * @param connectionsCount - Number of unique connection IDs
 * @param options - Configuration options
 * @returns Array of SyncRequest objects
 */
export function generateSyncRequests(
  count: number,
  connectionsCount: number = 5,
  options: { baseTimeMs?: number } = {},
): SyncRequest[] {
  const baseTimeMs = options.baseTimeMs ?? new Date('2025-01-15T10:00:00Z').getTime();
  const requests: SyncRequest[] = [];

  for (let i = 0; i < count; i++) {
    const requestId = `sync_${i}`;
    const connId = `conn_${i % connectionsCount}`;
    requests.push(createSyncRequest(requestId, connId, i, baseTimeMs));
  }

  return requests;
}

/**
 * Generate a complete log file (raw text) for realistic parsing tests.
 * Simulates actual Matrix SDK log output with mixed log lines and request data.
 *
 * @param totalLines - Total number of log lines to generate
 * @param requestCount - Number of HTTP/Sync requests to intersperse
 * @returns Raw log text (newline-separated)
 */
export function generateLogContent(
  totalLines: number,
  requestCount: number = 100,
): string {
  const baseTimeMs = new Date('2025-01-15T10:00:00Z').getTime();
  const lines: string[] = [];

  const logLines = generateLogLines(totalLines, { baseTimeMs });
  const httpRequests = generateHttpRequests(requestCount, { baseTimeMs });

  // Interleave log lines and requests
  let logIdx = 0;
  let reqIdx = 0;
  const logLinesPerRequest = Math.floor(totalLines / requestCount);

  for (let i = 0; i < totalLines; i++) {
    if (i > 0 && i % logLinesPerRequest === 0 && reqIdx < httpRequests.length) {
      const req = httpRequests[reqIdx++];
      const requestTimeMs = baseTimeMs + req.sendLineNumber * 1000;
      const responseTimeMs = requestTimeMs + req.requestDurationMs;
      const requestDate = new Date(requestTimeMs);
      const responseDate = new Date(responseTimeMs);
      
      // Add send line
      lines.push(`${requestDate.toISOString()} INFO send{request_id="${req.requestId}" method=${req.method} uri="${req.uri}" request_size="${req.requestSizeString}"}`);
      // Add response line
      lines.push(`${responseDate.toISOString()} INFO send{request_id="${req.requestId}" method=${req.method} uri="${req.uri}" request_size="${req.requestSizeString}" status=${req.status} response_size="${req.responseSizeString}" request_duration=${(req.requestDurationMs / 1000).toFixed(2)}s}`);
    }

    if (logIdx < logLines.length) {
      lines.push(logLines[logIdx++].rawText);
    }
  }

  // Add remaining requests
  while (reqIdx < httpRequests.length) {
    const req = httpRequests[reqIdx++];
    const requestTimeMs = baseTimeMs + req.sendLineNumber * 1000;
    const responseTimeMs = requestTimeMs + req.requestDurationMs;
    const requestDate = new Date(requestTimeMs);
    const responseDate = new Date(responseTimeMs);
    
    lines.push(`${requestDate.toISOString()} INFO send{request_id="${req.requestId}" method=${req.method} uri="${req.uri}" request_size="${req.requestSizeString}"}`);
    lines.push(`${responseDate.toISOString()} INFO send{request_id="${req.requestId}" method=${req.method} uri="${req.uri}" request_size="${req.requestSizeString}" status=${req.status} response_size="${req.responseSizeString}" request_duration=${(req.requestDurationMs / 1000).toFixed(2)}s}`);
  }

  return lines.join('\n');
}

/**
 * Test data scale presets for consistent benchmarking.
 */
export const PERF_TEST_SCALES = {
  small: 1_000, // 1K lines - quick validation
  medium: 10_000, // 10K lines - typical session
  large: 100_000, // 100K lines - sustained session
  veryLarge: 1_000_000, // 1M lines - stress test (optional, slow)
};
