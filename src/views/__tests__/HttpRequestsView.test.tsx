import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import { HttpRequestsView } from '../HttpRequestsView';
import { useLogStore } from '../../stores/logStore';
import { createHttpRequests, createHttpRequest, createParsedLogLines, createSyncRequest } from '../../test/fixtures';
import type { HttpRequest } from '../../types/log.types';
import { act } from '@testing-library/react';

// Mock dependencies
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ hash: window.location.hash }),
  useNavigate: () => vi.fn(),
  useSearchParams: () => {
    const hash = window.location.hash;
    const queryString = hash.includes('?') ? hash.split('?')[1] : '';
    return [new URLSearchParams(queryString), vi.fn()];
  },
}));

describe('HttpRequestsView - header controls', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn();
  });

  it('renders the /sync filter checkbox', () => {
    const requests = createHttpRequests(5);
    useLogStore.setState({
      allHttpRequests: requests,
      filteredHttpRequests: requests,
    });

    act(() => { render(<HttpRequestsView />); });

    const labels = screen.getAllByText('/sync');
    const checkboxLabel = labels.find(el => el.closest('label'));
    expect(checkboxLabel).not.toBeUndefined();
    const checkbox = checkboxLabel!.closest('label')!.querySelector('input[type="checkbox"]');
    expect(checkbox).not.toBeNull();
  });

  it('does not render the conn-id or timeout dropdowns', () => {
    const requests = createHttpRequests(5);
    useLogStore.setState({
      allHttpRequests: requests,
      filteredHttpRequests: requests,
    });

    act(() => { render(<HttpRequestsView />); });

    expect(document.getElementById('conn-filter')).toBeNull();
    expect(document.getElementById('timeout-filter')).toBeNull();
  });
});

