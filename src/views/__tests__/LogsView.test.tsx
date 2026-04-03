import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { screen, within, waitFor } from '@testing-library/dom';
import { useLogStore } from '../../stores/logStore';
import { LogsView } from '../LogsView';
import { createParsedLogLines, createParsedLogLine } from '../../test/fixtures';
import * as TimeUtils from '../../utils/timeUtils';
import logDisplayStyles from '../LogDisplayView.module.css';

// Mock react-router-dom for useSearchParams
const mockSetSearchParams = vi.fn();
vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), mockSetSearchParams],
}));

// Mock react-virtual to simplify rendering in tests
vi.mock('@tanstack/react-virtual', () => {
  return {
    useVirtualizer: (opts: any) => ({
      getTotalSize: () => opts.count * 24,
      getVirtualItems: () => Array.from({ length: opts.count }, (_, i) => ({ index: i, key: i, start: i * 24 })),
      measureElement: () => {},
      measure: () => {},
      measurementsCache: [],
    }),
  };
});

// Mock BurgerMenu and TimeRangeSelector to simplify testing
vi.mock('../../components/BurgerMenu', () => ({
  BurgerMenu: () => <div data-testid="burger-menu">Menu</div>,
}));

vi.mock('../../components/TimeRangeSelector', () => ({
  TimeRangeSelector: () => <div data-testid="time-range-selector">Selector</div>,
}));

