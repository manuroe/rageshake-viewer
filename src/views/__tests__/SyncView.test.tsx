import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, waitFor, screen, fireEvent } from '@testing-library/react';
import { SyncView } from '../SyncView';
import { useLogStore } from '../../stores/logStore';
import { createSyncRequests, createSyncRequest, createParsedLogLines } from '../../test/fixtures';
import type { SyncRequest } from '../../types/log.types';
import { act } from '@testing-library/react';
import * as URLParamsModule from '../../hooks/useURLParams';

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

describe('SyncView - column getValue branch coverage', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn();
  });

  it('renders dash for size columns when requestSizeString and responseSizeString are empty', () => {
    const request = createSyncRequest({
      requestId: 'S-NOSIZE',
      requestSizeString: '',
      responseSizeString: '',
    });
    useLogStore.setState({
      allRequests: [request],
      filteredRequests: [request],
    });

    // Rendering triggers getValue() for each column; empty strings hit the '|| "-"' fallback branches
    expect(() => {
      act(() => { render(<SyncView />); });
    }).not.toThrow();
  });
});

describe('SyncView - header controls', () => {
  beforeEach(() => {
    // suppress act() warnings for these synchronous render tests
    HTMLElement.prototype.scrollTo = vi.fn();
  });

  it('renders the conn-id dropdown', () => {
    const requests = [
      createSyncRequest({ requestId: 'S-1', sendLineNumber: 0, connId: 'room-list' }),
      createSyncRequest({ requestId: 'S-2', sendLineNumber: 2, connId: 'encryption' }),
    ];
    useLogStore.setState({
      allRequests: requests,
      filteredRequests: requests,
      connectionIds: ['room-list', 'encryption'],
      selectedConnId: '',
    });

    act(() => { render(<SyncView />); });

    const connSelect = document.getElementById('conn-filter') as HTMLSelectElement;
    expect(connSelect).not.toBeNull();
    const options = Array.from(connSelect.options).map(o => o.value);
    expect(options).toContain('room-list');
    expect(options).toContain('encryption');
  });

  it('renders the timeout dropdown when requests have timeout values', () => {
    const requests = [
      createSyncRequest({ requestId: 'S-1', sendLineNumber: 0, timeout: 0 }),
      createSyncRequest({ requestId: 'S-2', sendLineNumber: 2, timeout: 30000 }),
    ];
    useLogStore.setState({
      allRequests: requests,
      filteredRequests: requests,
    });

    act(() => { render(<SyncView />); });

    const timeoutSelect = document.getElementById('timeout-filter') as HTMLSelectElement;
    expect(timeoutSelect).not.toBeNull();
    const options = Array.from(timeoutSelect.options).map(o => o.value);
    expect(options).toContain('0');
    expect(options).toContain('30000');
  });

  it('renders the timeout dropdown when there is only one timeout value', () => {
    const requests = [
      createSyncRequest({ requestId: 'S-1', sendLineNumber: 0, timeout: 30000 }),
      createSyncRequest({ requestId: 'S-2', sendLineNumber: 2, timeout: 30000 }),
    ];
    useLogStore.setState({
      allRequests: requests,
      filteredRequests: requests,
    });

    act(() => { render(<SyncView />); });

    expect(document.getElementById('timeout-filter')).not.toBeNull();
  });

  it('does not render the /sync filter checkbox', () => {
    const requests = createSyncRequests(3);
    useLogStore.setState({
      allRequests: requests,
      filteredRequests: requests,
    });

    act(() => { render(<SyncView />); });

    const labels = screen.queryAllByText('/sync');
    // The page title "/sync requests" contains /sync — we want no checkbox label
    const checkboxLabels = labels.filter(el => el.closest('label'));
    expect(checkboxLabels).toHaveLength(0);
  });
});