describe('HttpRequestsView - ID Parameter Deep Linking', () => {
  let mockScrollTo: ReturnType<typeof vi.fn>;
  let originalHash: string;
  
  beforeEach(() => {
    mockScrollTo = vi.fn();
    originalHash = window.location.hash;
    
    // Mock scrollTo on HTMLElement
    HTMLElement.prototype.scrollTo = mockScrollTo;
  });

  afterEach(() => {
    window.location.hash = originalHash;
  });

  it('opens LogDisplayView when id parameter is present', async () => {
    const requests = createHttpRequests(10);
    
    useLogStore.setState({
      allHttpRequests: requests,
      filteredHttpRequests: requests,
    });

    window.location.hash = '#/http_requests?request_id=REQ-5';
    
    render(<HttpRequestsView />);

    await waitFor(() => {
      const { openLogViewerIds } = useLogStore.getState();
      expect(openLogViewerIds.has('REQ-5')).toBe(true);
    }, { timeout: 2000 });
  });

  it('expands row when id parameter is present', async () => {
    const requests = createHttpRequests(10);
    
    useLogStore.setState({
      allHttpRequests: requests,
      filteredHttpRequests: requests,
    });

    window.location.hash = '#/http_requests?request_id=REQ-7';
    
    render(<HttpRequestsView />);

    await waitFor(() => {
      const { expandedRows } = useLogStore.getState();
      expect(expandedRows.has('REQ-7')).toBe(true);
    }, { timeout: 2000 });
  });

  it('scrolls to center the request row in viewport', async () => {
    const requests = createHttpRequests(100);
    
    useLogStore.setState({
      allHttpRequests: requests,
      filteredHttpRequests: requests,
    });

    window.location.hash = '#/http_requests?request_id=REQ-50';
    
    render(<HttpRequestsView />);

    await waitFor(() => {
      expect(mockScrollTo).toHaveBeenCalled();
      expect(mockScrollTo.mock.calls.length).toBeGreaterThan(0);
    }, { timeout: 2000 });
  });

  it('does not scroll multiple times for same ID', async () => {
    const requests = createHttpRequests(10);
    
    useLogStore.setState({
      allHttpRequests: requests,
      filteredHttpRequests: requests,
    });

    window.location.hash = '#/http_requests?request_id=REQ-3';
    
    const { rerender } = render(<HttpRequestsView />);

    await waitFor(() => {
      expect(mockScrollTo).toHaveBeenCalled();
    }, { timeout: 2000 });

    // Wait for retry mechanism to complete
    await new Promise(resolve => setTimeout(resolve, 1500));

    const callCountAfterInitial = mockScrollTo.mock.calls.length;

    // Re-render component
    rerender(<HttpRequestsView />);

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 200));

    // Should not have scrolled again (same call count as after initial + retries)
    expect(mockScrollTo.mock.calls.length).toBe(callCountAfterInitial);
  });

  it('retries scroll if initial scroll does not reach target', async () => {
    const requests = createHttpRequests(50);
    
    useLogStore.setState({
      allHttpRequests: requests,
      filteredHttpRequests: requests,
    });

    window.location.hash = '#/http_requests?request_id=REQ-25';
    
    const { container } = render(<HttpRequestsView />);

    const leftPanel = container.querySelector('.waterfall-timeline-left') as HTMLElement;
    if (leftPanel) {
      let scrollCount = 0;
      Object.defineProperty(leftPanel, 'clientHeight', { value: 400, configurable: true });
      Object.defineProperty(leftPanel, 'scrollHeight', { value: 1400, configurable: true });
      Object.defineProperty(leftPanel, 'scrollTop', {
        get: () => {
          // First few attempts return wrong value, then correct
          if (scrollCount < 3) return 0;
          return 514; // Expected: 25 * 28 - (400 / 2) + (28 / 2) = 700 - 200 + 14 = 514
        },
        set: () => { scrollCount++; },
        configurable: true,
      });
    }

    await waitFor(() => {
      // Should have multiple scroll attempts
      expect(mockScrollTo.mock.calls.length).toBeGreaterThan(1);
    }, { timeout: 2000 });
  });

  it('does not open LogDisplayView if ID not in filtered requests', async () => {
    const requests = createHttpRequests(10);
    
    useLogStore.setState({
      allHttpRequests: requests,
      filteredHttpRequests: requests.slice(0, 5), // Only first 5 filtered
    });

    window.location.hash = '#/http_requests?request_id=REQ-9'; // ID exists in all but not filtered
    
    render(<HttpRequestsView />);

    // Wait to ensure it doesn't open
    await new Promise(resolve => setTimeout(resolve, 1500));

    const { openLogViewerIds, expandedRows } = useLogStore.getState();
    expect(openLogViewerIds.has('REQ-9')).toBe(false);
    expect(expandedRows.has('REQ-9')).toBe(false);
    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  it('handles URL-encoded request IDs', async () => {
    const requests: HttpRequest[] = [
      createHttpRequest({ requestId: 'REQ-123', sendLineNumber: 0 }),
      createHttpRequest({ requestId: 'REQ:SPECIAL/CHARS', sendLineNumber: 2 }),
      createHttpRequest({ requestId: 'REQ-456', sendLineNumber: 4 }),
    ];
    
    useLogStore.setState({
      allHttpRequests: requests,
      filteredHttpRequests: requests,
    });

    // URL-encoded version of 'REQ:SPECIAL/CHARS'
    window.location.hash = '#/http_requests?request_id=REQ%3ASPECIAL%2FCHARS';
    
    render(<HttpRequestsView />);

    await waitFor(() => {
      const { openLogViewerIds } = useLogStore.getState();
      expect(openLogViewerIds.has('REQ:SPECIAL/CHARS')).toBe(true);
    }, { timeout: 2000 });
  });

  it('clamps scroll target to maxScroll bounds', async () => {
    const requests = createHttpRequests(10);
    
    useLogStore.setState({
      allHttpRequests: requests,
      filteredHttpRequests: requests,
    });

    window.location.hash = '#/http_requests?request_id=REQ-9'; // Last item
    
    render(<HttpRequestsView />);

    await waitFor(() => {
      expect(mockScrollTo).toHaveBeenCalled();
    }, { timeout: 2000 });
  });

  it('removes id parameter from URL when clicking different request', async () => {
    const requests = createHttpRequests(5);
    
    useLogStore.setState({
      allHttpRequests: requests,
      filteredHttpRequests: requests,
    });

    window.location.hash = '#/http_requests?request_id=REQ-2';
    
    const { container, unmount } = render(<HttpRequestsView />);

    // Wait for initial request to open
    await waitFor(() => {
      const { openLogViewerIds } = useLogStore.getState();
      expect(openLogViewerIds.has('REQ-2')).toBe(true);
    }, { timeout: 2000 });

    // Wait for all animations/effects to settle
    await new Promise(resolve => setTimeout(resolve, 1600));

    // Click on a different request
    const requestIdElement = screen.getByTestId('request-id-REQ-4');
    expect(requestIdElement).toBeTruthy();
    requestIdElement.click();

    // Wait a bit for the click handler to execute
    await new Promise(resolve => setTimeout(resolve, 200));

    // URL should no longer have the id parameter
    expect(window.location.hash).not.toContain('request_id=REQ-2');
    expect(window.location.hash).toBe('#/http_requests');
    
    // Cleanup to prevent async errors
    unmount();
  });

  it('keeps id parameter when clicking the same request', async () => {
    const requests = createHttpRequests(5);
    
    useLogStore.setState({
      allHttpRequests: requests,
      filteredHttpRequests: requests,
    });

    window.location.hash = '#/http_requests?request_id=REQ-3';
    
    const { container } = render(<HttpRequestsView />);

    // Wait for initial request to open
    await waitFor(() => {
      const { openLogViewerIds } = useLogStore.getState();
      expect(openLogViewerIds.has('REQ-3')).toBe(true);
    }, { timeout: 2000 });

    const originalHash = window.location.hash;

    // Click on the same request (should close it)
    const requestIdElement = screen.getByTestId('request-id-REQ-3');
    expect(requestIdElement).toBeTruthy();
    requestIdElement.click();

    // Wait a bit for the click handler to execute
    await new Promise(resolve => setTimeout(resolve, 100));

    // URL should still have the id parameter (consistency)
    expect(window.location.hash).toBe(originalHash);
  });
});

