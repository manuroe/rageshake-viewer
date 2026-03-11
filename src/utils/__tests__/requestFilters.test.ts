/**
 * Unit tests for requestFilters.ts — pure filter functions extracted from logStore.
 *
 * These tests are more precise than their logStore counterparts because:
 * - No Zustand setup needed.
 * - Each filter combination is tested in isolation.
 * - Time-range tests use real ISO timestamps derived from the test data.
 */
import { describe, it, expect } from 'vitest';
import { filterSyncRequests, filterHttpRequests, getTimeRangeUs } from '../requestFilters';
import type { SyncRequestFilters, HttpRequestFilters } from '../requestFilters';
import {
  createSyncRequest,
  createHttpRequest,
  createParsedLogLines,
  createParsedLogLine,
} from '../../test/fixtures';
import { microsToISO } from '../timeUtils';

// ---------------------------------------------------------------------------
// getTimeRangeUs
// ---------------------------------------------------------------------------

describe('getTimeRangeUs', () => {
  it('returns null when neither filter is set', () => {
    const rawLines = createParsedLogLines(5);
    expect(getTimeRangeUs(rawLines, null, null)).toBeNull();
  });

  it('returns null when a filter is set but raw lines have no valid timestamps', () => {
    const rawLines = [
      createParsedLogLine({ lineNumber: 1, timestampUs: 0 }),
      createParsedLogLine({ lineNumber: 2, timestampUs: 0 }),
    ];

    const range = getTimeRangeUs(rawLines, 'start', 'end');
    expect(range).toBeNull();
  });

  it('calculates correct range for ISO datetime filters', () => {
    const baseUs = 1700000000000000; // fixed reference point
    const rawLines = [
      createParsedLogLine({ lineNumber: 1, timestampUs: baseUs }),
      createParsedLogLine({ lineNumber: 2, timestampUs: baseUs + 5_000_000 }),
    ];

    const startISO = microsToISO(baseUs + 1_000_000);
    const endISO = microsToISO(baseUs + 4_000_000);

    const range = getTimeRangeUs(rawLines, startISO, endISO);
    expect(range).not.toBeNull();
    expect(range!.startUs).toBe(baseUs + 1_000_000);
    expect(range!.endUs).toBe(baseUs + 4_000_000);
  });
});

// ---------------------------------------------------------------------------
// filterSyncRequests
// ---------------------------------------------------------------------------

