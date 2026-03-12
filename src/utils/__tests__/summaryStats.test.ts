/**
 * Unit tests for computeSummaryStats.
 *
 * The function is pure — no React, no store, no network — so we can drive it
 * with simple fixture data and assert on concrete output values.
 */
import { describe, it, expect } from 'vitest';
import { computeSummaryStats } from '../summaryStats';
import {
  createParsedLogLine,
  createHttpRequest,
  createSyncRequest,
} from '../../test/fixtures';
import type { ParsedLogLine } from '../../types/log.types';
import type { TimestampMicros } from '../../types/time.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_US = 1_700_000_000_000_000 as TimestampMicros;
const STEP_US = 5_000_000 as TimestampMicros; // 5 s per line

/** Build N log lines with deterministic timestamps starting from BASE_US. */
function makeLines(count: number): ParsedLogLine[] {
  return Array.from({ length: count }, (_, i) =>
    createParsedLogLine({
      lineNumber: i,
      timestampUs: (BASE_US + i * STEP_US) as TimestampMicros,
    })
  );
}

/** Build a precomputed lineNumberIndex as a Map, like logStore does. */
function buildIndex(lines: ParsedLogLine[]): Map<number, ParsedLogLine> {
  const map = new Map<number, ParsedLogLine>();
  for (const line of lines) map.set(line.lineNumber, line);
  return map;
}

const EMPTY_RESULT = computeSummaryStats([], [], [], [], [], null, null, null, new Map());

// ---------------------------------------------------------------------------
// Empty / no-data
// ---------------------------------------------------------------------------

