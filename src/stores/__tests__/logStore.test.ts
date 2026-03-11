/**
 * Unit tests for logStore.ts
 * Tests Zustand store actions and state management.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useLogStore } from '../logStore';
import {
  createSyncRequest,
  createSyncRequests,
  createHttpRequest,
  createHttpRequests,
  createParsedLogLine,
  createParsedLogLines,
} from '../../test/fixtures';
import { AppError } from '../../utils/errorHandling';
import { microsToISO } from '../../utils/timeUtils';

describe('logStore', () => {
  beforeEach(() => {
    // The global afterEach in setup.ts also resets, but this ensures a clean slate
    useLogStore.getState().clearData();
  });

  describe('initial state', () => {
    it('has empty arrays and null filters', () => {
      const state = useLogStore.getState();

      expect(state.allRequests).toEqual([]);
      expect(state.filteredRequests).toEqual([]);
      expect(state.allHttpRequests).toEqual([]);
      expect(state.filteredHttpRequests).toEqual([]);
      expect(state.connectionIds).toEqual([]);
      expect(state.rawLogLines).toEqual([]);
      expect(state.statusCodeFilter).toBeNull();
      expect(state.uriFilter).toBeNull();
      expect(state.startTime).toBeNull();
      expect(state.endTime).toBeNull();
    });

    it('has default UI state', () => {
      const state = useLogStore.getState();

      expect(state.expandedRows.size).toBe(0);
      expect(state.openLogViewerIds.size).toBe(0);
      expect(state.showIncomplete).toBe(false);
      expect(state.showIncompleteHttp).toBe(false);
    });
  });

  describe('setRequests', () => {
    it('sets sync requests and raw log lines', () => {
      const requests = createSyncRequests(3);
      const rawLines = createParsedLogLines(5);
      const connIds = ['room-list', 'encryption'];

      useLogStore.getState().setRequests(requests, connIds, rawLines);
      const state = useLogStore.getState();

      expect(state.allRequests).toHaveLength(3);
      expect(state.connectionIds).toEqual(connIds);
      expect(state.rawLogLines).toHaveLength(5);
    });

    it('defaults to room-list connection when available', () => {
      const requests = createSyncRequests(1);
      const connIds = ['encryption', 'room-list', 'other'];

      useLogStore.getState().setRequests(requests, connIds, []);
      const state = useLogStore.getState();

      expect(state.selectedConnId).toBe('room-list');
    });

    it('defaults to first connection when room-list is unavailable', () => {
      const requests = createSyncRequests(1);
      const connIds = ['encryption', 'other'];

      useLogStore.getState().setRequests(requests, connIds, []);
      const state = useLogStore.getState();

      expect(state.selectedConnId).toBe('encryption');
    });

    it('triggers filterRequests after setting data', () => {
      const requests = [createSyncRequest({ status: '200', connId: 'room-list' })];
      const connIds = ['room-list'];

      useLogStore.getState().setRequests(requests, connIds, []);
      const state = useLogStore.getState();

      // With showIncomplete=false (default), completed request should be included
      expect(state.filteredRequests).toHaveLength(1);
    });
  });

  describe('setHttpRequests', () => {
    it('sets HTTP requests and raw log lines', () => {
      const requests = createHttpRequests(4);
      const rawLines = createParsedLogLines(10);

      useLogStore.getState().setHttpRequests(requests, rawLines);
      const state = useLogStore.getState();

      expect(state.allHttpRequests).toHaveLength(4);
      expect(state.rawLogLines).toHaveLength(10);
    });

    it('triggers filterHttpRequests after setting data', () => {
      const requests = [
        createHttpRequest({ status: '200' }),
        createHttpRequest({ status: '' }), // Incomplete
      ];

      useLogStore.getState().setHttpRequests(requests, []);
      const state = useLogStore.getState();

      // With showIncompleteHttp=false (default), only completed requests
      expect(state.filteredHttpRequests).toHaveLength(1);
      expect(state.filteredHttpRequests[0].status).toBe('200');
    });
  });

  describe('filterRequests', () => {
    beforeEach(() => {
      // Reset store to ensure clean default state (showIncomplete=false, etc.)
      useLogStore.getState().clearData();
      // Note: clearData doesn't reset showIncomplete to default, so we need a full reset
      // This tests with fresh store state plus our test data
      useLogStore.setState({
        showIncomplete: false,
        showIncompleteHttp: false,
      });
      
      const requests = [
        createSyncRequest({ requestId: 'REQ-1', status: '200', connId: 'room-list' }),
        createSyncRequest({ requestId: 'REQ-2', status: '', connId: 'room-list' }), // Incomplete
        createSyncRequest({ requestId: 'REQ-3', status: '200', connId: 'encryption' }),
        createSyncRequest({ requestId: 'REQ-4', status: '401', connId: 'room-list' }),
      ];
      useLogStore.getState().setRequests(requests, ['room-list', 'encryption'], []);
    });

    it('filters by connection ID', () => {
      useLogStore.getState().setShowIncomplete(true);
      useLogStore.getState().setSelectedConnId('encryption');
      const state = useLogStore.getState();

      expect(state.filteredRequests).toHaveLength(1);
      expect(state.filteredRequests[0].requestId).toBe('REQ-3');
    });

    it('filters out incomplete requests when showIncomplete is false', () => {
      // Default showIncomplete=false, selected is room-list by default
      const state = useLogStore.getState();

      // Room-list requests with status: REQ-1 (200), REQ-4 (401)
      expect(state.filteredRequests).toHaveLength(2);
      expect(state.filteredRequests.every(r => r.status !== '')).toBe(true);
    });

    it('includes incomplete requests when showIncomplete is true', () => {
      useLogStore.getState().setShowIncomplete(true);
      const state = useLogStore.getState();

      expect(state.filteredRequests).toHaveLength(3); // All room-list requests
    });

    it('filters by status code filter', () => {
      useLogStore.getState().setShowIncomplete(true);
      useLogStore.getState().setStatusCodeFilter(new Set(['401']));
      const state = useLogStore.getState();

      expect(state.filteredRequests).toHaveLength(1);
      expect(state.filteredRequests[0].status).toBe('401');
    });

    it('includes incomplete requests when status filter includes Incomplete', () => {
      useLogStore.getState().setStatusCodeFilter(new Set(['Incomplete']));
      useLogStore.getState().setShowIncomplete(true);
      const state = useLogStore.getState();

      expect(state.filteredRequests).toHaveLength(1);
      expect(state.filteredRequests[0].requestId).toBe('REQ-2');
    });
  });

  describe('filterHttpRequests', () => {
    beforeEach(() => {
      // Reset store to ensure clean default state
      useLogStore.getState().clearData();
      useLogStore.setState({
        showIncomplete: false,
        showIncompleteHttp: false,
      });
      
      const requests = [
        createHttpRequest({ requestId: 'REQ-1', status: '200' }),
        createHttpRequest({ requestId: 'REQ-2', status: '' }), // Incomplete
        createHttpRequest({ requestId: 'REQ-3', status: '404' }),
        createHttpRequest({ requestId: 'REQ-4', status: '500' }),
      ];
      useLogStore.getState().setHttpRequests(requests, []);
    });

    it('filters out incomplete requests when showIncompleteHttp is false', () => {
      const state = useLogStore.getState();

      expect(state.filteredHttpRequests).toHaveLength(3);
      expect(state.filteredHttpRequests.every(r => r.status !== '')).toBe(true);
    });

    it('includes incomplete requests when showIncompleteHttp is true', () => {
      useLogStore.getState().setShowIncompleteHttp(true);
      const state = useLogStore.getState();

      expect(state.filteredHttpRequests).toHaveLength(4);
    });

    it('filters by status code filter', () => {
      useLogStore.getState().setStatusCodeFilter(new Set(['200', '404']));
      const state = useLogStore.getState();

      expect(state.filteredHttpRequests).toHaveLength(2);
    });
  });

  describe('time filtering', () => {
    it('filters requests within time range using real ISO datetime filters', () => {
      // Fixed reference point so the test is deterministic regardless of wall-clock time.
      const baseUs = 1700000000000000; // 2023-11-14T22:13:20.000000Z
      const rawLines = [
        createParsedLogLine({ lineNumber: 1, timestampUs: baseUs }),
        createParsedLogLine({ lineNumber: 2, timestampUs: baseUs + 1_000_000 }), // +1 s
        createParsedLogLine({ lineNumber: 3, timestampUs: baseUs + 2_000_000 }), // +2 s
      ];

      const requests = [
        createHttpRequest({ requestId: 'REQ-1', responseLineNumber: 1, status: '200' }),
        createHttpRequest({ requestId: 'REQ-2', responseLineNumber: 2, status: '200' }),
        createHttpRequest({ requestId: 'REQ-3', responseLineNumber: 3, status: '200' }),
      ];

      useLogStore.getState().setHttpRequests(requests, rawLines);

      // Filter window covers only the first second (baseUs to baseUs+0.5s).
      // Only REQ-1 (response at baseUs) should survive.
      const startISO = microsToISO(baseUs);
      const endISO = microsToISO(baseUs + 500_000);
      useLogStore.getState().setTimeFilter(startISO, endISO);

      const state = useLogStore.getState();
      expect(state.filteredHttpRequests).toHaveLength(1);
      expect(state.filteredHttpRequests[0].requestId).toBe('REQ-1');
    });

    it('includes all requests when no time filter is set', () => {
      const rawLines = createParsedLogLines(3);
      const requests = createHttpRequests(3);

      useLogStore.getState().setHttpRequests(requests, rawLines);
      const state = useLogStore.getState();

      expect(state.filteredHttpRequests).toHaveLength(3);
    });
  });

  describe('setStatusCodeFilter', () => {
    it('triggers both filterRequests and filterHttpRequests', () => {
      const syncRequests = [createSyncRequest({ status: '200', connId: 'room-list' })];
      const httpRequests = [createHttpRequest({ status: '200' })];

      useLogStore.getState().setRequests(syncRequests, ['room-list'], []);
      useLogStore.getState().setHttpRequests(httpRequests, []);

      // Both should have data
      expect(useLogStore.getState().filteredRequests).toHaveLength(1);
      expect(useLogStore.getState().filteredHttpRequests).toHaveLength(1);

      // Filter to non-existent status
      useLogStore.getState().setStatusCodeFilter(new Set(['404']));

      // Both should be filtered out
      expect(useLogStore.getState().filteredRequests).toHaveLength(0);
      expect(useLogStore.getState().filteredHttpRequests).toHaveLength(0);
    });

    it('null filter means all statuses enabled', () => {
      const requests = [
        createHttpRequest({ status: '200' }),
        createHttpRequest({ status: '404' }),
        createHttpRequest({ status: '500' }),
      ];
      useLogStore.getState().setHttpRequests(requests, []);

      useLogStore.getState().setStatusCodeFilter(null);
      const state = useLogStore.getState();

      expect(state.filteredHttpRequests).toHaveLength(3);
    });
  });

  describe('toggleRowExpansion', () => {
    it('adds requestId to expandedRows when not present', () => {
      useLogStore.getState().toggleRowExpansion(1);
      const state = useLogStore.getState();

      expect(state.expandedRows.has(1)).toBe(true);
    });

    it('removes requestId from expandedRows when already present', () => {
      useLogStore.getState().toggleRowExpansion(1);
      useLogStore.getState().toggleRowExpansion(1);
      const state = useLogStore.getState();

      expect(state.expandedRows.has(1)).toBe(false);
    });

    it('maintains other expanded rows when toggling', () => {
      useLogStore.getState().toggleRowExpansion(1);
      useLogStore.getState().toggleRowExpansion(2);
      useLogStore.getState().toggleRowExpansion(1);
      const state = useLogStore.getState();

      expect(state.expandedRows.has(1)).toBe(false);
      expect(state.expandedRows.has(2)).toBe(true);
    });
  });

  describe('setActiveRequest', () => {
    it('clears all expanded rows and opens only the specified one', () => {
      useLogStore.getState().toggleRowExpansion(1);
      useLogStore.getState().toggleRowExpansion(2);

      useLogStore.getState().setActiveRequest(3);
      const state = useLogStore.getState();

      expect(state.expandedRows.size).toBe(1);
      expect(state.expandedRows.has(3)).toBe(true);
    });

    it('also opens log viewer for the request', () => {
      useLogStore.getState().openLogViewer(1);

      useLogStore.getState().setActiveRequest(2);
      const state = useLogStore.getState();

      expect(state.openLogViewerIds.size).toBe(1);
      expect(state.openLogViewerIds.has(2)).toBe(true);
    });
  });

  describe('log viewer actions', () => {
    it('openLogViewer adds requestId to set', () => {
      useLogStore.getState().openLogViewer(1);
      useLogStore.getState().openLogViewer(2);
      const state = useLogStore.getState();

      expect(state.openLogViewerIds.has(1)).toBe(true);
      expect(state.openLogViewerIds.has(2)).toBe(true);
    });

    it('closeLogViewer removes requestId from set', () => {
      useLogStore.getState().openLogViewer(1);
      useLogStore.getState().openLogViewer(2);
      useLogStore.getState().closeLogViewer(1);
      const state = useLogStore.getState();

      expect(state.openLogViewerIds.has(1)).toBe(false);
      expect(state.openLogViewerIds.has(2)).toBe(true);
    });
  });

  describe('navigation memory', () => {
    it('setLastRoute stores route', () => {
      useLogStore.getState().setLastRoute('/http-requests');
      expect(useLogStore.getState().lastRoute).toBe('/http-requests');
    });

    it('clearLastRoute resets to null', () => {
      useLogStore.getState().setLastRoute('/sync');
      useLogStore.getState().clearLastRoute();
      expect(useLogStore.getState().lastRoute).toBeNull();
    });
  });

  describe('error handling', () => {
    it('setError stores error', () => {
      const error = new AppError('Test error', 'error');
      useLogStore.getState().setError(error);
      expect(useLogStore.getState().error).toEqual(error);
    });

    it('clearError resets error to null', () => {
      const error = new AppError('Test error', 'error');
      useLogStore.getState().setError(error);
      useLogStore.getState().clearError();
      expect(useLogStore.getState().error).toBeNull();
    });

    it('stored error has the expected userMessage and severity', () => {
      const error = new AppError('File too large', 'warning');
      useLogStore.getState().setError(error);
      const stored = useLogStore.getState().error!;
      expect(stored.userMessage).toBe('File too large');
      expect(stored.severity).toBe('warning');
    });
  });

  describe('getDisplayTime', () => {
    it('returns displayTime for matching line number', () => {
      const rawLines = [
        createParsedLogLine({ lineNumber: 1, displayTime: '12:00:00.000000' }),
        createParsedLogLine({ lineNumber: 2, displayTime: '12:00:01.000000' }),
      ];
      useLogStore.getState().setHttpRequests([], rawLines);

      expect(useLogStore.getState().getDisplayTime(2)).toBe('12:00:01.000000');
    });

    it('returns empty string for non-existent line number', () => {
      const rawLines = [createParsedLogLine({ lineNumber: 1 })];
      useLogStore.getState().setHttpRequests([], rawLines);

      expect(useLogStore.getState().getDisplayTime(999)).toBe('');
    });
  });

  describe('clearData', () => {
    it('resets all state to initial values', () => {
      // Set up various state
      useLogStore.getState().setRequests(
        createSyncRequests(3),
        ['room-list'],
        createParsedLogLines(5)
      );
      useLogStore.getState().setHttpRequests(createHttpRequests(4), []);
      useLogStore.getState().toggleRowExpansion('REQ-1');
      useLogStore.getState().openLogViewer('REQ-2');
      useLogStore.getState().setTimeFilter('00:00:00', '00:00:10');
      useLogStore.getState().setStatusCodeFilter(new Set(['200']));
      useLogStore.getState().setUriFilter('sync');

      // Clear all data
      useLogStore.getState().clearData();
      const state = useLogStore.getState();

      expect(state.allRequests).toEqual([]);
      expect(state.filteredRequests).toEqual([]);
      expect(state.allHttpRequests).toEqual([]);
      expect(state.filteredHttpRequests).toEqual([]);
      expect(state.connectionIds).toEqual([]);
      expect(state.rawLogLines).toEqual([]);
      expect(state.expandedRows.size).toBe(0);
      expect(state.openLogViewerIds.size).toBe(0);
      expect(state.statusCodeFilter).toBeNull();
      expect(state.uriFilter).toBeNull();
      expect(state.startTime).toBeNull();
      expect(state.endTime).toBeNull();
    });
  });

  describe('setTimelineScale', () => {
    it('updates timeline scale', () => {
      useLogStore.getState().setTimelineScale(10);
      expect(useLogStore.getState().timelineScale).toBe(10);

      useLogStore.getState().setTimelineScale(5);
      expect(useLogStore.getState().timelineScale).toBe(5);
    });
  });

  describe('setUriFilter', () => {
    it('sets the uri filter and triggers filterHttpRequests', () => {
      const requests = [
        createHttpRequest({ uri: 'https://matrix.org/sync' }),
        createHttpRequest({ uri: 'https://matrix.org/keys/upload' }),
        createHttpRequest({ uri: 'https://matrix.org/rooms/join' }),
      ];
      useLogStore.getState().setHttpRequests(requests, []);

      // Filter to sync endpoint
      useLogStore.getState().setUriFilter('sync');
      const state = useLogStore.getState();

      expect(state.uriFilter).toBe('sync');
      expect(state.filteredHttpRequests).toHaveLength(1);
      expect(state.filteredHttpRequests[0].uri).toContain('sync');
    });

    it('performs case-insensitive substring matching', () => {
      const requests = [
        createHttpRequest({ uri: 'https://matrix.org/SYNC' }),
        createHttpRequest({ uri: 'https://matrix.org/keys' }),
      ];
      useLogStore.getState().setHttpRequests(requests, []);

      // Lowercase filter should match uppercase URI
      useLogStore.getState().setUriFilter('sync');
      const state = useLogStore.getState();

      expect(state.filteredHttpRequests).toHaveLength(1);
    });

    it('null filter shows all requests', () => {
      const requests = createHttpRequests(3);
      useLogStore.getState().setHttpRequests(requests, []);

      useLogStore.getState().setUriFilter('nonexistent');
      expect(useLogStore.getState().filteredHttpRequests).toHaveLength(0);

      useLogStore.getState().setUriFilter(null);
      expect(useLogStore.getState().filteredHttpRequests).toHaveLength(3);
    });

    it('empty string filter shows all requests', () => {
      const requests = createHttpRequests(3);
      useLogStore.getState().setHttpRequests(requests, []);

      useLogStore.getState().setUriFilter('');
      expect(useLogStore.getState().filteredHttpRequests).toHaveLength(3);
    });

    it('combines with other filters', () => {
      const requests = [
        createHttpRequest({ uri: 'https://matrix.org/sync', status: '200' }),
        createHttpRequest({ uri: 'https://matrix.org/sync', status: '500' }),
        createHttpRequest({ uri: 'https://matrix.org/keys', status: '200' }),
      ];
      useLogStore.getState().setHttpRequests(requests, []);

      // Filter by URI
      useLogStore.getState().setUriFilter('sync');
      expect(useLogStore.getState().filteredHttpRequests).toHaveLength(2);

      // Also filter by status
      useLogStore.getState().setStatusCodeFilter(new Set(['200']));
      expect(useLogStore.getState().filteredHttpRequests).toHaveLength(1);
    });
  });

  describe('detectedPlatform', () => {
    it('is null initially', () => {
      expect(useLogStore.getState().detectedPlatform).toBeNull();
    });

    it('detects android when a line contains "MainActivity"', () => {
      const rawLines = [
        createParsedLogLine({ lineNumber: 0, message: 'MainActivity: App started' }),
        createParsedLogLine({ lineNumber: 1, message: 'Matrix Rust SDK initializing' }),
      ];
      useLogStore.getState().setRequests([], [], rawLines);
      expect(useLogStore.getState().detectedPlatform).toBe('android');
    });

    it('detects ios when a line contains "swift" (case-insensitive)', () => {
      const rawLines = [
        createParsedLogLine({ lineNumber: 0, message: 'Swift app launched' }),
        createParsedLogLine({ lineNumber: 1, message: 'Matrix Rust SDK initializing' }),
      ];
      useLogStore.getState().setRequests([], [], rawLines);
      expect(useLogStore.getState().detectedPlatform).toBe('ios');
    });

    it('detects ios for uppercase SWIFT', () => {
      const rawLines = [
        createParsedLogLine({ lineNumber: 0, message: 'SWIFT: bridge initialized' }),
      ];
      useLogStore.getState().setRequests([], [], rawLines);
      expect(useLogStore.getState().detectedPlatform).toBe('ios');
    });

    it('returns null when both android and ios markers are present', () => {
      const rawLines = [
        createParsedLogLine({ lineNumber: 0, message: 'swift bridge init' }),
        createParsedLogLine({ lineNumber: 1, message: 'MainActivity: started' }),
      ];
      useLogStore.getState().setRequests([], [], rawLines);
      expect(useLogStore.getState().detectedPlatform).toBeNull();
    });

    it('returns null when no platform strings are found', () => {
      const rawLines = [
        createParsedLogLine({ lineNumber: 0, message: 'Matrix Rust SDK initializing' }),
        createParsedLogLine({ lineNumber: 1, message: 'Loading client configuration from storage' }),
      ];
      useLogStore.getState().setRequests([], [], rawLines);
      expect(useLogStore.getState().detectedPlatform).toBeNull();
    });

    it('is reset to null by clearData', () => {
      const rawLines = [
        createParsedLogLine({ lineNumber: 0, message: 'MainActivity: started' }),
      ];
      useLogStore.getState().setRequests([], [], rawLines);
      expect(useLogStore.getState().detectedPlatform).toBe('android');

      useLogStore.getState().clearData();
      expect(useLogStore.getState().detectedPlatform).toBeNull();
    });

    it('also detects platform from setHttpRequests', () => {
      const rawLines = [
        createParsedLogLine({ lineNumber: 0, message: 'swift matrix sdk loaded' }),
      ];
      useLogStore.getState().setHttpRequests([], rawLines);
      expect(useLogStore.getState().detectedPlatform).toBe('ios');
    });
  });

  describe('loadLogParserResult', () => {
    it('populates all sub-states from a single call', () => {
      const rawLines = createParsedLogLines(3);
      const syncReqs = createSyncRequests(2);
      const httpReqs = createHttpRequests(3);
      const sentryEvents = [{ lineNumber: 1, message: 'Sentry error', level: 'ERROR' as const, rawText: '', isoTimestamp: '' }];

      useLogStore.getState().loadLogParserResult({
        requests: syncReqs,
        connectionIds: ['room-list'],
        rawLogLines: rawLines,
        httpRequests: httpReqs,
        sentryEvents,
      });

      const state = useLogStore.getState();
      expect(state.allRequests).toHaveLength(2);
      expect(state.allHttpRequests).toHaveLength(3);
      expect(state.sentryEvents).toHaveLength(1);
      expect(state.rawLogLines).toHaveLength(3);
      expect(state.connectionIds).toEqual(['room-list']);
    });

    it('builds lineNumberIndex from rawLogLines', () => {
      const rawLines = [
        createParsedLogLine({ lineNumber: 10, displayTime: '10:00:00.000000' }),
        createParsedLogLine({ lineNumber: 20, displayTime: '10:00:01.000000' }),
      ];

      useLogStore.getState().loadLogParserResult({
        requests: [],
        connectionIds: [],
        rawLogLines: rawLines,
        httpRequests: [],
        sentryEvents: [],
      });

      const { lineNumberIndex } = useLogStore.getState();
      expect(lineNumberIndex.size).toBe(2);
      expect(lineNumberIndex.get(10)?.displayTime).toBe('10:00:00.000000');
      expect(lineNumberIndex.get(20)?.displayTime).toBe('10:00:01.000000');
      expect(lineNumberIndex.get(99)).toBeUndefined();
    });
  });
});