describe('filterSyncRequests', () => {
  function makeFilters(overrides: Partial<SyncRequestFilters> = {}): SyncRequestFilters {
    return {
      selectedConnId: '',
      showIncomplete: false,
      selectedTimeout: null,
      statusCodeFilter: null,
      startTime: null,
      endTime: null,
      ...overrides,
    };
  }

  it('filters by connId', () => {
    const requests = [
      createSyncRequest({ requestId: 'A', connId: 'room-list', status: '200' }),
      createSyncRequest({ requestId: 'B', connId: 'encryption', status: '200' }),
    ];
    const result = filterSyncRequests(requests, [], makeFilters({ selectedConnId: 'room-list' }));

    expect(result).toHaveLength(1);
    expect(result[0].requestId).toBe('A');
  });

  it('includes all connections when selectedConnId is empty', () => {
    const requests = [
      createSyncRequest({ requestId: 'A', connId: 'room-list', status: '200' }),
      createSyncRequest({ requestId: 'B', connId: 'encryption', status: '200' }),
    ];
    const result = filterSyncRequests(requests, [], makeFilters({ selectedConnId: '' }));
    expect(result).toHaveLength(2);
  });

  it('excludes incomplete requests when showIncomplete is false', () => {
    const requests = [
      createSyncRequest({ requestId: 'A', status: '200' }),
      createSyncRequest({ requestId: 'B', status: '' }),
    ];
    const result = filterSyncRequests(requests, [], makeFilters({ showIncomplete: false }));

    expect(result).toHaveLength(1);
    expect(result[0].requestId).toBe('A');
  });

  it('includes incomplete requests when showIncomplete is true', () => {
    const requests = [
      createSyncRequest({ requestId: 'A', status: '200' }),
      createSyncRequest({ requestId: 'B', status: '' }),
    ];
    const result = filterSyncRequests(requests, [], makeFilters({ showIncomplete: true }));
    expect(result).toHaveLength(2);
  });

  it('filters by timeout value', () => {
    const requests = [
      createSyncRequest({ requestId: 'A', timeout: 30000, status: '200' }),
      createSyncRequest({ requestId: 'B', timeout: 0, status: '200' }),
    ];
    const result = filterSyncRequests(requests, [], makeFilters({ selectedTimeout: 30000 }));

    expect(result).toHaveLength(1);
    expect(result[0].requestId).toBe('A');
  });

  it('passes all requests when selectedTimeout is null', () => {
    const requests = [
      createSyncRequest({ requestId: 'A', timeout: 30000, status: '200' }),
      createSyncRequest({ requestId: 'B', timeout: 0, status: '200' }),
    ];
    const result = filterSyncRequests(requests, [], makeFilters({ selectedTimeout: null }));
    expect(result).toHaveLength(2);
  });

  it('filters by statusCodeFilter', () => {
    const requests = [
      createSyncRequest({ requestId: 'A', status: '200' }),
      createSyncRequest({ requestId: 'B', status: '401' }),
    ];
    const result = filterSyncRequests(
      requests,
      [],
      makeFilters({ statusCodeFilter: new Set(['200']) })
    );

    expect(result).toHaveLength(1);
    expect(result[0].requestId).toBe('A');
  });

  it('includes requests matching "Incomplete" statusCodeFilter key', () => {
    const requests = [
      createSyncRequest({ requestId: 'A', status: '' }),
      createSyncRequest({ requestId: 'B', status: '200' }),
    ];
    const result = filterSyncRequests(
      requests,
      [],
      makeFilters({ showIncomplete: true, statusCodeFilter: new Set(['Incomplete']) })
    );

    expect(result).toHaveLength(1);
    expect(result[0].requestId).toBe('A');
  });

  it('filters completed requests by time range', () => {
    const baseUs = 1700000000000000 as const;
    const rawLines = [
      createParsedLogLine({ lineNumber: 1, timestampUs: baseUs }),
      createParsedLogLine({ lineNumber: 2, timestampUs: baseUs + 2_000_000 }),
      createParsedLogLine({ lineNumber: 3, timestampUs: baseUs + 4_000_000 }),
    ];
    const requests = [
      createSyncRequest({
        requestId: 'early',
        status: '200',
        responseLineNumber: 1,
        sendLineNumber: 0,
      }),
      createSyncRequest({
        requestId: 'mid',
        status: '200',
        responseLineNumber: 2,
        sendLineNumber: 0,
      }),
      createSyncRequest({
        requestId: 'late',
        status: '200',
        responseLineNumber: 3,
        sendLineNumber: 0,
      }),
    ];

    // Filter to include only lines with timestamps <= baseUs + 1s
    const startISO = microsToISO(baseUs);
    const endISO = microsToISO(baseUs + 1_000_000);

    const result = filterSyncRequests(
      requests,
      rawLines,
      makeFilters({ startTime: startISO, endTime: endISO })
    );

    expect(result).toHaveLength(1);
    expect(result[0].requestId).toBe('early');
  });

  it('filters incomplete requests by send timestamp when time range is active', () => {
    const baseUs = 1700000000000000 as const;
    const rawLines = [
      createParsedLogLine({ lineNumber: 1, timestampUs: baseUs }),
      createParsedLogLine({ lineNumber: 2, timestampUs: baseUs + 10_000_000 }),
    ];
    const requests = [
      // Completed — outside range
      createSyncRequest({
        requestId: 'completed-outside',
        status: '200',
        responseLineNumber: 2,
        sendLineNumber: 0,
      }),
      // Incomplete, inside range (send line 1)
      createSyncRequest({
        requestId: 'incomplete-inside',
        status: '',
        responseLineNumber: 0,
        sendLineNumber: 1,
      }),
      // Incomplete, outside range (send line 2)
      createSyncRequest({
        requestId: 'incomplete-outside',
        status: '',
        responseLineNumber: 0,
        sendLineNumber: 2,
      }),
    ];

    const startISO = microsToISO(baseUs);
    const endISO = microsToISO(baseUs + 1_000_000); // window too small for completed-outside

    const result = filterSyncRequests(
      requests,
      rawLines,
      makeFilters({ showIncomplete: true, startTime: startISO, endTime: endISO })
    );

    expect(result).toHaveLength(1);
    expect(result[0].requestId).toBe('incomplete-inside');
  });

  it('combines multiple filters (connId + status + time)', () => {
    const baseUs = 1700000000000000 as const;
    const rawLines = [
      createParsedLogLine({ lineNumber: 1, timestampUs: baseUs }),
      createParsedLogLine({ lineNumber: 2, timestampUs: baseUs + 5_000_000 }),
    ];
    const requests = [
      createSyncRequest({
        requestId: 'match',
        connId: 'room-list',
        status: '200',
        responseLineNumber: 1,
        sendLineNumber: 0,
      }),
      createSyncRequest({
        requestId: 'wrong-conn',
        connId: 'encryption',
        status: '200',
        responseLineNumber: 1,
        sendLineNumber: 0,
      }),
      createSyncRequest({
        requestId: 'wrong-time',
        connId: 'room-list',
        status: '200',
        responseLineNumber: 2,
        sendLineNumber: 0,
      }),
    ];

    const startISO = microsToISO(baseUs);
    const endISO = microsToISO(baseUs + 1_000_000);

    const result = filterSyncRequests(
      requests,
      rawLines,
      makeFilters({
        selectedConnId: 'room-list',
        startTime: startISO,
        endTime: endISO,
      })
    );

    expect(result).toHaveLength(1);
    expect(result[0].requestId).toBe('match');
  });

  it('does not apply time filtering when raw log lines have no valid timestamps', () => {
    const requests = [
      createSyncRequest({
        requestId: 'incomplete',
        status: '',
        responseLineNumber: 0,
        sendLineNumber: 1,
      }),
      createSyncRequest({
        requestId: 'complete',
        status: '200',
        responseLineNumber: 2,
        sendLineNumber: 1,
      }),
    ];

    const rawLines = [
      createParsedLogLine({ lineNumber: 1, timestampUs: 0 }),
      createParsedLogLine({ lineNumber: 2, timestampUs: 0 }),
    ];

    const result = filterSyncRequests(
      requests,
      rawLines,
      makeFilters({ showIncomplete: true, startTime: 'start', endTime: 'end' })
    );

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.requestId).sort()).toEqual(['complete', 'incomplete']);
  });
});