describe('computeSummaryStats — no data', () => {
  it('returns all-zero stats when rawLogLines is empty', () => {
    expect(EMPTY_RESULT.totalLogLines).toBe(0);
    expect(EMPTY_RESULT.errors).toBe(0);
    expect(EMPTY_RESULT.warnings).toBe(0);
    expect(EMPTY_RESULT.httpRequestsWithTimestamps).toHaveLength(0);
    expect(EMPTY_RESULT.sentryEvents).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Log line counting and time range filtering
// ---------------------------------------------------------------------------

describe('computeSummaryStats — totalLogLines', () => {
  it('counts all lines when no time filter is active', () => {
    const lines = makeLines(7);
    const result = computeSummaryStats(lines, [], [], [], [], null, null, null, buildIndex(lines));
    expect(result.totalLogLines).toBe(7);
  });

  it('counts only lines within a local time range', () => {
    const lines = makeLines(5);
    // Include only lines 1–3 (indices 1, 2, 3)
    const localRange = {
      startUs: lines[1].timestampUs,
      endUs: lines[3].timestampUs,
    };
    const result = computeSummaryStats(lines, [], [], [], [], null, null, localRange, buildIndex(lines));
    expect(result.totalLogLines).toBe(3);
    expect(result.filteredLogLines[0].lineNumber).toBe(1);
    expect(result.filteredLogLines[2].lineNumber).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Error and warning counting
// ---------------------------------------------------------------------------

describe('computeSummaryStats — error / warning counts', () => {
  it('counts ERROR and WARN lines correctly', () => {
    const lines = [
      createParsedLogLine({ lineNumber: 0, timestampUs: BASE_US, level: 'ERROR', message: 'Oops' }),
      createParsedLogLine({ lineNumber: 1, timestampUs: (BASE_US + STEP_US) as TimestampMicros, level: 'WARN', message: 'Careful' }),
      createParsedLogLine({ lineNumber: 2, timestampUs: (BASE_US + 2 * STEP_US) as TimestampMicros, level: 'INFO', message: 'All good' }),
      createParsedLogLine({ lineNumber: 3, timestampUs: (BASE_US + 3 * STEP_US) as TimestampMicros, level: 'ERROR', message: 'Oops' }),
    ];
    const result = computeSummaryStats(lines, [], [], [], [], null, null, null, buildIndex(lines));
    expect(result.errors).toBe(2);
    expect(result.warnings).toBe(1);
  });

  it('groups duplicate error messages and sorts by frequency', () => {
    const lines = [
      createParsedLogLine({ lineNumber: 0, timestampUs: BASE_US, level: 'ERROR', message: 'Timeout' }),
      createParsedLogLine({ lineNumber: 1, timestampUs: (BASE_US + STEP_US) as TimestampMicros, level: 'ERROR', message: 'Timeout' }),
      createParsedLogLine({ lineNumber: 2, timestampUs: (BASE_US + 2 * STEP_US) as TimestampMicros, level: 'ERROR', message: 'Unique error' }),
    ];
    const result = computeSummaryStats(lines, [], [], [], [], null, null, null, buildIndex(lines));
    expect(result.errorsByType[0].type).toBe('Timeout');
    expect(result.errorsByType[0].count).toBe(2);
    expect(result.errorsByType[1].type).toBe('Unique error');
  });

  it('caps errorsByType at 5 entries', () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      createParsedLogLine({
        lineNumber: i,
        timestampUs: (BASE_US + i * STEP_US) as TimestampMicros,
        level: 'ERROR',
        message: `Error type ${i}`,
      })
    );
    const result = computeSummaryStats(lines, [], [], [], [], null, null, null, buildIndex(lines));
    expect(result.errorsByType.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// HTTP error by status
// ---------------------------------------------------------------------------

describe('computeSummaryStats — httpErrorsByStatus', () => {
  it('counts 4xx and 5xx HTTP errors', () => {
    const rawLines = makeLines(6);
    const index = buildIndex(rawLines);

    const requests = [
      createHttpRequest({ requestId: 'R1', status: '200', responseLineNumber: 0 }),
      createHttpRequest({ requestId: 'R2', status: '404', responseLineNumber: 1 }),
      createHttpRequest({ requestId: 'R3', status: '500', responseLineNumber: 2 }),
      createHttpRequest({ requestId: 'R4', status: '500', responseLineNumber: 3 }),
    ];

    const result = computeSummaryStats(rawLines, requests, [], [], [], null, null, null, index);

    const statusTypes = result.httpErrorsByStatus.map((e) => e.status);
    expect(statusTypes).toContain('500');
    expect(statusTypes).toContain('404');
    expect(statusTypes).not.toContain('200');

    const fiveHundred = result.httpErrorsByStatus.find((e) => e.status === '500');
    expect(fiveHundred?.count).toBe(2);
  });

  it('excludes 2xx and 3xx from httpErrorsByStatus', () => {
    const rawLines = makeLines(3);
    const index = buildIndex(rawLines);

    const requests = [
      createHttpRequest({ requestId: 'R1', status: '200', responseLineNumber: 0 }),
      createHttpRequest({ requestId: 'R2', status: '301', responseLineNumber: 1 }),
    ];

    const result = computeSummaryStats(rawLines, requests, [], [], [], null, null, null, index);
    expect(result.httpErrorsByStatus).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Slowest HTTP requests
// ---------------------------------------------------------------------------

describe('computeSummaryStats — slowestHttpRequests', () => {
  it('returns requests sorted by duration, longest first', () => {
    const rawLines = makeLines(4);
    const index = buildIndex(rawLines);

    const requests = [
      createHttpRequest({ requestId: 'R1', uri: '/rooms', requestDurationMs: 100, responseLineNumber: 0 }),
      createHttpRequest({ requestId: 'R2', uri: '/messages', requestDurationMs: 5000, responseLineNumber: 1 }),
      createHttpRequest({ requestId: 'R3', uri: '/profile', requestDurationMs: 200, responseLineNumber: 2 }),
    ];

    const result = computeSummaryStats(rawLines, requests, [], [], [], null, null, null, index);
    expect(result.slowestHttpRequests[0].duration).toBe(5000);
    expect(result.slowestHttpRequests[0].id).toBe('R2');
  });

  it('excludes /sync requests from the slowest list', () => {
    const rawLines = makeLines(3);
    const index = buildIndex(rawLines);

    const requests = [
      createHttpRequest({ requestId: 'SYNC', uri: '/sync', requestDurationMs: 99999, responseLineNumber: 0 }),
      createHttpRequest({ requestId: 'OTHER', uri: '/rooms', requestDurationMs: 50, responseLineNumber: 1 }),
    ];

    const result = computeSummaryStats(rawLines, requests, [], [], [], null, null, null, index);
    const ids = result.slowestHttpRequests.map((r) => r.id);
    expect(ids).not.toContain('SYNC');
    expect(ids).toContain('OTHER');
  });

  it('caps slowestHttpRequests at 10 entries', () => {
    const rawLines = makeLines(20);
    const index = buildIndex(rawLines);

    const requests = rawLines.map((_, i) =>
      createHttpRequest({
        requestId: `R${i}`,
        uri: `/path/${i}`,
        requestDurationMs: i * 10,
        responseLineNumber: i,
      })
    );

    const result = computeSummaryStats(rawLines, requests, [], [], [], null, null, null, index);
    expect(result.slowestHttpRequests.length).toBeLessThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------
// Sync requests by connection
// ---------------------------------------------------------------------------

describe('computeSummaryStats — syncRequestsByConnection', () => {
  it('groups sync requests by connId and sorts descending', () => {
    const rawLines = makeLines(5);
    const index = buildIndex(rawLines);

    const syncRequests = [
      createSyncRequest({ requestId: 'S1', connId: 'room-list', responseLineNumber: 0 }),
      createSyncRequest({ requestId: 'S2', connId: 'room-list', responseLineNumber: 1 }),
      createSyncRequest({ requestId: 'S3', connId: 'encryption', responseLineNumber: 2 }),
    ];

    const result = computeSummaryStats(
      rawLines, [], syncRequests, ['room-list', 'encryption'], [], null, null, null, index
    );

    expect(result.syncRequestsByConnection[0].connId).toBe('room-list');
    expect(result.syncRequestsByConnection[0].count).toBe(2);
    expect(result.syncRequestsByConnection[1].connId).toBe('encryption');
    expect(result.syncRequestsByConnection[1].count).toBe(1);
  });

  it('omits connections with zero requests from the result', () => {
    const rawLines = makeLines(2);
    const index = buildIndex(rawLines);

    const syncRequests = [
      createSyncRequest({ requestId: 'S1', connId: 'active', responseLineNumber: 0 }),
    ];

    const result = computeSummaryStats(
      rawLines, [], syncRequests, ['active', 'idle'], [], null, null, null, index
    );

    const connIds = result.syncRequestsByConnection.map((s) => s.connId);
    expect(connIds).toContain('active');
    expect(connIds).not.toContain('idle');
  });
});

// ---------------------------------------------------------------------------
// Top failed URLs
// ---------------------------------------------------------------------------

describe('computeSummaryStats — topFailedUrls', () => {
  it('groups failed requests by URI with their statuses', () => {
    const rawLines = makeLines(5);
    const index = buildIndex(rawLines);

    const requests = [
      createHttpRequest({ requestId: 'R1', uri: '/sync', status: '500', responseLineNumber: 0 }),
      createHttpRequest({ requestId: 'R2', uri: '/sync', status: '502', responseLineNumber: 1 }),
      createHttpRequest({ requestId: 'R3', uri: '/upload', status: '400', responseLineNumber: 2 }),
    ];

    const result = computeSummaryStats(rawLines, requests, [], [], [], null, null, null, index);

    const syncEntry = result.topFailedUrls.find((u) => u.uri === '/sync');
    expect(syncEntry?.count).toBe(2);
    expect(Array.from(syncEntry?.statuses ?? [])).toEqual(expect.arrayContaining(['500', '502']));
  });

  it('caps topFailedUrls at 5 entries', () => {
    const rawLines = makeLines(10);
    const index = buildIndex(rawLines);

    const requests = rawLines.map((line, i) =>
      createHttpRequest({
        requestId: `R${i}`,
        uri: `/path/${i}`,
        status: '500',
        responseLineNumber: line.lineNumber,
      })
    );

    const result = computeSummaryStats(rawLines, requests, [], [], [], null, null, null, index);
    expect(result.topFailedUrls.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Upload / download byte totals
// ---------------------------------------------------------------------------

describe('computeSummaryStats — byte totals', () => {
  it('sums requestSize and responseSize for completed requests', () => {
    const rawLines = makeLines(3);
    const index = buildIndex(rawLines);

    const requests = [
      createHttpRequest({ requestId: 'R1', status: '200', requestSize: 100, responseSize: 500, responseLineNumber: 1 }),
      createHttpRequest({ requestId: 'R2', status: '200', requestSize: 200, responseSize: 1000, responseLineNumber: 2 }),
    ];

    const result = computeSummaryStats(rawLines, requests, [], [], [], null, null, null, index);
    expect(result.totalUploadBytes).toBe(300);
    expect(result.totalDownloadBytes).toBe(1500);
  });
});