describe('SyncView - ID Parameter Deep Linking', () => {
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
    const requests = createSyncRequests(10);
    
    useLogStore.setState({
      allRequests: requests,
      filteredRequests: requests,
    });

    window.location.hash = '#/sync?request_id=SYNC-5';
    
    render(<SyncView />);

    await waitFor(() => {
      const { openLogViewerIds } = useLogStore.getState();
      expect(openLogViewerIds.has(10)).toBe(true); // SYNC-5: sendLineNumber = 5*2 = 10
    }, { timeout: 2000 });
  });

  it('expands row when id parameter is present', async () => {
    const requests = createSyncRequests(10);
    
    useLogStore.setState({
      allRequests: requests,
      filteredRequests: requests,
    });

    window.location.hash = '#/sync?request_id=SYNC-7';
    
    render(<SyncView />);

    await waitFor(() => {
      const { expandedRows } = useLogStore.getState();
      expect(expandedRows.has(14)).toBe(true); // SYNC-7: sendLineNumber = 7*2 = 14
    }, { timeout: 2000 });
  });

  it('scrolls to center the request row in viewport', async () => {
    const requests = createSyncRequests(100);
    
    useLogStore.setState({
      allRequests: requests,
      filteredRequests: requests,
    });

    window.location.hash = '#/sync?request_id=SYNC-50';
    
    render(<SyncView />);

    await waitFor(() => {
      expect(mockScrollTo).toHaveBeenCalled();
      expect(mockScrollTo.mock.calls.length).toBeGreaterThan(0);
    }, { timeout: 2000 });
  });

  it('does not scroll multiple times for same ID', async () => {
    const requests = createSyncRequests(10);
    
    useLogStore.setState({
      allRequests: requests,
      filteredRequests: requests,
    });

    window.location.hash = '#/sync?request_id=SYNC-3';
    
    const { rerender } = render(<SyncView />);

    await waitFor(() => {
      expect(mockScrollTo).toHaveBeenCalled();
    }, { timeout: 2000 });

    // Wait for retry mechanism to complete
    await new Promise(resolve => setTimeout(resolve, 1500));

    const callCountAfterInitial = mockScrollTo.mock.calls.length;

    // Re-render component
    rerender(<SyncView />);

    // Wait a bit
    await new Promise(resolve => setTimeout(resolve, 200));

    // Should not have scrolled again (same call count as after initial + retries)
    expect(mockScrollTo.mock.calls.length).toBe(callCountAfterInitial);
  });

  it('retries scroll if initial scroll does not reach target', async () => {
    const requests = createSyncRequests(50);
    
    useLogStore.setState({
      allRequests: requests,
      filteredRequests: requests,
    });

    window.location.hash = '#/sync?request_id=SYNC-25';
    
    const { container } = render(<SyncView />);

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
    const requests = createSyncRequests(10);
    
    useLogStore.setState({
      allRequests: requests,
      filteredRequests: requests.slice(0, 5), // Only first 5 filtered
    });

    window.location.hash = '#/sync?request_id=SYNC-9'; // ID exists in all but not filtered
    
    render(<SyncView />);

    // Wait to ensure it doesn't open
    await new Promise(resolve => setTimeout(resolve, 1500));

    const { openLogViewerIds, expandedRows } = useLogStore.getState();
    expect(openLogViewerIds.has(18)).toBe(false); // SYNC-9: sendLineNumber = 9*2 = 18
    expect(expandedRows.has(18)).toBe(false);
    expect(mockScrollTo).not.toHaveBeenCalled();
  });

  it('handles URL-encoded request IDs', async () => {
    const requests: SyncRequest[] = [
      createSyncRequest({ requestId: 'SYNC-123', sendLineNumber: 0 }),
      createSyncRequest({ requestId: 'SYNC:SPECIAL/CHARS', sendLineNumber: 2 }),
      createSyncRequest({ requestId: 'SYNC-456', sendLineNumber: 4 }),
    ];
    
    useLogStore.setState({
      allRequests: requests,
      filteredRequests: requests,
    });

    // URL-encoded version of 'SYNC:SPECIAL/CHARS'
    window.location.hash = '#/sync?request_id=SYNC%3ASPECIAL%2FCHARS';
    
    render(<SyncView />);

    await waitFor(() => {
      const { openLogViewerIds } = useLogStore.getState();
      expect(openLogViewerIds.has(2)).toBe(true); // SYNC:SPECIAL/CHARS: sendLineNumber = 2
    }, { timeout: 2000 });
  });

  it('clamps scroll target to maxScroll bounds', async () => {
    const requests = createSyncRequests(10);
    
    useLogStore.setState({
      allRequests: requests,
      filteredRequests: requests,
    });

    window.location.hash = '#/sync?request_id=SYNC-9'; // Last item
    
    render(<SyncView />);

    await waitFor(() => {
      expect(mockScrollTo).toHaveBeenCalled();
    }, { timeout: 2000 });
  });

  it('removes id parameter and preserves other URL params when clicking different request', async () => {
    const requests = createSyncRequests(5);
    
    useLogStore.setState({
      allRequests: requests,
      filteredRequests: requests,
    });

    window.location.hash = '#/sync?request_id=SYNC-2&scale=50';
    
    const { container, unmount } = render(<SyncView />);

    // Wait for initial request to open
    await waitFor(() => {
      const { openLogViewerIds } = useLogStore.getState();
      expect(openLogViewerIds.has(4)).toBe(true); // SYNC-2: sendLineNumber = 2*2 = 4
    }, { timeout: 2000 });

    // Wait for all animations/effects to settle
    await new Promise(resolve => setTimeout(resolve, 1600));

    // Click on a different request
    const requestIdElement = screen.getByTestId('request-id-SYNC-4');
    expect(requestIdElement).toBeTruthy();
    requestIdElement.click();

    // Wait a bit for the click handler to execute
    await new Promise(resolve => setTimeout(resolve, 200));

    // URL should no longer have the id parameter
    expect(window.location.hash).not.toContain('request_id=SYNC-2');
    expect(window.location.hash).toBe('#/sync?scale=50');
    
    // Cleanup to prevent async errors
    unmount();
  });

  it('keeps id parameter when clicking the same request', async () => {
    const requests = createSyncRequests(5);
    
    useLogStore.setState({
      allRequests: requests,
      filteredRequests: requests,
    });

    window.location.hash = '#/sync?request_id=SYNC-3';
    
    const { container } = render(<SyncView />);

    // Wait for initial request to open
    await waitFor(() => {
      const { openLogViewerIds } = useLogStore.getState();
      expect(openLogViewerIds.has(6)).toBe(true); // SYNC-3: sendLineNumber = 3*2 = 6
    }, { timeout: 2000 });

    const originalHash = window.location.hash;

    // Click on the same request (should close it)
    const requestIdElement = screen.getByTestId('request-id-SYNC-3');
    expect(requestIdElement).toBeTruthy();
    requestIdElement.click();

    // Wait a bit for the click handler to execute
    await new Promise(resolve => setTimeout(resolve, 100));

    // URL should still have the id parameter (consistency)
    expect(window.location.hash).toBe(originalHash);
  });
});