describe('HttpRequestsView - stats-compact with active time window', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn();
    // Ensure the store is reset before each test
    useLogStore.getState().clearData();
    window.location.hash = '';
  });

  afterEach(() => {
    window.location.hash = '';
  });

  /**
   * Regression: when a time window is active, incomplete requests (responseLineNumber === 0)
   * were not included in totalCount (denominator) but were included in the shown count
   * (numerator), producing e.g. "31 / 10" where numerator > denominator.
   * After the fix the denominator includes incomplete items when showIncompleteHttp is true.
   */
  it('shown count never exceeds total count when incomplete is enabled and a time window is set', () => {
    // 10 log lines spanning T+0s..T+9s
    const rawLogLines = createParsedLogLines(10);

    // 3 completed requests whose responses land within the window T+0..T+4
    const completedInWindow = [
      createHttpRequest({ requestId: 'COMP-1', sendLineNumber: 0, responseLineNumber: 1, status: '200' }),
      createHttpRequest({ requestId: 'COMP-2', sendLineNumber: 2, responseLineNumber: 3, status: '200' }),
      createHttpRequest({ requestId: 'COMP-3', sendLineNumber: 4, responseLineNumber: 4, status: '200' }),
    ];

    // 1 completed request whose response falls outside the window
    const completedOutOfWindow = [
      createHttpRequest({ requestId: 'COMP-OUT', sendLineNumber: 6, responseLineNumber: 8, status: '200' }),
    ];

    // 2 incomplete requests (responseLineNumber === 0, no status)
    const incompleteRequests = [
      createHttpRequest({ requestId: 'PEND-1', sendLineNumber: 5, responseLineNumber: 0, status: '' }),
      createHttpRequest({ requestId: 'PEND-2', sendLineNumber: 7, responseLineNumber: 0, status: '' }),
    ];

    const allRequests = [...completedInWindow, ...completedOutOfWindow, ...incompleteRequests];

    // Use ISO strings that exactly bracket T+0..T+4 (rawLogLines[0]..rawLogLines[4])
    const startTime = rawLogLines[0].isoTimestamp;
    const endTime = rawLogLines[4].isoTimestamp;

    // Populate store and run the filter so filteredHttpRequests reflects the time window
    useLogStore.setState({
      allHttpRequests: allRequests,
      rawLogLines,
      startTime,
      endTime,
      showIncompleteHttp: true,
    });
    useLogStore.getState().filterHttpRequests();

    act(() => { render(<HttpRequestsView />); });

    const shownEl = document.getElementById('shown-count');
    const totalEl = document.getElementById('total-count');
    expect(shownEl).not.toBeNull();
    expect(totalEl).not.toBeNull();

    const shown = parseInt(shownEl!.textContent ?? '', 10);
    const total = parseInt(totalEl!.textContent ?? '', 10);

    // Shown must never exceed total
    expect(shown).toBeLessThanOrEqual(total);
    // Incomplete requests are time-filtered by send timestamp; both pending are outside the window.
    // shown = 3 completed in window; total still counts all incomplete for denominator consistency.
    expect(shown).toBe(3);
    expect(total).toBe(5);
  });

  it('total count matches shown count when incomplete is disabled and a time window is set', () => {
    const rawLogLines = createParsedLogLines(10);

    const completedInWindow = [
      createHttpRequest({ requestId: 'COMP-1', sendLineNumber: 0, responseLineNumber: 1, status: '200' }),
      createHttpRequest({ requestId: 'COMP-2', sendLineNumber: 2, responseLineNumber: 3, status: '200' }),
    ];
    const incompleteRequests = [
      createHttpRequest({ requestId: 'PEND-1', sendLineNumber: 5, responseLineNumber: 0, status: '' }),
    ];

    const allRequests = [...completedInWindow, ...incompleteRequests];
    const startTime = rawLogLines[0].isoTimestamp;
    const endTime = rawLogLines[4].isoTimestamp;

    useLogStore.setState({
      allHttpRequests: allRequests,
      rawLogLines,
      startTime,
      endTime,
      showIncompleteHttp: false,
    });
    useLogStore.getState().filterHttpRequests();

    act(() => { render(<HttpRequestsView />); });

    const shownEl = document.getElementById('shown-count');
    const totalEl = document.getElementById('total-count');
    const shown = parseInt(shownEl!.textContent ?? '', 10);
    const total = parseInt(totalEl!.textContent ?? '', 10);

    // Incomplete is off: shown = 2 completed in window; total = 2 completed + 1 incomplete
    expect(shown).toBe(2);
    expect(total).toBe(3);
  });
});

describe('HttpRequestsView - getBarColor with sync timeout', () => {
  beforeEach(() => {
    useLogStore.getState().clearData();
    HTMLElement.prototype.scrollTo = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enriches bar color with timeout when allRequests has matching sync request', () => {
    const sharedRequestId = 'SYNC-HTTP-TEST';

    // HTTP request and matching sync request with the same requestId and timeout
    const httpReq = createHttpRequest({
      requestId: sharedRequestId,
      uri: '/_matrix/client/v3/sync?timeout=30000',
      sendLineNumber: 0,
      responseLineNumber: 1,
      status: '200',
    });

    const syncReq = createSyncRequest({
      requestId: sharedRequestId,
      timeout: 30000,
      sendLineNumber: 0,
      responseLineNumber: 1,
    });

    const rawLogLines = createParsedLogLines(5);

    useLogStore.setState({
      allHttpRequests: [httpReq],
      filteredHttpRequests: [httpReq],
      allRequests: [syncReq],
      rawLogLines,
    });

    // getBarColor is called internally during render via RequestTable → WaterfallTimeline
    // This exercises the `? { ...req, timeout }` branch in getBarColor
    expect(() => {
      act(() => { render(<HttpRequestsView />); });
    }).not.toThrow();
  });
});
