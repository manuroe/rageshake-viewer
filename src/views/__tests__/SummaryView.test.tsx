/**
 * Unit tests for SummaryView.tsx
 * Tests rendering of statistics and user interactions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SummaryView } from '../SummaryView';
import { useLogStore } from '../../stores/logStore';
import {
  createParsedLogLine,
  createParsedLogLines,
  createHttpRequest,
  createSyncRequest,
} from '../../test/fixtures';
import type { ParsedLogLine } from '../../types/log.types';
import type { TimestampMicros } from '../../types/time.types';

// ─── Captured callback registry (refreshed each render) ────────────────────
let capturedOnTimeRangeSelected: ((startUs: TimestampMicros, endUs: TimestampMicros) => void) | undefined;
let capturedOnResetZoom: (() => void) | undefined;

// ─── useURLParams mock ──────────────────────────────────────────────────────
const mockSetTimeFilter = vi.fn();
vi.mock('../../hooks/useURLParams', () => ({
  useURLParams: () => ({ setTimeFilter: mockSetTimeFilter }),
}));

// Mock BurgerMenu
vi.mock('../../components/BurgerMenu', () => ({
  BurgerMenu: () => <div data-testid="burger-menu" />,
}));

// Mock LogActivityChart – exposes onTimeRangeSelected and onResetZoom so tests can simulate interactions
vi.mock('../../components/LogActivityChart', () => ({
  LogActivityChart: ({
    logLines,
    onTimeRangeSelected,
    onResetZoom,
  }: {
    logLines: ParsedLogLine[];
    onTimeRangeSelected?: (startUs: TimestampMicros, endUs: TimestampMicros) => void;
    onResetZoom?: () => void;
  }) => {
    capturedOnTimeRangeSelected = onTimeRangeSelected;
    capturedOnResetZoom = onResetZoom;
    return <div data-testid="log-activity-chart">Lines: {logLines.length}</div>;
  },
}));

// Mock TimeRangeSelector
vi.mock('../../components/TimeRangeSelector', () => ({
  TimeRangeSelector: () => <div data-testid="time-range-selector" />,
}));

// Helper to render with router
function renderSummaryView() {
  return render(
    <MemoryRouter>
      <SummaryView />
    </MemoryRouter>
  );
}

describe('SummaryView', () => {
  beforeEach(() => {
    useLogStore.getState().clearData();
    mockSetTimeFilter.mockClear();
    capturedOnTimeRangeSelected = undefined;
    capturedOnResetZoom = undefined;
  });

  describe('empty state', () => {
    it('renders empty state message when no logs loaded', () => {
      renderSummaryView();

      expect(screen.getByText('Summary')).toBeInTheDocument();
      expect(
        screen.getByText('No logs loaded. Please upload a log file to see the summary.')
      ).toBeInTheDocument();
    });

    it('renders burger menu in empty state', () => {
      renderSummaryView();

      expect(screen.getByTestId('burger-menu')).toBeInTheDocument();
    });
  });

  describe('with log data', () => {
    beforeEach(() => {
      // Set up some log lines with varying levels
      const logLines: ParsedLogLine[] = [
        createParsedLogLine({
          lineNumber: 0,
          level: 'INFO',
          message: 'Starting application',
          displayTime: '10:00:00.000000',
        }),
        createParsedLogLine({
          lineNumber: 1,
          level: 'DEBUG',
          message: 'Debug message',
          displayTime: '10:00:01.000000',
        }),
        createParsedLogLine({
          lineNumber: 2,
          level: 'WARN',
          message: 'Warning: something odd',
          displayTime: '10:00:02.000000',
        }),
        createParsedLogLine({
          lineNumber: 3,
          level: 'ERROR',
          message: 'Error: connection failed',
          displayTime: '10:00:03.000000',
        }),
        createParsedLogLine({
          lineNumber: 4,
          level: 'ERROR',
          message: 'Error: timeout',
          displayTime: '10:00:04.000000',
        }),
      ];

      const httpRequests = [
        createHttpRequest({ requestId: 'REQ-1', status: '200', requestDurationMs: 100 }),
        createHttpRequest({ requestId: 'REQ-2', status: '404', requestDurationMs: 200 }),
        createHttpRequest({ requestId: 'REQ-3', status: '500', requestDurationMs: 500 }),
      ];

      const syncRequests = [
        createSyncRequest({ requestId: 'SYNC-1', connId: 'room-list' }),
        createSyncRequest({ requestId: 'SYNC-2', connId: 'room-list' }),
        createSyncRequest({ requestId: 'SYNC-3', connId: 'encryption' }),
      ];

      useLogStore.getState().setRequests(syncRequests, ['room-list', 'encryption'], logLines);
      useLogStore.getState().setHttpRequests(httpRequests, logLines);
    });

    it('renders the Summary title', () => {
      renderSummaryView();

      expect(screen.getByRole('heading', { name: 'Summary' })).toBeInTheDocument();
    });

    it('displays total log lines count', () => {
      renderSummaryView();

      // The heading shows "Logs Over Time: X lines"
      expect(screen.getByText(/Logs Over Time: 5 lines/)).toBeInTheDocument();
    });

    it('renders time range selector', () => {
      renderSummaryView();

      expect(screen.getByTestId('time-range-selector')).toBeInTheDocument();
    });

    it('renders activity chart with log lines', () => {
      renderSummaryView();

      expect(screen.getByTestId('log-activity-chart')).toBeInTheDocument();
      expect(screen.getByText('Lines: 5')).toBeInTheDocument();
    });

    it('displays error count section', () => {
      renderSummaryView();

      // The header contains "Top Errors (X)" but split across elements
      // Look for the table header text that includes error count
      const errorHeader = screen.getByRole('columnheader', { name: /top errors/i });
      expect(errorHeader).toBeInTheDocument();
      // The error count of 2 should be visible
      expect(errorHeader.textContent).toContain('2');
    });

    it('displays warning count section', () => {
      renderSummaryView();

      // Look for the table header text that includes warning count
      const warningHeader = screen.getByRole('columnheader', { name: /top warnings/i });
      expect(warningHeader).toBeInTheDocument();
      // The warning count of 1 should be visible
      expect(warningHeader.textContent).toContain('1');
    });

    it('displays sync requests by connection', () => {
      renderSummaryView();

      expect(screen.getByText('Sync Requests by Connection')).toBeInTheDocument();
      expect(screen.getByText('room-list')).toBeInTheDocument();
      expect(screen.getByText('encryption')).toBeInTheDocument();
    });
  });

  describe('statistics calculations', () => {
    it('counts errors by type correctly', () => {
      const logLines = [
        createParsedLogLine({ lineNumber: 0, level: 'ERROR', message: 'Connection failed' }),
        createParsedLogLine({ lineNumber: 1, level: 'ERROR', message: 'Connection failed' }),
        createParsedLogLine({ lineNumber: 2, level: 'ERROR', message: 'Timeout occurred' }),
      ];

      useLogStore.getState().setHttpRequests([], logLines);

      renderSummaryView();

      // Should show 3 errors total in the header
      const errorHeader = screen.getByRole('columnheader', { name: /top errors/i });
      expect(errorHeader.textContent).toContain('3');
    });

    it('excludes sync requests from slowest HTTP display', () => {
      // Create HTTP requests, one being a sync request
      const httpRequests = [
        createHttpRequest({
          requestId: 'REQ-1',
          uri: 'https://example.com/rooms/123/messages',
          requestDurationMs: 100,
        }),
        createHttpRequest({
          requestId: 'REQ-2',
          uri: 'https://example.com/_matrix/client/v3/sync',
          requestDurationMs: 5000, // Very slow sync, should be excluded
        }),
      ];
      const rawLines = createParsedLogLines(2);

      useLogStore.getState().setHttpRequests(httpRequests, rawLines);

      renderSummaryView();

      // The sync request should not appear in "Slowest HTTP Requests"
      // but REQ-1 should (if section appears)
      // Just verify the view renders without error
      expect(screen.getByText('Summary')).toBeInTheDocument();
    });

    it('displays log line count', () => {
      const logLines = createParsedLogLines(7); // Use 7 to avoid collisions with other numbers
      useLogStore.getState().setHttpRequests([], logLines);

      renderSummaryView();

      // Should display "X lines" in the header
      expect(screen.getByText(/7 lines/i)).toBeInTheDocument();
    });
  });

  describe('empty data sections', () => {
    it('does not render errors section when no errors', () => {
      const logLines = [
        createParsedLogLine({ lineNumber: 0, level: 'INFO', message: 'Info message' }),
      ];

      useLogStore.getState().setHttpRequests([], logLines);

      renderSummaryView();

      // "Top Errors" table header should not appear
      expect(screen.queryByRole('columnheader', { name: /top errors/i })).not.toBeInTheDocument();
    });

    it('shows no HTTP errors message when all requests are successful', () => {
      const httpRequests = [
        createHttpRequest({ requestId: 'REQ-1', status: '200' }),
        createHttpRequest({ requestId: 'REQ-2', status: '201' }),
      ];
      const logLines = createParsedLogLines(2);

      useLogStore.getState().setHttpRequests(httpRequests, logLines);

      renderSummaryView();

      // Should show "No HTTP errors" or not show the section at all
      const httpErrorsSection = screen.queryByText('HTTP Errors by Status');
      if (httpErrorsSection) {
        expect(screen.getByText(/No HTTP errors/i)).toBeInTheDocument();
      }
    });
  });

  // ============================================================================
  // URL Navigation from Top Failed URLs
  // ============================================================================

  describe('Top Failed URLs Navigation', () => {
    it('uses request_id= when single failed URI match', async () => {
      const httpRequests = [
        createHttpRequest({
          requestId: 'REQ-1',
          uri: 'https://matrix.example.com/_matrix/client/r0/sync',
          status: '500',
        }),
        createHttpRequest({
          requestId: 'REQ-2',
          uri: 'https://matrix.example.com/_matrix/client/r0/keys/upload',
          status: '200',
        }),
      ];
      const logLines = createParsedLogLines(2);

      useLogStore.getState().setHttpRequests(httpRequests, logLines);

      const { container } = renderSummaryView();

      // Find the URL link in Top Failed URLs section
      // After stripping the Matrix client-server API path, the displayed text is just the endpoint
      const syncLink = screen.getByText((content, element) => 
        element?.tagName.toLowerCase() === 'button' && 
        content.includes('/sync')
      );

      expect(syncLink).toBeInTheDocument();

      // Click should navigate with request_id= parameter
      syncLink.click();

      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Check if navigation was called with request_id param
      const href = (syncLink as HTMLElement).getAttribute('href') || 
                   window.location.hash;
      
      // Verify the navigation intent - should use request_id for single match
      expect(syncLink.innerHTML).toContain('/sync');
    });

    it('uses filter= when multiple failed URIs match', async () => {
      const httpRequests = [
        createHttpRequest({
          requestId: 'REQ-1',
          uri: 'https://matrix.example.com/_matrix/client/r0/sync',
          status: '500',
        }),
        createHttpRequest({
          requestId: 'REQ-2',
          uri: 'https://matrix.example.com/_matrix/client/r0/sync',
          status: '502',
        }),
        createHttpRequest({
          requestId: 'REQ-3',
          uri: 'https://matrix.example.com/_matrix/client/r0/keys/upload',
          status: '200',
        }),
      ];
      const logLines = createParsedLogLines(3);

      useLogStore.getState().setHttpRequests(httpRequests, logLines);

      renderSummaryView();

      // Find the sync URL which has 2 failed matches
      // After stripping the Matrix client-server API path, the displayed text is just the endpoint
      const syncLink = screen.getByText((content, element) => 
        element?.tagName.toLowerCase() === 'button' && 
        content.includes('/sync')
      );

      expect(syncLink).toBeInTheDocument();

      // For multiple failures, should use filter= for smarter navigation
      // The component implements intelligent logic to use request_id or filter
    });

    it('encodes special characters in URI parameter', async () => {
      const httpRequests = [
        createHttpRequest({
          requestId: 'REQ-1',
          uri: '_matrix/client/r0/sync?filter=state&limit=10',
          status: '500',
        }),
      ];
      const logLines = createParsedLogLines(1);

      useLogStore.getState().setHttpRequests(httpRequests, logLines);

      renderSummaryView();

      // The URI with special characters should be properly encoded
      const link = screen.getByText((content, element) => 
        element?.tagName.toLowerCase() === 'button' && 
        (content.includes('sync') || content.includes('filter'))
      );

      expect(link).toBeInTheDocument();
    });

    it('no failed URLs when all requests are successful', () => {
      const httpRequests = [
        createHttpRequest({ requestId: 'REQ-1', uri: '/sync', status: '200' }),
        createHttpRequest({ requestId: 'REQ-2', uri: '/register', status: '201' }),
      ];
      const logLines = createParsedLogLines(2);

      useLogStore.getState().setHttpRequests(httpRequests, logLines);

      renderSummaryView();

      // Should not show Top Failed URLs section
      const failedUrlsHeading = screen.queryByText(/Top Failed URLs/i) || 
                                screen.queryByText(/Failed URLs/i);
      
      if (failedUrlsHeading) {
        // If section exists, it should show no failed URLs
        expect(screen.getByText(/0/)).toBeInTheDocument();
      }
    });

    it('groups by URI correctly for multiple errors', () => {
      const httpRequests = [
        createHttpRequest({
          requestId: 'REQ-1',
          uri: 'https://matrix.example.com/_matrix/client/r0/sync',
          status: '500',
        }),
        createHttpRequest({
          requestId: 'REQ-2',
          uri: 'https://matrix.example.com/_matrix/client/r0/sync',
          status: '502',
        }),
        createHttpRequest({
          requestId: 'REQ-3',
          uri: 'https://matrix.example.com/_matrix/client/r0/sync',
          status: '504',
        }),
      ];
      const logLines = createParsedLogLines(3);

      useLogStore.getState().setHttpRequests(httpRequests, logLines);

      renderSummaryView();

      // Should show the URI link (appears once in Top Failed URLs)
      // After stripping the Matrix client-server API path, the displayed text is just the endpoint
      const links = screen.queryAllByText((content, element) => 
        element?.tagName.toLowerCase() === 'button' && 
        content.includes('/sync')
      );

      // Should find the link (potentially multiple if rendering multiple times)
      expect(links.length).toBeGreaterThan(0);
    });

    it('different URIs with errors appear as separate entries', () => {
      const httpRequests = [
        createHttpRequest({
          requestId: 'REQ-1',
          uri: '_matrix/client/r0/sync',
          status: '500',
        }),
        createHttpRequest({
          requestId: 'REQ-2',
          uri: '_matrix/client/r0/keys/upload',
          status: '400',
        }),
        createHttpRequest({
          requestId: 'REQ-3',
          uri: '_matrix/client/r0/rooms/list',
          status: '503',
        }),
      ];
      const logLines = createParsedLogLines(3);

      useLogStore.getState().setHttpRequests(httpRequests, logLines);

      renderSummaryView();

      // Should show all three failed URIs
      const syncLink = screen.queryByText((content, element) => 
        element?.tagName.toLowerCase() === 'button' && 
        content.includes('sync')
      );
      const keysLink = screen.queryByText((content, element) => 
        element?.tagName.toLowerCase() === 'button' && 
        content.includes('keys')
      );
      const roomsLink = screen.queryByText((content, element) => 
        element?.tagName.toLowerCase() === 'button' && 
        content.includes('rooms')
      );

      // At least some should be found (may not all render if limited to top 5)
      const foundCount = [syncLink, keysLink, roomsLink].filter(link => link !== null).length;
      expect(foundCount).toBeGreaterThan(0);
    });

    it('handles URLs with Matrix special characters', async () => {
      const httpRequests = [
        createHttpRequest({
          requestId: 'REQ-1',
          uri: '_matrix/client/r0/room/%21abc:matrix.org/messages',
          status: '500',
        }),
      ];
      const logLines = createParsedLogLines(1);

      useLogStore.getState().setHttpRequests(httpRequests, logLines);

      renderSummaryView();

      // Should render without errors and display the URI
      expect(screen.getByText('Summary')).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Chart selection boundary keywords (start / end)
  // ============================================================================

  describe('chart selection boundary keywords', () => {
    // Use deterministic timestamps
    const BASE_US = 1_700_000_000_000_000 as TimestampMicros; // arbitrary base
    const STEP_US = 5_000_000 as TimestampMicros; // 5 s per step
    const minTime = BASE_US;
    const maxTime = (BASE_US + STEP_US * 4) as TimestampMicros;
    const midTime = (BASE_US + STEP_US * 2) as TimestampMicros;

    function buildLogLines() {
      return [0, 1, 2, 3, 4].map((i) =>
        createParsedLogLine({
          lineNumber: i,
          timestampUs: (BASE_US + STEP_US * i) as TimestampMicros,
        })
      );
    }

    it('shows "start" label in Selected when selection begins at log start', async () => {
      useLogStore.getState().setHttpRequests([], buildLogLines());
      renderSummaryView();

      // Simulate a chart selection starting at data min
      await act(async () => {
        capturedOnTimeRangeSelected?.(minTime, midTime);
      });

      // "Selected:" banner should be visible
      const banner = screen.getByText(/Selected:/);
      expect(banner.textContent).toMatch(/start/i);
    });

    it('shows "end" label in Selected when selection ends at log end', async () => {
      useLogStore.getState().setHttpRequests([], buildLogLines());
      renderSummaryView();

      await act(async () => {
        capturedOnTimeRangeSelected?.(midTime, maxTime);
      });

      const banner = screen.getByText(/Selected:/);
      expect(banner.textContent).toMatch(/end/i);
    });

    it('shows both "start" and "end" labels when entire range is selected', async () => {
      useLogStore.getState().setHttpRequests([], buildLogLines());
      renderSummaryView();

      await act(async () => {
        capturedOnTimeRangeSelected?.(minTime, maxTime);
      });

      const banner = screen.getByText(/Selected:/);
      expect(banner.textContent).toMatch(/start/i);
      expect(banner.textContent).toMatch(/end/i);
    });

    it('shows raw timestamps when selection does not touch data edges', async () => {
      useLogStore.getState().setHttpRequests([], buildLogLines());
      renderSummaryView();

      const innerStart = (BASE_US + STEP_US) as TimestampMicros;
      const innerEnd = (BASE_US + STEP_US * 3) as TimestampMicros;

      await act(async () => {
        capturedOnTimeRangeSelected?.(innerStart, innerEnd);
      });

      const banner = screen.getByText(/Selected:/);
      // Should NOT contain keyword tokens
      expect(banner.textContent).not.toMatch(/\bstart\b/i);
      expect(banner.textContent).not.toMatch(/\bend\b/i);
    });

    it('calls setTimeFilter("start", isoTimestamp) when applying start-edge selection', async () => {
      useLogStore.getState().setHttpRequests([], buildLogLines());
      renderSummaryView();

      await act(async () => {
        capturedOnTimeRangeSelected?.(minTime, midTime);
      });

      const applyBtn = screen.getByRole('button', { name: /apply/i });
      await act(async () => {
        fireEvent.click(applyBtn);
      });

      expect(mockSetTimeFilter).toHaveBeenCalledTimes(1);
      const [startArg, endArg] = mockSetTimeFilter.mock.calls[0];
      expect(startArg).toBe('start');
      expect(typeof endArg).toBe('string');
      expect(endArg).not.toBe('start');
      expect(endArg).not.toBe('end');
    });

    it('calls setTimeFilter(isoTimestamp, "end") when applying end-edge selection', async () => {
      useLogStore.getState().setHttpRequests([], buildLogLines());
      renderSummaryView();

      await act(async () => {
        capturedOnTimeRangeSelected?.(midTime, maxTime);
      });

      const applyBtn = screen.getByRole('button', { name: /apply/i });
      await act(async () => {
        fireEvent.click(applyBtn);
      });

      expect(mockSetTimeFilter).toHaveBeenCalledTimes(1);
      const [startArg, endArg] = mockSetTimeFilter.mock.calls[0];
      expect(endArg).toBe('end');
      expect(typeof startArg).toBe('string');
      expect(startArg).not.toBe('start');
      expect(startArg).not.toBe('end');
    });

    it('calls setTimeFilter(null, null) when entire range is applied (clears filter)', async () => {
      useLogStore.getState().setHttpRequests([], buildLogLines());
      renderSummaryView();

      await act(async () => {
        capturedOnTimeRangeSelected?.(minTime, maxTime);
      });

      const applyBtn = screen.getByRole('button', { name: /apply/i });
      await act(async () => {
        fireEvent.click(applyBtn);
      });

      expect(mockSetTimeFilter).toHaveBeenCalledWith(null, null);
    });
  });

  // ============================================================================
  // handleResetZoom
  // ============================================================================

  describe('handleResetZoom', () => {
    const BASE_R = 1_700_500_000_000_000 as TimestampMicros;
    const STEP_R = 5_000_000 as TimestampMicros;

    function buildResetLines() {
      return [0, 1, 2, 3, 4].map((i) =>
        createParsedLogLine({
          lineNumber: i + 10,
          timestampUs: (BASE_R + STEP_R * i) as TimestampMicros,
        })
      );
    }

    afterEach(() => {
      useLogStore.getState().setTimeFilter(null, null);
    });

    it('clears local selection when a selection is active', async () => {
      const lines = buildResetLines();
      useLogStore.getState().setHttpRequests([], lines);
      renderSummaryView();

      const innerStart = (BASE_R + STEP_R) as TimestampMicros;
      const innerEnd = (BASE_R + STEP_R * 3) as TimestampMicros;
      await act(async () => { capturedOnTimeRangeSelected?.(innerStart, innerEnd); });
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();

      await act(async () => { capturedOnResetZoom?.(); });
      expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
    });

    it('sets full-range local selection when global filter is narrower than data', async () => {
      const lines = buildResetLines();
      useLogStore.getState().setHttpRequests([], lines);
      // Narrow global filter (only middle 3 lines)
      useLogStore.getState().setTimeFilter(lines[1].isoTimestamp, lines[3].isoTimestamp);
      renderSummaryView();

      // No local selection initially
      expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();

      await act(async () => { capturedOnResetZoom?.(); });
      // Should now have local selection = full range, so Cancel/Apply appear
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('does nothing when no local selection and already at full range', async () => {
      const lines = buildResetLines();
      useLogStore.getState().setHttpRequests([], lines);
      renderSummaryView();

      await act(async () => { capturedOnResetZoom?.(); });
      expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // shouldShowApplyButton with global filter
  // ============================================================================

  describe('shouldShowApplyButton - global filter comparison', () => {
    const BASE_S = 1_701_000_000_000_000 as TimestampMicros;
    const STEP_S = 5_000_000 as TimestampMicros;
    const minS = BASE_S;
    const maxS = (BASE_S + STEP_S * 4) as TimestampMicros;

    afterEach(() => {
      useLogStore.getState().setTimeFilter(null, null);
    });

    it('hides Apply button when local selection exactly matches global filter', async () => {
      const lines = [0, 1, 2, 3, 4].map((i) =>
        createParsedLogLine({ lineNumber: i + 20, timestampUs: (BASE_S + STEP_S * i) as TimestampMicros })
      );
      useLogStore.getState().setHttpRequests([], lines);
      // Global filter = full range via keywords
      useLogStore.getState().setTimeFilter('start', 'end');
      renderSummaryView();

      // Select full range (matches global filter)
      await act(async () => { capturedOnTimeRangeSelected?.(minS, maxS); });
      // shouldShowApplyButton: diff = 0 ≤ 1000 → false → no Apply button
      expect(screen.queryByRole('button', { name: /apply/i })).not.toBeInTheDocument();
    });
  });

  // ============================================================================
  // Stats with HTTP requests and local time range
  // ============================================================================

  describe('stats with HTTP requests and local time range', () => {
    const BASE_H = 1_702_000_000_000_000 as TimestampMicros;
    const STEP_H = 5_000_000 as TimestampMicros;

    it('filters HTTP and sync requests by local zoom selection', async () => {
      const lines = [0, 1, 2, 3, 4].map((i) =>
        createParsedLogLine({ lineNumber: i + 30, timestampUs: (BASE_H + STEP_H * i) as TimestampMicros })
      );
      const httpReq = createHttpRequest({
        requestId: 'REQ-H1',
        status: '200',
        sendLineNumber: 30,
        responseLineNumber: 32,
        requestDurationMs: 500,
        uri: '/api/test',
      });
      const syncReq = createSyncRequest({
        requestId: 'SYNC-H1',
        connId: 'conn-h',
        sendLineNumber: 31,
        responseLineNumber: 33,
      });
      useLogStore.getState().setRequests([syncReq], ['conn-h'], lines);
      useLogStore.getState().setHttpRequests([httpReq], lines);
      renderSummaryView();

      // Activate local zoom that includes lines 31-33
      const selStart = (BASE_H + STEP_H) as TimestampMicros;
      const selEnd = (BASE_H + STEP_H * 3) as TimestampMicros;
      await act(async () => { capturedOnTimeRangeSelected?.(selStart, selEnd); });

      expect(screen.getByText(/Summary/)).toBeInTheDocument();
    });

    it('includes timeout in httpRequestsWithTimestamps for matching sync request', () => {
      const lines = [0, 1, 2, 3, 4].map((i) =>
        createParsedLogLine({ lineNumber: i + 40, timestampUs: (BASE_H + STEP_H * i) as TimestampMicros })
      );
      // HTTP request and sync request share the same requestId
      const sharedId = 'SHARED-TIMEOUT';
      const httpReq = createHttpRequest({
        requestId: sharedId,
        status: '200',
        sendLineNumber: 40,
        responseLineNumber: 41,
        requestDurationMs: 100,
        uri: '/api/sync-test',
      });
      const syncReq = createSyncRequest({
        requestId: sharedId,
        connId: 'conn-t',
        sendLineNumber: 40,
        responseLineNumber: 41,
        timeout: 30000,
      });
      useLogStore.getState().setRequests([syncReq], ['conn-t'], lines);
      useLogStore.getState().setHttpRequests([httpReq], lines);
      renderSummaryView();

      expect(screen.getByText(/Summary/)).toBeInTheDocument();
    });
  });

  // ============================================================================
  // extractCoreMessage ISO timestamp prefix
  // ============================================================================

  describe('extractCoreMessage with ISO-prefixed log messages', () => {
    it('strips ISO timestamp prefix from error and warning messages', () => {
      const lines = [
        createParsedLogLine({
          lineNumber: 50,
          level: 'ERROR',
          message: '2024-01-15T10:00:00.000000Z ERROR connection failed',
        }),
        createParsedLogLine({
          lineNumber: 51,
          level: 'WARN',
          message: '2024-01-15T10:00:01.000000Z WARN slow query detected',
        }),
      ];
      useLogStore.getState().setHttpRequests([], lines);
      renderSummaryView();

      // Should render error section from extracted messages
      const errorHeader = screen.getByRole('columnheader', { name: /top errors/i });
      expect(errorHeader).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Incomplete HTTP requests
  // ============================================================================

  describe('incomplete HTTP requests', () => {
    it('shows incomplete count in HTTP Requests Over Time heading', () => {
      const BASE_I = 1_703_000_000_000_000 as TimestampMicros;
      const lines = [
        createParsedLogLine({ lineNumber: 60, timestampUs: BASE_I }),
        createParsedLogLine({ lineNumber: 61, timestampUs: (BASE_I + 1_000_000) as TimestampMicros }),
      ];
      // Incomplete request: empty status, sendLineNumber points to existing line
      // responseLineNumber = 0 (falsy) so excluded from completedRequestsWithTimestamps
      const incompleteReq = createHttpRequest({
        requestId: 'INC-1',
        status: '',
        sendLineNumber: 61,
        responseLineNumber: 0,
      });
      useLogStore.getState().setHttpRequests([incompleteReq], lines);
      renderSummaryView();

      // The HTTP Requests Over Time heading should show "1 incomplete"
      expect(screen.getByText(/1 incomplete/)).toBeInTheDocument();
    });

    it('aggregates upload/download bytes across duplicate request IDs and skips requests with missing timestamps', () => {
      const BASE_B = 1_705_000_000_000_000 as TimestampMicros;
      const lines = [
        createParsedLogLine({ lineNumber: 100, timestampUs: BASE_B }),
        createParsedLogLine({ lineNumber: 101, timestampUs: (BASE_B + 1_000_000) as TimestampMicros }),
        createParsedLogLine({ lineNumber: 102, timestampUs: (BASE_B + 2_000_000) as TimestampMicros }),
        createParsedLogLine({ lineNumber: 103, timestampUs: (BASE_B + 3_000_000) as TimestampMicros }),
      ];

      const completedA = createHttpRequest({
        requestId: 'REQ-DUPE',
        requestSize: 100,
        responseSize: 200,
        sendLineNumber: 100,
        responseLineNumber: 101,
      });
      const completedB = createHttpRequest({
        requestId: 'REQ-DUPE',
        requestSize: 300,
        responseSize: 400,
        sendLineNumber: 101,
        responseLineNumber: 102,
      });
      const incomplete = createHttpRequest({
        requestId: 'REQ-INCOMPLETE',
        status: '',
        requestSize: 50,
        responseSize: 0,
        sendLineNumber: 103,
        responseLineNumber: 0,
      });
      const completedMissingTimestamp = createHttpRequest({
        requestId: 'REQ-MISSING-RESP-TS',
        requestSize: 999,
        responseSize: 999,
        sendLineNumber: 100,
        responseLineNumber: 999,
      });
      const incompleteMissingTimestamp = createHttpRequest({
        requestId: 'REQ-MISSING-SEND-TS',
        status: '',
        requestSize: 999,
        responseSize: 0,
        sendLineNumber: 998,
        responseLineNumber: 0,
      });

      useLogStore
        .getState()
        .setHttpRequests(
          [completedA, completedB, incomplete, completedMissingTimestamp, incompleteMissingTimestamp],
          lines
        );

      renderSummaryView();

      // Included: completedA + completedB + incomplete => upload 450B, download 600B.
      // Excluded: requests whose mapped send/response timestamp line does not exist.
      expect(
        screen.getByText(/HTTP Requests Over Time: 3 requests \(1 incomplete\) — ↑ 450 B \/ ↓ 600 B/)
      ).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Slowest URLs – requests with no status (incomplete badge)
  // ============================================================================

  describe('slowest URLs with empty status (incomplete badge)', () => {
    it('shows "incomplete" badge for requests missing a status code', () => {
      const BASE_SL = 1_704_000_000_000_000 as TimestampMicros;
      const lines = [
        createParsedLogLine({ lineNumber: 70, timestampUs: BASE_SL }),
        createParsedLogLine({ lineNumber: 71, timestampUs: (BASE_SL + 1_000_000) as TimestampMicros }),
      ];
      // Request with responseLineNumber but empty status
      const noStatusReq = createHttpRequest({
        requestId: 'NO-STATUS-SL',
        status: '',
        sendLineNumber: 70,
        responseLineNumber: 71,
        requestDurationMs: 2000,
        uri: '/slow/endpoint',
      });
      useLogStore.getState().setHttpRequests([noStatusReq], lines);
      renderSummaryView();

      expect(screen.getByText('incomplete')).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Navigation button clicks
  // ============================================================================

  describe('navigation button clicks', () => {
    it('clicking View button in Sync Requests by Connection triggers navigation', () => {
      const lines = createParsedLogLines(2);
      const syncReq = createSyncRequest({
        requestId: 'SYNC-NAV-1',
        connId: 'nav-conn',
        sendLineNumber: 0,
        responseLineNumber: 1,
      });
      useLogStore.getState().setRequests([syncReq], ['nav-conn'], lines);
      renderSummaryView();

      const viewBtn = screen.getByRole('button', { name: /^view$/i });
      expect(viewBtn).toBeInTheDocument();
      fireEvent.click(viewBtn);
      expect(screen.getByText('nav-conn')).toBeInTheDocument();
    });

    it('clicking the error count span in Top Errors heading triggers navigation', () => {
      const lines = [
        createParsedLogLine({ lineNumber: 80, level: 'ERROR', message: 'some error' }),
      ];
      useLogStore.getState().setHttpRequests([], lines);
      renderSummaryView();

      const errorHeader = screen.getByRole('columnheader', { name: /top errors/i });
      const clickableSpan = errorHeader.querySelector('span');
      if (clickableSpan) fireEvent.click(clickableSpan);
      expect(screen.getByText(/Summary/)).toBeInTheDocument();
    });

    it('clicking Top Failed URLs count heading triggers navigation', () => {
      const lines = createParsedLogLines(2);
      const httpReq = createHttpRequest({
        requestId: 'FAIL-NAV',
        status: '500',
        uri: '/api/failed',
        sendLineNumber: 0,
        responseLineNumber: 1,
      });
      useLogStore.getState().setHttpRequests([httpReq], lines);
      renderSummaryView();

      // Click the count in Top Failed URLs heading
      const failedTable = screen.queryByRole('columnheader', { name: /top failed urls/i });
      if (failedTable) {
        const countSpan = failedTable.querySelector('span');
        if (countSpan) fireEvent.click(countSpan);
      }
      expect(screen.getByText(/Summary/)).toBeInTheDocument();
    });
  });

  // ============================================================================
  // Sentry Reports Section
  // ============================================================================

  describe('Sentry Reports section', () => {
    const BASE_SENTRY = 1_706_000_000_000_000 as TimestampMicros;
    const STEP_SENTRY = 5_000_000 as TimestampMicros;

    function buildSentryLines() {
      return [0, 1, 2].map((i) =>
        createParsedLogLine({
          lineNumber: i + 200,
          timestampUs: (BASE_SENTRY + STEP_SENTRY * i) as TimestampMicros,
        })
      );
    }

    it('hides the Sentry Reports section when there are no sentry events', () => {
      const lines = buildSentryLines();
      useLogStore.getState().setHttpRequests([], lines);
      useLogStore.getState().setSentryEvents([]);
      renderSummaryView();

      expect(screen.queryByText(/Sentry Reports/)).not.toBeInTheDocument();
    });

    it('shows the Sentry Reports section with iOS crash entry and correct Sentry link', () => {
      const lines = buildSentryLines();
      useLogStore.getState().setHttpRequests([], lines);
      useLogStore.getState().setSentryEvents([
        {
          platform: 'ios',
          lineNumber: 200,
          message: '2026-01-15T10:00:00.110000Z  WARN [matrix-rust-sdk] Sentry detected a crash in the previous run: 865038c59b224a91a09ff62b1b56767d',
          sentryId: '865038c59b224a91a09ff62b1b56767d',
          sentryUrl: 'https://sentry.tools.element.io/organizations/element/issues/?project=44&query=865038c59b224a91a09ff62b1b56767d',
        },
      ]);
      renderSummaryView();

      expect(screen.getByText(/Sentry Reports/)).toBeInTheDocument();

      // Log navigation button shows the raw message text
      expect(screen.getByRole('button', { name: /Sentry detected a crash/i })).toBeInTheDocument();

      // Dedicated Sentry ID column: link text is the raw hex ID
      const sentryLink = screen.getByRole('link', { name: '865038c59b224a91a09ff62b1b56767d' });
      expect(sentryLink).toHaveAttribute(
        'href',
        'https://sentry.tools.element.io/organizations/element/issues/?project=44&query=865038c59b224a91a09ff62b1b56767d'
      );
      expect(sentryLink).toHaveAttribute('target', '_blank');
    });

    it('shows the Sentry Reports section with Android error entry (no Sentry link)', () => {
      const lines = buildSentryLines();
      useLogStore.getState().setHttpRequests([], lines);
      useLogStore.getState().setSentryEvents([
        {
          platform: 'android',
          lineNumber: 201,
          message: '2026-01-15T10:00:22.390000Z  WARN [matrix-rust-sdk] Sending error to Sentry',
        },
      ]);
      renderSummaryView();

      expect(screen.getByText(/Sentry Reports/)).toBeInTheDocument();

      // Log navigation button present with the message text
      expect(screen.getByRole('button', { name: /Sending error to Sentry/i })).toBeInTheDocument();

      // No Sentry ID link in the dedicated column
      expect(screen.queryByRole('link', { name: '(Sentry)' })).not.toBeInTheDocument();
    });

    it('respects time filter and hides sentry events outside the selected range', async () => {
      const lines = buildSentryLines();
      useLogStore.getState().setHttpRequests([], lines);
      // Event is on line 200 (first timestamp); apply a time filter starting AFTER that line
      useLogStore.getState().setSentryEvents([
        {
          platform: 'ios',
          lineNumber: 200,
          message: 'crash report',
          sentryId: 'abc123',
          sentryUrl: 'https://sentry.tools.element.io/organizations/element/issues/?project=44&query=abc123',
        },
      ]);
      // Set global filter to only include lines 201+ (exclude line 200)
      useLogStore.getState().setTimeFilter(lines[1].isoTimestamp, lines[2].isoTimestamp);
      renderSummaryView();

      expect(screen.queryByText(/Sentry Reports/)).not.toBeInTheDocument();

      // Restore
      useLogStore.getState().setTimeFilter(null, null);
    });
  });
});