describe('LogsView', () => {
  beforeEach(() => {
    useLogStore.getState().clearData();
    mockSetSearchParams.mockClear();
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders header with title and stats', () => {
    const logs = createParsedLogLines(10);
    useLogStore.setState({ rawLogLines: logs });

    render(<LogsView />);

    expect(screen.getByText('All Logs')).toBeInTheDocument();
    expect(screen.getByTestId('burger-menu')).toBeInTheDocument();
    expect(screen.getByTestId('time-range-selector')).toBeInTheDocument();
  });

  it('displays correct log count and total', () => {
    const logs = createParsedLogLines(20);
    useLogStore.setState({ rawLogLines: logs });

    render(<LogsView />);

    const shownCount = screen.getByText('20', { selector: '#shown-count' });
    const totalCount = screen.getByText('20', { selector: '#total-count' });
    
    expect(shownCount).toBeInTheDocument();
    expect(totalCount).toBeInTheDocument();
  });

  it('filters logs by time range', () => {
    const baseTime = new Date('2026-02-02T12:00:00Z');
    const logs = createParsedLogLines(100, { baseTime });
    
    // Set time range to filter logs (25% to 75% of duration)
    useLogStore.setState({ 
      rawLogLines: logs,
      startTime: '2026-02-02T12:00:25Z', // 25 seconds in
      endTime: '2026-02-02T12:01:15Z',   // 75 seconds in
    });

    render(<LogsView />);

    // With 100 logs spanning 99 seconds, filtering 25-75s should give ~50 logs
    const shownCountEl = screen.getByText((content, element) => 
      element?.id === 'shown-count' && content !== ''
    ) as HTMLElement;
    
    const shownCount = parseInt(shownCountEl.textContent || '0');
    // 100 logs at 1s intervals (0s–99s); filter 25s–75s inclusive → logs 25..75 = 51 logs
    expect(shownCount).toBe(51);
  });

  it('shows total count as all raw logs regardless of filter', () => {
    const baseTime = new Date('2026-02-02T12:00:00Z');
    const logs = createParsedLogLines(50, { baseTime });
    useLogStore.setState({ 
      rawLogLines: logs,
      startTime: '2026-02-02T12:00:10Z', // Partial time range
      endTime: '2026-02-02T12:00:40Z',
    });

    render(<LogsView />);

    const totalCount = screen.getByText('50', { selector: '#total-count' });
    expect(totalCount).toBeInTheDocument();
  });

  it('handles empty logs gracefully', () => {
    useLogStore.setState({ rawLogLines: [] });

    render(<LogsView />);

    expect(screen.getByText('0', { selector: '#shown-count' })).toBeInTheDocument();
    expect(screen.getByText('0', { selector: '#total-count' })).toBeInTheDocument();
  });

  it('renders log lines in the log display container', () => {
    const logs = createParsedLogLines(20);
    useLogStore.setState({ rawLogLines: logs });

    const { container } = render(<LogsView />);

    // Check that LogDisplayView is rendered (it's the container with logs)
    const logsContainer = container.querySelector('.logs-view-container');
    expect(logsContainer).toBeInTheDocument();

    // The LogDisplayView should be present (contains log lines)
    const logLines = container.querySelectorAll(`.${logDisplayStyles.logLine}`);
    expect(logLines.length).toBeGreaterThan(0);
  });

  it('returns undefined range props when no logs exist', () => {
    useLogStore.setState({ rawLogLines: [] });

    // Should render without errors even with no logs
    const { container } = render(<LogsView />);
    
    expect(container.querySelector('.logs-view-container')).toBeInTheDocument();
    expect(screen.getByText('0', { selector: '#shown-count' })).toBeInTheDocument();
  });

  it('updates display when time range changes', async () => {
    const baseTime = new Date('2026-02-02T12:00:00Z');
    const logs = createParsedLogLines(50, { baseTime });
    
    useLogStore.setState({ rawLogLines: logs });

    const { rerender } = render(<LogsView />);

    // Get initial count with full time range
    let shownEl = screen.getByText((content, element) => 
      element?.id === 'shown-count' && content !== ''
    );
    const initialCount = parseInt(shownEl.textContent || '0');
    expect(initialCount).toBeGreaterThan(0);

    // Change time range to filter more
    vi.clearAllMocks();
    useLogStore.setState({
      startTime: '2026-02-02T12:00:10Z',
      endTime: '2026-02-02T12:00:20Z',
    });

    await waitFor(() => {
      rerender(<LogsView />);
    });

    // Count should be different (smaller) with narrower time range
    shownEl = screen.getByText((content, element) => 
      element?.id === 'shown-count' && content !== ''
    );
    const newCount = parseInt(shownEl.textContent || '0');

    expect(newCount).toBeLessThanOrEqual(initialCount);
  });

  it('keeps shown count based on time range even when a log filter is set', () => {
    const logs = createParsedLogLines(10);
    useLogStore.setState({ rawLogLines: logs, logFilter: 'not-present-in-any-line' });

    render(<LogsView />);

    const shownCountEl = screen.getByText((content, element) => 
      element?.id === 'shown-count' && content !== ''
    );
    const shownCount = parseInt(shownCountEl.textContent || '0');
    
    expect(shownCount).toBe(10);
  });

  it('does not clear filter param on mount when logFilter is set', async () => {
    const logs = createParsedLogLines(10);
    useLogStore.setState({ rawLogLines: logs, logFilter: 'existing-filter' });

    // Clear any previous calls
    mockSetSearchParams.mockClear();

    render(<LogsView />);

    // Wait for any effects to settle
    await waitFor(() => {
      // setSearchParams should NOT have been called to clear the filter
      // If it was called, it would mean we're resetting the URL param
      const callsWithEmptyFilter = mockSetSearchParams.mock.calls.filter(
        (call: any[]) => {
          const params = call[0];
          // Check if any call cleared the filter
          return params instanceof URLSearchParams && 
                 (params.get('filter') === null || params.get('filter') === '');
        }
      );
      expect(callsWithEmptyFilter.length).toBe(0);
    });
  });

  it('uses logFilter from store as filterPrefill (non-null logFilter path)', () => {
    // This exercises the `logFilter ?? ''` left branch (idx=0) on L18
    const logs = createParsedLogLines(5);
    useLogStore.setState({ rawLogLines: logs, logFilter: 'my-log-filter' });

    const { container } = render(<LogsView />);

    // Component renders successfully with the non-null logFilter
    expect(container.querySelector('.logs-view-container')).toBeInTheDocument();
  });

  it('handles log lines with zero timestamps (minLogTimeUs === Infinity path)', () => {
    // All lines have timestampUs = 0, so minLogTimeUs stays Infinity → reset to 0
    const lines = [0, 1, 2, 3, 4].map((i) =>
      createParsedLogLine({ lineNumber: i, timestampUs: 0 as any })
    );
    useLogStore.setState({ rawLogLines: lines });

    const { container } = render(<LogsView />);

    expect(screen.getByText('5', { selector: '#shown-count' })).toBeInTheDocument();
    expect(container.querySelector('.logs-view-container')).toBeInTheDocument();
  });

  it('handles non-monotonic timestamps (if t > maxLogTimeUs → false branch)', () => {
    // Second line has earlier timestamp than first → t > maxLogTimeUs is false for it
    const baseUs = 1_700_000_000_000_000;
    const lines = [
      createParsedLogLine({ lineNumber: 0, timestampUs: (baseUs + 200_000) as any }),
      createParsedLogLine({ lineNumber: 1, timestampUs: (baseUs + 100_000) as any }), // < first → false branch
      createParsedLogLine({ lineNumber: 2, timestampUs: (baseUs + 300_000) as any }),
    ];
    useLogStore.setState({ rawLogLines: lines });

    const { container } = render(<LogsView />);

    expect(screen.getByText('3', { selector: '#shown-count' })).toBeInTheDocument();
    expect(container.querySelector('.logs-view-container')).toBeInTheDocument();
  });

  it('calls setLogFilter via handleFilterChange when filter input is changed', () => {
    // Use fake timers to control debounce
    vi.useFakeTimers();

    const logs = createParsedLogLines(3);
    useLogStore.setState({ rawLogLines: logs });

    const { unmount } = render(<LogsView />);

    // Find the filter input (rendered by LogDisplayView → SearchInput)
    const filterInput = screen.getByPlaceholderText('Filter logs...');

    // Type a non-empty filter value → fires handleFilterChange('my-filter') (truthy branch)
    act(() => {
      fireEvent.change(filterInput, { target: { value: 'my-filter' } });
    });

    // Advance past the 300ms debounce delay
    act(() => {
      vi.advanceTimersByTime(400);
    });

    // mockSetSearchParams should have been called since setLogFilter was invoked
    expect(mockSetSearchParams).toHaveBeenCalled();

    unmount();
    vi.useRealTimers();
  });

  it('calls setLogFilter(null) when filter is cleared (falsy branch of filter || null)', () => {
    vi.useFakeTimers();

    const logs = createParsedLogLines(3);
    // Set logFilter so requestFilter starts as non-empty
    useLogStore.setState({ rawLogLines: logs, logFilter: 'initial-filter' });

    const { unmount } = render(<LogsView />);

    // Find the filter input (initialized to 'initial-filter' prop)
    const filterInput = screen.getByPlaceholderText('Filter logs...');

    // Let the initial debounce settle
    act(() => { vi.advanceTimersByTime(400); });
    mockSetSearchParams.mockClear();

    // Clear the filter (empty string → '' || null → null) 
    act(() => {
      fireEvent.change(filterInput, { target: { value: '' } });
    });

    act(() => { vi.advanceTimersByTime(400); });

    // When filterQuery='' !== requestFilter='initial-filter' → onFilterChange('') → setLogFilter(null)
    expect(mockSetSearchParams).toHaveBeenCalled();

    unmount();
    vi.useRealTimers();
  });
});