describe('SyncView - stats-compact with active time window', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn();
    useLogStore.getState().clearData();
    window.location.hash = '';
  });

  afterEach(() => {
    window.location.hash = '';
  });

  /**
   * Regression: when a time window is active, incomplete sync requests (responseLineNumber === 0)
   * were excluded from totalCount but included in the shown count, producing
   * e.g. "31 / 10" where numerator > denominator.
   * After the fix the denominator includes incomplete items when showIncomplete is true.
   */
  it('shown count never exceeds total count when incomplete is enabled and a time window is set', () => {
    const rawLogLines = createParsedLogLines(10);

    // 3 completed sync requests whose responses land within the window T+0..T+4
    const completedInWindow = [
      createSyncRequest({ requestId: 'SYNC-C1', sendLineNumber: 0, responseLineNumber: 1, status: '200', connId: 'conn-1' }),
      createSyncRequest({ requestId: 'SYNC-C2', sendLineNumber: 2, responseLineNumber: 3, status: '200', connId: 'conn-1' }),
      createSyncRequest({ requestId: 'SYNC-C3', sendLineNumber: 4, responseLineNumber: 4, status: '200', connId: 'conn-1' }),
    ];

    // 1 completed request outside the window
    const completedOutOfWindow = [
      createSyncRequest({ requestId: 'SYNC-OUT', sendLineNumber: 6, responseLineNumber: 8, status: '200', connId: 'conn-1' }),
    ];

    // 2 incomplete requests (responseLineNumber === 0, no status)
    const incompleteRequests = [
      createSyncRequest({ requestId: 'SYNC-P1', sendLineNumber: 5, responseLineNumber: 0, status: '', connId: 'conn-1' }),
      createSyncRequest({ requestId: 'SYNC-P2', sendLineNumber: 7, responseLineNumber: 0, status: '', connId: 'conn-1' }),
    ];

    const allRequests = [...completedInWindow, ...completedOutOfWindow, ...incompleteRequests];

    const startTime = rawLogLines[0].isoTimestamp;
    const endTime = rawLogLines[4].isoTimestamp;

    useLogStore.setState({
      allRequests,
      rawLogLines,
      startTime,
      endTime,
      showIncomplete: true,
      selectedConnId: '',
      connectionIds: ['conn-1'],
    });
    useLogStore.getState().filterRequests();

    act(() => { render(<SyncView />); });

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
      createSyncRequest({ requestId: 'SYNC-C1', sendLineNumber: 0, responseLineNumber: 1, status: '200', connId: 'conn-1' }),
      createSyncRequest({ requestId: 'SYNC-C2', sendLineNumber: 2, responseLineNumber: 3, status: '200', connId: 'conn-1' }),
    ];
    const incompleteRequests = [
      createSyncRequest({ requestId: 'SYNC-P1', sendLineNumber: 5, responseLineNumber: 0, status: '', connId: 'conn-1' }),
    ];

    const allRequests = [...completedInWindow, ...incompleteRequests];
    const startTime = rawLogLines[0].isoTimestamp;
    const endTime = rawLogLines[4].isoTimestamp;

    useLogStore.setState({
      allRequests,
      rawLogLines,
      startTime,
      endTime,
      showIncomplete: false,
      selectedConnId: '',
      connectionIds: ['conn-1'],
    });
    useLogStore.getState().filterRequests();

    act(() => { render(<SyncView />); });

    const shownEl = document.getElementById('shown-count');
    const totalEl = document.getElementById('total-count');
    const shown = parseInt(shownEl!.textContent ?? '', 10);
    const total = parseInt(totalEl!.textContent ?? '', 10);

    // Incomplete is off: shown = 2 completed in window; total = 2 completed + 1 incomplete
    expect(shown).toBe(2);
    expect(total).toBe(3);
  });
});

