import type { HttpRequest, SyncRequest, LogParserResult, ParsedLogLine, LogLevel } from '../types/log.types';
import type { ISODateTimeString, TimestampMicros } from '../types/time.types';
import { isoToMicros, extractTimeFromISO } from './timeUtils';
import { parseSizeString } from './sizeUtils';
import { ParsingError } from './errorHandling';

// Regex patterns for parsing HTTP requests - generic (all URIs)
const HTTP_RESP_RE = /send\{request_id="(?<id>[^"]+)"\s+method=(?<method>\S+)\s+uri="(?<uri>[^"]+)"\s+request_size="(?<req_size>[^"]+)"\s+status=(?<status>\S+)\s+response_size="(?<resp_size>[^"]+)"\s+request_duration=(?<duration_val>[0-9.]+)(?<duration_unit>ms|s)/;
const HTTP_SEND_RE = /send\{request_id="(?<id>[^"]+)"\s+method=(?<method>\S+)\s+uri="(?<uri>[^"]+)"\s+request_size="(?<req_size>[^"]+)"(?![^}]*(?:status=|response_size=|request_duration=))/;

// Pattern for extracting log level - matches common Rust log formats
const LOG_LEVEL_RE = /\s(TRACE|DEBUG|INFO|WARN|ERROR)\s/;

function extractLogLevel(line: string): LogLevel {
  const match = line.match(LOG_LEVEL_RE);
  return match ? (match[1] as LogLevel) : 'UNKNOWN';
}

function stripMessagePrefix(message: string): string {
  // Strip timestamp, log level, and common prefixes to get the actual message content
  const stripped = message
    .replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\s+/, '') // ISO timestamp
    .replace(/^\d{2}:\d{2}:\d{2}\.\d+Z?\s+/, '') // Time-only timestamp
    .replace(/\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+/, ' '); // Log level
  return stripped.trim();
}

/**
 * Extract ISO timestamp from a log line.
 * Returns the full ISO 8601 datetime string.
 */
function extractISOTimestamp(line: string): ISODateTimeString {
  // Match full ISO timestamp: YYYY-MM-DDTHH:MM:SS[.fraction]Z?
  const isoMatch = line.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/);
  if (isoMatch) {
    // Ensure it ends with Z for consistency
    const timestamp = isoMatch[0];
    return timestamp.endsWith('Z') ? timestamp : `${timestamp}Z`;
  }
  return '';
}

/**
 * Format timestamp for display (time-only portion).
 */
function formatDisplayTime(isoTimestamp: ISODateTimeString): string {
  if (!isoTimestamp) return '';
  return extractTimeFromISO(isoTimestamp);
}

/**
 * Parse ISO timestamp to microseconds.
 */
function parseTimestampMicros(isoTimestamp: ISODateTimeString): TimestampMicros {
  return isoToMicros(isoTimestamp);
}

export interface AllHttpRequestsResult {
  httpRequests: HttpRequest[];
  rawLogLines: ParsedLogLine[];
}