// ---------------------------------------------------------------------------
// filterHttpRequests
// ---------------------------------------------------------------------------

describe('filterHttpRequests', () => {
  function makeFilters(overrides: Partial<HttpRequestFilters> = {}): HttpRequestFilters {
    return {
      showIncompleteHttp: false,
      statusCodeFilter: null,
      uriFilter: null,
      startTime: null,
      endTime: null,
      ...overrides,
    };
  }

  it('excludes incomplete requests when showIncompleteHttp is false', () => {
    const requests = [
      createHttpRequest({ requestId: 'A', status: '200' }),
      createHttpRequest({ requestId: 'B', status: '' }),
    ];
    const result = filterHttpRequests(requests, [], makeFilters({ showIncompleteHttp: false }));

    expect(result).toHaveLength(1);
    expect(result[0].requestId).toBe('A');
  });

  it('includes incomplete requests when showIncompleteHttp is true', () => {
    const requests = [
      createHttpRequest({ requestId: 'A', status: '200' }),
      createHttpRequest({ requestId: 'B', status: '' }),
    ];
    const result = filterHttpRequests(requests, [], makeFilters({ showIncompleteHttp: true }));
    expect(result).toHaveLength(2);
  });

  it('filters by statusCodeFilter', () => {
    const requests = [
      createHttpRequest({ requestId: 'A', status: '200' }),
      createHttpRequest({ requestId: 'B', status: '404' }),
      createHttpRequest({ requestId: 'C', status: '500' }),
    ];
    const result = filterHttpRequests(
      requests,
      [],
      makeFilters({ statusCodeFilter: new Set(['200', '404']) })
    );

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.requestId).sort()).toEqual(['A', 'B']);
  });

  it('includes incomplete HTTP requests matching "Incomplete" statusCodeFilter key', () => {
    // Exercises the `r.status || 'Incomplete'` branch in filterHttpRequests
    // when statusCodeFilter is set and the request has no status.
    const requests = [
      createHttpRequest({ requestId: 'A', status: '200' }),
      createHttpRequest({ requestId: 'B', status: '' }),  // incomplete
    ];
    const result = filterHttpRequests(
      requests,
      [],
      makeFilters({ showIncompleteHttp: true, statusCodeFilter: new Set(['Incomplete']) })
    );
    expect(result).toHaveLength(1);
    expect(result[0].requestId).toBe('B');
  });

  it('excludes incomplete HTTP requests when statusCodeFilter does not include "Incomplete"', () => {
    const requests = [
      createHttpRequest({ requestId: 'A', status: '200' }),
      createHttpRequest({ requestId: 'B', status: '' }),  // incomplete
    ];
    const result = filterHttpRequests(
      requests,
      [],
      makeFilters({ showIncompleteHttp: true, statusCodeFilter: new Set(['200']) })
    );
    expect(result).toHaveLength(1);
    expect(result[0].requestId).toBe('A');
  });

  it('shows client-error requests even when showIncompleteHttp is false', () => {
    const requests = [
      createHttpRequest({ requestId: 'A', status: '200' }),
      createHttpRequest({ requestId: 'B', status: '', clientError: 'TimedOut' }),
      createHttpRequest({ requestId: 'C', status: '' }), // truly incomplete
    ];
    const result = filterHttpRequests(requests, [], makeFilters({ showIncompleteHttp: false }));

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.requestId).sort()).toEqual(['A', 'B']);
  });

  it('filters client-error requests by CLIENT_ERROR_STATUS_KEY in statusCodeFilter', () => {
    const requests = [
      createHttpRequest({ requestId: 'A', status: '200' }),
      createHttpRequest({ requestId: 'B', status: '', clientError: 'TimedOut' }),
      createHttpRequest({ requestId: 'C', status: '', clientError: 'ConnectError' }),
    ];
    const result = filterHttpRequests(
      requests,
      [],
      makeFilters({ statusCodeFilter: new Set(['Client Error']) })
    );

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.requestId).sort()).toEqual(['B', 'C']);
  });

  it('excludes client-error requests when statusCodeFilter does not include CLIENT_ERROR_STATUS_KEY', () => {
    const requests = [
      createHttpRequest({ requestId: 'A', status: '200' }),
      createHttpRequest({ requestId: 'B', status: '', clientError: 'TimedOut' }),
    ];
    const result = filterHttpRequests(
      requests,
      [],
      makeFilters({ statusCodeFilter: new Set(['200']) })
    );

    expect(result).toHaveLength(1);
    expect(result[0].requestId).toBe('A');
  });

  it('performs case-insensitive URI filter', () => {
    const requests = [
      createHttpRequest({ requestId: 'A', uri: 'https://example.com/SYNC?timeout=30000' }),
      createHttpRequest({ requestId: 'B', uri: 'https://example.com/keys/upload' }),
    ];
    const result = filterHttpRequests(requests, [], makeFilters({ uriFilter: 'sync' }));

    expect(result).toHaveLength(1);
    expect(result[0].requestId).toBe('A');
  });

  it('null uriFilter shows all requests', () => {
    const requests = [
      createHttpRequest({ requestId: 'A', uri: 'https://example.com/sync' }),
      createHttpRequest({ requestId: 'B', uri: 'https://example.com/keys' }),
    ];
    const result = filterHttpRequests(requests, [], makeFilters({ uriFilter: null }));
    expect(result).toHaveLength(2);
  });

  it('empty-string uriFilter shows all requests', () => {
    const requests = [
      createHttpRequest({ requestId: 'A', uri: 'https://example.com/sync' }),
      createHttpRequest({ requestId: 'B', uri: 'https://example.com/keys' }),
    ];
    const result = filterHttpRequests(requests, [], makeFilters({ uriFilter: '' }));
    expect(result).toHaveLength(2);
  });

  it('filters by exact time range using real ISO datetimes', () => {
    const baseUs = 1700000000000000 as const;
    const rawLines = [
      createParsedLogLine({ lineNumber: 1, timestampUs: baseUs }),
      createParsedLogLine({ lineNumber: 2, timestampUs: baseUs + 2_000_000 }),
      createParsedLogLine({ lineNumber: 3, timestampUs: baseUs + 4_000_000 }),
    ];
    const requests = [
      createHttpRequest({ requestId: 'first', status: '200', responseLineNumber: 1 }),
      createHttpRequest({ requestId: 'second', status: '200', responseLineNumber: 2 }),
      createHttpRequest({ requestId: 'third', status: '200', responseLineNumber: 3 }),
    ];

    // Filter to only include responses at baseUs and baseUs+2s
    const startISO = microsToISO(baseUs);
    const endISO = microsToISO(baseUs + 2_000_000);

    const result = filterHttpRequests(
      requests,
      rawLines,
      makeFilters({ startTime: startISO, endTime: endISO })
    );

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.requestId).sort()).toEqual(['first', 'second']);
  });

  it('filters incomplete HTTP requests by send timestamp when time range is active', () => {
    const baseUs = 1700000000000000 as const;
    const rawLines = [
      createParsedLogLine({ lineNumber: 1, timestampUs: baseUs }),
      createParsedLogLine({ lineNumber: 2, timestampUs: baseUs + 10_000_000 }),
    ];
    const requests = [
      // Completed, outside narrow window
      createHttpRequest({
        requestId: 'outside',
        status: '200',
        responseLineNumber: 2,
      }),
      // Incomplete, inside range (send line 1)
      createHttpRequest({
        requestId: 'pending-inside',
        status: '',
        responseLineNumber: 0,
        sendLineNumber: 1,
      }),
      // Incomplete, outside range (send line 2)
      createHttpRequest({
        requestId: 'pending-outside',
        status: '',
        responseLineNumber: 0,
        sendLineNumber: 2,
      }),
    ];

    const startISO = microsToISO(baseUs);
    const endISO = microsToISO(baseUs + 1_000_000);

    const result = filterHttpRequests(
      requests,
      rawLines,
      makeFilters({ showIncompleteHttp: true, startTime: startISO, endTime: endISO })
    );

    expect(result).toHaveLength(1);
    expect(result[0].requestId).toBe('pending-inside');
  });

  it('no filter returns all completed requests', () => {
    const requests = [
      createHttpRequest({ requestId: 'A', status: '200' }),
      createHttpRequest({ requestId: 'B', status: '404' }),
      createHttpRequest({ requestId: 'C', status: '500' }),
    ];
    const result = filterHttpRequests(requests, [], makeFilters());
    expect(result).toHaveLength(3);
  });

  it('does not apply time filtering when raw log lines have no valid timestamps', () => {
    const requests = [
      createHttpRequest({
        requestId: 'pending',
        status: '',
        responseLineNumber: 0,
        sendLineNumber: 1,
      }),
      createHttpRequest({
        requestId: 'done',
        status: '200',
        responseLineNumber: 2,
        sendLineNumber: 1,
      }),
    ];

    const rawLines = [
      createParsedLogLine({ lineNumber: 1, timestampUs: 0 }),
      createParsedLogLine({ lineNumber: 2, timestampUs: 0 }),
    ];

    const result = filterHttpRequests(
      requests,
      rawLines,
      makeFilters({ showIncompleteHttp: true, startTime: 'start', endTime: 'end' })
    );

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.requestId).sort()).toEqual(['done', 'pending']);
  });
});