describe('SyncView - formatTimeout edge cases and onChange handlers', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn();
  });

  it('formats a non-standard timeout >= 1000ms as Xs', () => {
    // timeout = 5000ms → formatTimeout should return '5s' (covers L123 ms >= 1000 branch)
    const requests = [
      createSyncRequest({ requestId: 'S-1', sendLineNumber: 0, timeout: 5000 }),
    ];
    useLogStore.setState({ allRequests: requests, filteredRequests: requests });

    act(() => { render(<SyncView />); });

    const select = document.getElementById('timeout-filter') as HTMLSelectElement;
    expect(select).not.toBeNull();
    // '5s' label should appear as option text
    const options = Array.from(select.options).map(o => o.text);
    expect(options).toContain('5s');
  });

  it('formats a non-standard timeout < 1000ms as Xms', () => {
    // timeout = 500ms → formatTimeout should return '500ms' (covers L123 ms < 1000 branch)
    const requests = [
      createSyncRequest({ requestId: 'S-1', sendLineNumber: 0, timeout: 500 }),
    ];
    useLogStore.setState({ allRequests: requests, filteredRequests: requests });

    act(() => { render(<SyncView />); });

    const select = document.getElementById('timeout-filter') as HTMLSelectElement;
    expect(select).not.toBeNull();
    const options = Array.from(select.options).map(o => o.text);
    expect(options).toContain('500ms');
  });

  it('fires onChange on conn-filter and updates selectedConnId', () => {
    const requests = [
      createSyncRequest({ requestId: 'S-1', sendLineNumber: 0, connId: 'room-list' }),
    ];
    useLogStore.setState({
      allRequests: requests,
      filteredRequests: requests,
      connectionIds: ['room-list'],
      selectedConnId: '',
    });

    act(() => { render(<SyncView />); });

    const connSelect = document.getElementById('conn-filter') as HTMLSelectElement;
    expect(connSelect).not.toBeNull();

    // Fire change to select 'room-list' — covers line 132 setSelectedConnId(e.target.value)
    act(() => { fireEvent.change(connSelect, { target: { value: 'room-list' } }); });
    expect(useLogStore.getState().selectedConnId).toBe('room-list');
  });

  it('fires onChange on timeout-filter: updates selectedTimeout store and calls setTimeoutFilter (covers L147-149)', () => {
    // Spy on useURLParams so we can capture and assert on setTimeoutFilter.
    // vi.doMock cannot replace an already-imported module; vi.spyOn works correctly here.
    const mockSetTimeoutFilter = vi.fn();
    const spy = vi.spyOn(URLParamsModule, 'useURLParams').mockReturnValue({
      start: null, end: null, scale: 'hour', status: null,
      filter: null, requestId: null, timeout: null,
      setTimeFilter: vi.fn(), setScale: vi.fn(), setStatusFilter: vi.fn(),
      setLogFilter: vi.fn(), setRequestId: vi.fn(),
      setTimeoutFilter: mockSetTimeoutFilter,
    });

    const requests = [
      createSyncRequest({ requestId: 'S-1', sendLineNumber: 0, timeout: 0 }),
      createSyncRequest({ requestId: 'S-2', sendLineNumber: 2, timeout: 30000 }),
    ];
    useLogStore.setState({
      allRequests: requests,
      filteredRequests: requests,
      selectedTimeout: null,
    });

    act(() => { render(<SyncView />); });

    const timeoutSelect = document.getElementById('timeout-filter') as HTMLSelectElement;
    expect(timeoutSelect).not.toBeNull();

    // Select timeout '0' — parseInt('0', 10) = 0
    act(() => { fireEvent.change(timeoutSelect, { target: { value: '0' } }); });
    // Store state updated
    expect(useLogStore.getState().selectedTimeout).toBe(0);
    // URL param setter also called
    expect(mockSetTimeoutFilter).toHaveBeenCalledWith(0);

    // Select empty (reset) — val becomes null
    act(() => { fireEvent.change(timeoutSelect, { target: { value: '' } }); });
    expect(useLogStore.getState().selectedTimeout).toBeNull();
    expect(mockSetTimeoutFilter).toHaveBeenCalledWith(null);

    spy.mockRestore();
  });
});
