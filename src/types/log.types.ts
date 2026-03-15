import type { TimestampMicros, ISODateTimeString } from './time.types';

export interface HttpRequest {
  readonly requestId: string;
  readonly method: string;
  readonly uri: string;
  readonly status: string;
  readonly requestSizeString: string;
  readonly responseSizeString: string;
  readonly requestSize: number;
  readonly responseSize: number;
  readonly requestDurationMs: number;
  readonly sendLineNumber: number;
  readonly responseLineNumber: number;
  /** Client-side transport error (e.g., "TimedOut", "Connect") when the request failed without receiving an HTTP response */
  readonly clientError?: string;
}

export interface SyncRequest extends HttpRequest {
  readonly connId: string;
  readonly timeout?: number;
}

/**
 * An HTTP request enriched with its resolved timestamp in microseconds.
 * Stored in {@link SummaryStats.httpRequestsWithTimestamps} and consumed by
 * `HttpActivityChart` to plot request density over time.
 */
export interface HttpRequestWithTimestamp {
  readonly requestId: string;
  readonly status: string;
  readonly timestampUs: TimestampMicros;
  /** Timeout in ms when this is a /sync request; 0 = catch-up, ≥30000 = long-poll. */
  readonly timeout?: number;
}

export interface SentryEvent {
  readonly platform: 'android' | 'ios';
  readonly lineNumber: number;
  readonly message: string;
  /** Hex crash ID, present for iOS crash reports only */
  readonly sentryId?: string;
  /** Direct link to the Sentry issue, present for iOS crash reports only */
  readonly sentryUrl?: string;
}

export interface LogParserResult {
  readonly requests: SyncRequest[];
  readonly httpRequests: HttpRequest[];
  readonly connectionIds: string[];
  readonly rawLogLines: ParsedLogLine[];
  readonly sentryEvents: SentryEvent[];
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
  readonly lineNumber: number;
  readonly rawText: string;
  /** Original ISO 8601 timestamp from log (e.g., "2026-01-26T16:01:13.382222Z") */
  readonly isoTimestamp: ISODateTimeString;
  /** Microseconds since Unix epoch - for time calculations */
  readonly timestampUs: TimestampMicros;
  /** Pre-formatted time for display (HH:MM:SS.ssssss) */
  readonly displayTime: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly strippedMessage: string;
  /** Source file path extracted from log (e.g., "ClientProxy.swift" or "crates/matrix-sdk/src/http_client/native.rs") */
  readonly filePath?: string;
  /** Source file line number extracted from log */
  readonly sourceLineNumber?: number;
}

export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'UNKNOWN';
