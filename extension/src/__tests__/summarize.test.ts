/**
 * Unit tests for extension/src/summarize.ts
 *
 * Verifies that `summarizeLog` correctly counts log levels, Sentry events,
 * HTTP request stats, and status codes using realistic raw log text that
 * exercises the shared `parseLogFile` utility.
 */
import { describe, it, expect } from 'vitest';
import { summarizeLog, summarizeLogResult } from '../summarize';
import { parseLogFile } from '../../../src/utils/logParser';

// ── Minimal realistic log snippets ────────────────────────────────────────────

/** A log with 3 lines: INFO, WARN, ERROR — no HTTP, no Sentry. */
const SIMPLE_LOG = `\
2026-03-01T10:00:00.000000Z  INFO matrix_sdk::client | ClientProxy.swift:10 | App started
2026-03-01T10:00:01.000000Z  WARN matrix_sdk::client | ClientProxy.swift:11 | Retry scheduled
2026-03-01T10:00:02.000000Z ERROR matrix_sdk::client | ClientProxy.swift:12 | Something failed
`;

/** A log with two completed HTTP requests:
 *   - GET /sync → 200, request_size="100B", response_size="1.0k"
 *   - POST /send → 429, request_size="200B", response_size="50B"
 */
const HTTP_LOG = `\
2026-03-01T10:00:00.000000Z  INFO opentelemetry: Sending request send{request_id="req-1" method=GET uri="https://matrix.org/_matrix/client/v3/sync" request_size="100B"} num_attempt=1
2026-03-01T10:00:01.000000Z  INFO opentelemetry: Got response send{request_id="req-1" method=GET uri="https://matrix.org/_matrix/client/v3/sync" request_size="100B" status=200 response_size="1.0k" request_duration=42ms}
2026-03-01T10:00:02.000000Z  INFO opentelemetry: Sending request send{request_id="req-2" method=POST uri="https://matrix.org/_matrix/client/v3/send" request_size="200B"} num_attempt=1
2026-03-01T10:00:03.000000Z  INFO opentelemetry: Got response send{request_id="req-2" method=POST uri="https://matrix.org/_matrix/client/v3/send" request_size="200B" status=429 response_size="50B" request_duration=10ms}
`;

/**
 * A log with one iOS Sentry crash report.
 * The parser matches: "Sentry detected a crash in the previous run: <hex id>"
 */
const SENTRY_IOS_LOG = `\
2026-03-01T10:00:00.000000Z  INFO matrix_sdk_crypto: Sentry detected a crash in the previous run: abc123def456
`;

/**
 * A log with one Android Sentry event.
 * The parser matches lines containing "Sending error to Sentry".
 */
const SENTRY_ANDROID_LOG = `\
2026-03-01T10:00:00.000000Z  INFO io.sentry: Sending error to Sentry with message: something went wrong
`;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('summarizeLog', () => {
  describe('log level counts', () => {
    it('counts errors and warnings correctly', () => {
      const summary = summarizeLog(SIMPLE_LOG);
      expect(summary.errorCount).toBe(1);
      expect(summary.warnCount).toBe(1);
    });

    it('does not count INFO as error or warn', () => {
      const summary = summarizeLog(SIMPLE_LOG);
      expect(summary.totalLines).toBe(3);
      expect(summary.errorCount + summary.warnCount).toBe(2);
    });

    it('returns zero counts on empty log', () => {
      const summary = summarizeLog('');
      expect(summary.totalLines).toBe(0);
      expect(summary.errorCount).toBe(0);
      expect(summary.warnCount).toBe(0);
      expect(summary.sentryCount).toBe(0);
      expect(summary.httpCount).toBe(0);
    });
  });

  describe('HTTP request stats', () => {
    it('counts HTTP requests', () => {
      const summary = summarizeLog(HTTP_LOG);
      expect(summary.httpCount).toBe(2);
    });

    it('sums upload bytes correctly', () => {
      // req-1: 100B + req-2: 200B = 300
      const summary = summarizeLog(HTTP_LOG);
      expect(summary.totalUploadBytes).toBe(300);
    });

    it('sums download bytes correctly', () => {
      // req-1: 1.0k = 1024 + req-2: 50B = 1074
      const summary = summarizeLog(HTTP_LOG);
      expect(summary.totalDownloadBytes).toBe(1024 + 50);
    });

    it('builds status code map correctly', () => {
      const summary = summarizeLog(HTTP_LOG);
      expect(summary.statusCodes['200']).toBe(1);
      expect(summary.statusCodes['429']).toBe(1);
    });

    it('returns zero HTTP stats on plain log', () => {
      const summary = summarizeLog(SIMPLE_LOG);
      expect(summary.httpCount).toBe(0);
      expect(summary.totalUploadBytes).toBe(0);
      expect(summary.totalDownloadBytes).toBe(0);
      expect(Object.keys(summary.statusCodes)).toHaveLength(0);
    });
  });

  describe('Sentry event counts', () => {
    it('counts iOS Sentry events', () => {
      const summary = summarizeLog(SENTRY_IOS_LOG);
      expect(summary.sentryCount).toBe(1);
    });

    it('returns zero Sentry count on plain log', () => {
      const summary = summarizeLog(SIMPLE_LOG);
      expect(summary.sentryCount).toBe(0);
    });
  });
});

describe('summarizeLogResult', () => {
  it('produces the same result as summarizeLog on the same input', () => {
    const text = SIMPLE_LOG + HTTP_LOG;
    const fromText = summarizeLog(text);
    const fromResult = summarizeLogResult(parseLogFile(text));
    expect(fromResult).toEqual(fromText);
  });

  it('client-error requests appear under the "client-error" key', () => {
    // A log where address lookup fails — no HTTP response, just a client error.
    const clientErrorLog = `\
2026-03-01T10:00:00.000000Z ERROR matrix_sdk: Error while sending request send{request_id="req-e" method=GET uri="https://matrix.org/_matrix/client/v3/sync"} source: Connect
`;
    const summary = summarizeLog(clientErrorLog);
    expect(summary.statusCodes['client-error']).toBe(1);
  });

  it('requests with an empty status string are counted as "incomplete"', () => {
    // Simulate a parsed result where status is "" (e.g. a timeout with no
    // HTTP response status line recorded — the parser may emit an empty string
    // rather than undefined/null). The chip must show "incomplete", not "".
    const result = parseLogFile(HTTP_LOG);
    // Override one request's status to an empty string to reproduce the bug.
    const patchedRequests = result.httpRequests.map((r, i) =>
      i === 0 ? { ...r, status: '' } : r
    );
    const patched = { ...result, httpRequests: patchedRequests };
    const summary = summarizeLogResult(patched);
    expect(summary.statusCodes['']).toBeUndefined();
    expect(summary.statusCodes['incomplete']).toBeGreaterThanOrEqual(1);
  });
});