export function parseAllHttpRequests(logContent: string): AllHttpRequestsResult {
  // Validate input
  if (!logContent || logContent.trim().length === 0) {
    throw new ParsingError('Log file is empty', 'error');
  }

  const lines = logContent.split('\n');
  // Map from requestId to all in-progress records for that ID.
  // Multiple requests can share the same requestId; each gets its own record.
  const recordsByRequestId = new Map<string, Partial<HttpRequest>[]>();
  // Flat list preserving insertion order for final output.
  const allRecordsList: Partial<HttpRequest>[] = [];
  const rawLogLines: ParsedLogLine[] = [];
  let linesWithTimestamps = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Parse every line for the raw log view
    if (line.trim()) {
      const isoTimestamp = extractISOTimestamp(line);
      const level = extractLogLevel(line);
      const timestampUs = parseTimestampMicros(isoTimestamp);
      const displayTime = formatDisplayTime(isoTimestamp);
      const strippedMessage = stripMessagePrefix(line);
      
      if (isoTimestamp) {
        linesWithTimestamps++;
      }
      
      rawLogLines.push({
        lineNumber: i + 1,
        rawText: line,
        isoTimestamp,
        timestampUs,
        displayTime,
        level,
        message: line,
        strippedMessage,
      });
    }

    // Early filter for performance - look for HTTP request patterns
    if (!line.includes('request_id=') || !line.includes('send{')) {
      continue;
    }

    // Try to match response pattern first
    const respMatch = line.match(HTTP_RESP_RE);
    if (respMatch && respMatch.groups) {
      const requestId = respMatch.groups.id;
      const durationVal = parseFloat(respMatch.groups.duration_val);
      const durationUnit = respMatch.groups.duration_unit;
      const durationMs = Math.round(durationVal * (durationUnit === 's' ? 1000.0 : 1.0));

      if (!recordsByRequestId.has(requestId)) {
        recordsByRequestId.set(requestId, []);
      }
      const bucket = recordsByRequestId.get(requestId)!;

      // Find the last record for this requestId that hasn't received a response yet.
      // This correctly pairs a response with its corresponding send line even when
      // multiple requests share the same requestId.
      let rec = [...bucket].reverse().find(r => !r.responseLineNumber);
      if (!rec) {
        // Response with no matching send: create a new record.
        rec = {};
        bucket.push(rec);
        allRecordsList.push(rec);
      }

      rec.requestId = requestId;
      rec.method = rec.method || respMatch.groups.method;
      rec.uri = rec.uri || respMatch.groups.uri;
      rec.status = rec.status || respMatch.groups.status;
      rec.responseSizeString = rec.responseSizeString || respMatch.groups.resp_size;
      rec.requestSizeString = rec.requestSizeString || respMatch.groups.req_size;
      rec.requestDurationMs = rec.requestDurationMs || durationMs;
      rec.responseLineNumber = i + 1;
      continue;
    }

    // Try to match send pattern
    const sendMatch = line.match(HTTP_SEND_RE);
    if (sendMatch && sendMatch.groups) {
      const requestId = sendMatch.groups.id;

      if (!recordsByRequestId.has(requestId)) {
        recordsByRequestId.set(requestId, []);
      }
      const bucket = recordsByRequestId.get(requestId)!;

      // Find the last record for this requestId that has NO sendLineNumber.
      // This handles out-of-order logs where a response line appears before
      // its matching send: in that case the response already created a record,
      // and we pair the send into it instead of creating a duplicate.
      // If all existing records already have a send, this is a new independent
      // request sharing the same requestId, so we create a fresh record.
      let rec = [...bucket].reverse().find(r => !r.sendLineNumber) ?? null;
      if (!rec) {
        rec = {};
        bucket.push(rec);
        allRecordsList.push(rec);
      }

      rec.requestId = requestId;
      rec.method = sendMatch.groups.method;
      rec.uri = sendMatch.groups.uri;
      rec.requestSizeString = sendMatch.groups.req_size;
      rec.sendLineNumber = i + 1;
    }
  }

  // Validate that we found at least some timestamps
  const timestampPercentage = rawLogLines.length > 0 ? (linesWithTimestamps / rawLogLines.length) * 100 : 0;
  if (rawLogLines.length > 100 && timestampPercentage < 10) {
    throw new ParsingError(
      'Log file appears to be invalid. Please ensure this is a Matrix Rust SDK log file.',
      'error'
    );
  }

  // Filter and convert to array - include any request with at least a send or response line
  const allRequests = allRecordsList.filter(
    (rec): rec is HttpRequest =>
      !!rec.uri && (!!rec.sendLineNumber || !!rec.responseLineNumber)
  ) as HttpRequest[];

  // Fill in missing fields with empty strings or default values
  allRequests.forEach((rec) => {
    rec.method = rec.method || '';
    rec.uri = rec.uri || '';
    rec.status = rec.status || '';
    rec.requestSizeString = rec.requestSizeString || '';
    rec.responseSizeString = rec.responseSizeString || '';
    rec.requestSize = parseSizeString(rec.requestSizeString);
    rec.responseSize = parseSizeString(rec.responseSizeString);
    rec.requestDurationMs = rec.requestDurationMs || 0;
    rec.sendLineNumber = rec.sendLineNumber || 0;
    rec.responseLineNumber = rec.responseLineNumber || 0;
  });

  // Sort requests by start time (sendLineNumber) to ensure chronological order
  allRequests.sort((a, b) => a.sendLineNumber - b.sendLineNumber);

  return {
    httpRequests: allRequests,
    rawLogLines,
  };
}

export function parseLogFile(logContent: string): LogParserResult {
  // First parse all HTTP requests
  const { httpRequests, rawLogLines } = parseAllHttpRequests(logContent);

  // Filter for sync-specific requests and add connId
  const syncRequests: SyncRequest[] = [];
  const lines = logContent.split('\n');

  // Build a map of request_id to sync metadata by scanning lines again
  const syncMetadataMap = new Map<string, { connId?: string; timeout?: number }>();
  for (const line of lines) {
    if (line.includes('request_id=') && line.includes('/sync')) {
      const reqIdMatch = line.match(/request_id="([^"]+)"/);
      const connMatch = line.match(/conn_id="([^"]+)"/);
      const timeoutMatch = line.match(/\btimeout=([+-]?\d+(?:\.\d+)?)/);

      if (reqIdMatch) {
        const requestId = reqIdMatch[1];
        const existingMetadata = syncMetadataMap.get(requestId) || {};
        const parsedTimeout = timeoutMatch ? Number(timeoutMatch[1]) : undefined;

        syncMetadataMap.set(requestId, {
          connId: connMatch?.[1] || existingMetadata.connId,
          timeout: parsedTimeout ?? existingMetadata.timeout,
        });
      }
    }
  }

  // Filter HTTP requests for sync URIs and add connId
  for (const httpReq of httpRequests) {
    if (httpReq.uri.includes('/sync')) {
      const metadata = syncMetadataMap.get(httpReq.requestId);
      const connId = metadata?.connId || '';

      // Extract timeout from span metadata first, fall back to URI query param.
      // The URI may contain ?timeout=30000 as a query parameter even when the
      // span attributes are not on the same log line as the /sync URI.
      let timeout = metadata?.timeout;
      if (timeout === undefined) {
        const uriTimeoutMatch = httpReq.uri.match(/[?&]timeout=(\d+(?:\.\d+)?)/);
        if (uriTimeoutMatch) {
          timeout = Number(uriTimeoutMatch[1]);
        }
      }

      syncRequests.push({
        ...httpReq,
        connId,
        timeout,
      });
    }
  }

  // Extract unique connection IDs
  const connectionIds = [
    ...new Set(syncRequests.map((r) => r.connId).filter((c) => c)),
  ];

  return {
    requests: syncRequests,
    connectionIds,
    rawLogLines,
  };
}
