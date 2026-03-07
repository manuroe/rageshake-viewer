import type { TimestampMicros, ISODateTimeString } from './time.types';

export interface HttpRequest {
  requestId: string;
  method: string;
  uri: string;
  status: string;
  requestSizeString: string;
  responseSizeString: string;
  requestSize: number;
  responseSize: number;
  requestDurationMs: number;
  sendLineNumber: number;
  responseLineNumber: number;
}

export interface SyncRequest extends HttpRequest {
  connId: string;
  timeout?: number;
}

export interface SentryEvent {
  platform: 'android' | 'ios';
  lineNumber: number;
  message: string;
  /** Hex crash ID, present for iOS crash reports only */
  sentryId?: string;
  /** Direct link to the Sentry issue, present for iOS crash reports only */
  sentryUrl?: string;
}

export interface LogParserResult {
  requests: SyncRequest[];
  httpRequests: HttpRequest[];
  connectionIds: string[];
  rawLogLines: ParsedLogLine[];
  sentryEvents: SentryEvent[];
}

/**
 * A parsed log line with extracted timestamp and metadata.
 * 
 * Timestamps are stored as:
 * - `isoTimestamp`: Original ISO 8601 string from the log
 * - `timestampUs`: Microseconds since epoch (for calculations)
 * - `displayTime`: Time-only string for display (HH:MM:SS.ssssss)
 */
export interface ParsedLogLine {
  lineNumber: number;
  rawText: string;
  /** Original ISO 8601 timestamp from log (e.g., "2026-01-26T16:01:13.382222Z") */
  isoTimestamp: ISODateTimeString;
  /** Microseconds since Unix epoch - for time calculations */
  timestampUs: TimestampMicros;
  /** Pre-formatted time for display (HH:MM:SS.ssssss) */
  displayTime: string;
  level: LogLevel;
  message: string;
  strippedMessage: string;
}

export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'UNKNOWN';
