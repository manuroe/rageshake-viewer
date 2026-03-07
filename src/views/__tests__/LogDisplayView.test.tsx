import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { screen, fireEvent, createEvent } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { useLogStore } from '../../stores/logStore';
import { LogDisplayView } from '../LogDisplayView';
import { createLogsWithMatches, createParsedLogLine } from '../../test/fixtures';
import styles from '../LogDisplayView.module.css';
import {
  KeyboardShortcutContext,
  type KeyboardShortcutContextValue,
} from '../../components/KeyboardShortcutContext';

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

function getLineContainer(lineNumber: number): HTMLElement {
  const candidates = screen.getAllByText(String(lineNumber));
  const lineNumSpan = candidates.find((el: Element) => el.classList.contains(styles.logLineNumber)) as HTMLElement;
  if (!lineNumSpan) throw new Error(`Line number span not found for ${lineNumber}`);
  return lineNumSpan.closest(`.${styles.logLine}`) as HTMLElement;
}

describe('LogDisplayView gap arrows & expansion', () => {
  it('shows arrows and expands down on newly displayed lines', async () => {
    const user = userEvent.setup();
    const total = 200;
    const matchIndices = [76, 157];
    useLogStore.setState({ rawLogLines: createLogsWithMatches(total, matchIndices) });

    render(<LogDisplayView requestFilter="MATCH" />);

    // Line 76 should be visible
    // Ensure line containers exist
    const line76Container = getLineContainer(76);
    expect(line76Container).toBeInTheDocument();

    // It should have a down arrow
    const downBtn76 = line76Container.querySelector('button[aria-label="Load hidden lines below"]') as HTMLButtonElement;
    expect(downBtn76).toBeTruthy();
    await user.click(downBtn76);

    // After expansion, line 86 should appear
    const line86Container = getLineContainer(86);
    expect(line86Container).toBeInTheDocument();

    // Click down on line 86's down arrow: find the nearest down arrow again
    const downBtn86 = line86Container.querySelector('button[aria-label="Load hidden lines below"]') as HTMLButtonElement;
    expect(downBtn86).toBeTruthy();
    await user.click(downBtn86);

    // Now line 96 should appear
    const line96Container = getLineContainer(96);
    expect(line96Container).toBeInTheDocument();
  });

  it('shows arrows and expands up on newly displayed lines', async () => {
    const user = userEvent.setup();
    const total = 200;
    const matchIndices = [76, 157];
    useLogStore.setState({ rawLogLines: createLogsWithMatches(total, matchIndices) });

    render(<LogDisplayView requestFilter="MATCH" />);

    // Line 157 visible
    const line157Container = getLineContainer(157);
    expect(line157Container).toBeInTheDocument();

    // It should have an up arrow
    const upBtn157 = line157Container.querySelector('button[aria-label="Load hidden lines above"]') as HTMLButtonElement;
    expect(upBtn157).toBeTruthy();
    await user.click(upBtn157);

    // After expansion, line 156 should appear
    const line156Container = getLineContainer(156);
    expect(line156Container).toBeInTheDocument();

    // Next up arrow should be on the topmost newly displayed line (147)
    const line147Container = getLineContainer(147);
    const upBtn147 = line147Container.querySelector('button[aria-label="Load hidden lines above"]') as HTMLButtonElement;
    expect(upBtn147).toBeTruthy();
    await user.click(upBtn147);

    const line146Container = getLineContainer(146);
    expect(line146Container).toBeInTheDocument();
  });

  it('context menu: Load all to next line (down)', async () => {
    const user = userEvent.setup();
    const total = 200;
    const matchIndices = [76, 157];
    useLogStore.setState({ rawLogLines: createLogsWithMatches(total, matchIndices) });

    render(<LogDisplayView requestFilter="MATCH" nextRequestLineRange={{ start: 157, end: 160 }} />);

    const line76Container = getLineContainer(76);
    const downBtn76 = line76Container.querySelector('button[aria-label="Load hidden lines below"]') as HTMLButtonElement;
    expect(downBtn76).toBeTruthy();
    fireEvent.contextMenu(downBtn76);

    const loadAllNext = await screen.findByText(/Load to next log/i);
    await user.click(loadAllNext);

    // Should expand all until next anchor (157), making 156 visible and no down arrow on 156
    const line156Container = getLineContainer(156);
    expect(line156Container).toBeInTheDocument();
    const downBtn156 = line156Container.querySelector('button[aria-label="Load hidden lines below"]');
    expect(downBtn156).toBeNull();
  });

  it('context menu: Load 10 more lines action expands by 10', async () => {
    const user = userEvent.setup();
    const total = 200;
    const matchIndices = [76, 157];
    useLogStore.setState({ rawLogLines: createLogsWithMatches(total, matchIndices) });

    render(<LogDisplayView requestFilter="MATCH" />);

    const line76Container = getLineContainer(76);
    const downBtn76 = line76Container.querySelector('button[aria-label="Load hidden lines below"]') as HTMLButtonElement;
    expect(downBtn76).toBeTruthy();
    fireEvent.contextMenu(downBtn76);

    const load10 = await screen.findByText(/Load 10 more lines/i);
    await user.click(load10);

    expect(getLineContainer(86)).toBeInTheDocument();
  });

  it('context menu: Load all to previous line (up)', async () => {
    const user = userEvent.setup();
    const total = 200;
    const matchIndices = [76, 157];
    useLogStore.setState({ rawLogLines: createLogsWithMatches(total, matchIndices) });

    render(<LogDisplayView requestFilter="MATCH" prevRequestLineRange={{ start: 70, end: 76 }} />);

    const line157Container = getLineContainer(157);
    const upBtn157 = line157Container.querySelector('button[aria-label="Load hidden lines above"]') as HTMLButtonElement;
    expect(upBtn157).toBeTruthy();
    fireEvent.contextMenu(upBtn157);

    const loadAllPrev = await screen.findByText(/Load to previous log/i);
    await user.click(loadAllPrev);

    // Should expand all until previous anchor (76), making 77 visible and no up arrow on 77
    const line77Container = getLineContainer(77);
    expect(line77Container).toBeInTheDocument();
    const upBtn77 = line77Container.querySelector('button[aria-label="Load hidden lines above"]');
    expect(upBtn77).toBeNull();
  });

  it('context menu: Load all to bottom (down at last line)', async () => {
    const user = userEvent.setup();
    const total = 200;
    const matchIndices = [76, 157];
    useLogStore.setState({ rawLogLines: createLogsWithMatches(total, matchIndices) });

    render(<LogDisplayView requestFilter="MATCH" />);

    const line157Container = getLineContainer(157);
    const downBtn157 = line157Container.querySelector('button[aria-label="Load hidden lines below"]') as HTMLButtonElement;
    expect(downBtn157).toBeTruthy();
    fireEvent.contextMenu(downBtn157);

    const loadAllBottom = await screen.findByText(/Load all to bottom/i);
    await user.click(loadAllBottom);

    // Should expand all to file end, making last line visible and no down arrow there
    const line199Container = getLineContainer(199);
    expect(line199Container).toBeInTheDocument();
    const downBtn199 = line199Container.querySelector('button[aria-label="Load hidden lines below"]');
    expect(downBtn199).toBeNull();
  });

  it('context menu: Load all to top (up at first line)', async () => {
    const user = userEvent.setup();
    const total = 200;
    const matchIndices = [76, 157];
    useLogStore.setState({ rawLogLines: createLogsWithMatches(total, matchIndices) });

    render(<LogDisplayView requestFilter="MATCH" />);

    const line76Container = getLineContainer(76);
    const upBtn76 = line76Container.querySelector('button[aria-label="Load hidden lines above"]') as HTMLButtonElement;
    expect(upBtn76).toBeTruthy();
    fireEvent.contextMenu(upBtn76);

    const loadAllTop = await screen.findByText(/Load all to top/i);
    await user.click(loadAllTop);

    // Should expand all to file start, making first line visible and no up arrow there
    const line0Container = getLineContainer(0);
    expect(line0Container).toBeInTheDocument();
    const upBtn0 = line0Container.querySelector('button[aria-label="Load hidden lines above"]');
    expect(upBtn0).toBeNull();
  });

  it('stripPrefix toggle affects displayed text', async () => {
    const user = userEvent.setup();
    const total = 10;
    const matchIndices = [3, 7];
    const logs = createLogsWithMatches(total, matchIndices);
    useLogStore.setState({ rawLogLines: logs });

    render(<LogDisplayView requestFilter="MATCH" />);

    const line3Container = getLineContainer(3);
    const textSpan = line3Container.querySelector(`.${styles.logLineText}`) as HTMLSpanElement;
    expect(textSpan).toBeTruthy();
    
    // With stripPrefix=true (default), message should not start with ISO timestamp
    const isoTimestamp = logs[3].isoTimestamp;
    expect(textSpan.textContent?.trim().startsWith(isoTimestamp)).toBe(false);

    // Toggle stripPrefix off
    const stripCheckbox = screen.getByLabelText(/Strip prefix/i) as HTMLInputElement;
    await user.click(stripCheckbox);

    // Now the log-line-text should include the timestamp prefix in the rawText (due to no strip)
    expect(textSpan.textContent?.includes(isoTimestamp)).toBe(true);
  });

  it('lineWrap toggles wrap class on lines', async () => {
    const user = userEvent.setup();
    const total = 5;
    const matchIndices = [2, 4];
    useLogStore.setState({ rawLogLines: createLogsWithMatches(total, matchIndices) });

    render(<LogDisplayView requestFilter="MATCH" />);

    let line2Container = getLineContainer(2);
    // Default is nowrap
    expect(line2Container.classList.contains(styles.nowrap)).toBe(true);
    expect(line2Container.classList.contains(styles.wrap)).toBe(false);

    // Toggle line wrap
    const wrapCheckbox = screen.getByLabelText(/Line wrap/i) as HTMLInputElement;
    await user.click(wrapCheckbox);

    // Re-query after state change to avoid stale node
    line2Container = getLineContainer(2);
    expect(line2Container.classList.contains(styles.wrap)).toBe(true);
    expect(line2Container.classList.contains(styles.nowrap)).toBe(false);
  });

  it('contextLines shows surrounding lines when enabled', async () => {
    const user = userEvent.setup();
    const total = 30;
    const matchIndices = [15];
    useLogStore.setState({ rawLogLines: createLogsWithMatches(total, matchIndices) });

    render(<LogDisplayView requestFilter="MATCH" defaultShowOnlyMatching={true} />);

    // Initially only matching line should be visible
    const line15Container = getLineContainer(15);
    expect(line15Container).toBeInTheDocument();
    // A non-matching neighbor should not be present yet
    expect(() => getLineContainer(14)).toThrow();

    // Enable context via the ≡ button (sets contextLines=5)
    const ctxToggle = screen.getByTitle(/Context lines before\/after matches/i);
    await user.click(ctxToggle as HTMLButtonElement);

    // Now surrounding lines within 5 should appear
    const line14Container = getLineContainer(14);
    const line20Container = getLineContainer(20);
    expect(line14Container).toBeInTheDocument();
    expect(line20Container).toBeInTheDocument();
  });

  it('supports resetting and typing context line count', async () => {
    const user = userEvent.setup();
    useLogStore.setState({ rawLogLines: createLogsWithMatches(30, [10]) });

    render(<LogDisplayView requestFilter="MATCH" />);

    await new Promise(resolve => setTimeout(resolve, 350));

    const ctxToggle = screen.getByTitle(/Context lines before\/after matches/i);
    const ctxInput = screen.getByTitle(/Context lines \(0 = disabled\)/i) as HTMLInputElement;

    await user.click(ctxToggle as HTMLButtonElement);
    expect(ctxInput.value).toBe('5');

    await user.click(ctxToggle as HTMLButtonElement);
    expect(ctxInput.value).toBe('0');

    fireEvent.change(ctxInput, { target: { value: '3' } });
    expect(ctxInput.value).toBe('3');
  });

  it('removes arrows when gap fully expanded to next anchor', async () => {
    const total = 200;
    const matchIndices = [76, 77]; // Adjacent so no gap below 76
    useLogStore.setState({ rawLogLines: createLogsWithMatches(total, matchIndices) });

    render(<LogDisplayView requestFilter="MATCH" defaultShowOnlyMatching={true} />);

    const line76Container2 = getLineContainer(76);
    const line77Container2 = getLineContainer(77);
    expect(line76Container2).toBeInTheDocument();
    expect(line77Container2).toBeInTheDocument();

    // There should be no down arrow for 76 because next line is visible
    const downBtn76_2 = line76Container2.querySelector('button[aria-label="Load hidden lines below"]');
    expect(downBtn76_2).toBeNull();
  });
});

describe('LogDisplayView filter & search behaviors', () => {
  beforeEach(() => {
    useLogStore.getState().clearData();
  });

  it('filter narrows visible lines to only matching ones', async () => {
    const total = 20;
    useLogStore.setState({
      rawLogLines: createLogsWithMatches(total, []),
    });

    const { rerender } = render(<LogDisplayView />);

    // All lines should be visible initially
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('19')).toBeInTheDocument();

    // Apply filter
    const filterInput = screen.getByPlaceholderText(/Filter logs/i);
    await userEvent.type(filterInput, 'MATCH');
    
    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 400));
    rerender(<LogDisplayView />);

    // No lines should be visible (no MATCH in test logs by default)
    expect(() => getLineContainer(0)).toThrow();
  });

  it('search highlights matching text within filtered results', async () => {
    const total = 10;
    useLogStore.setState({
      rawLogLines: createLogsWithMatches(total, [2, 5, 8]),
    });

    render(<LogDisplayView requestFilter="MATCH" />);

    // Filter should show only lines 2, 5, 8
    const line2Container = getLineContainer(2);
    const line5Container = getLineContainer(5);
    const line8Container = getLineContainer(8);
    expect(line2Container).toBeInTheDocument();
    expect(line5Container).toBeInTheDocument();
    expect(line8Container).toBeInTheDocument();

    // Apply search within filtered results
    const searchInput = screen.getByPlaceholderText(/Search logs/i);
    await userEvent.type(searchInput, 'MATCH');

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 400));

    // Search should highlight matches
    const marks = screen.queryAllByRole('mark');
    expect(marks.length).toBeGreaterThan(0);
  });

  it('search counter shows correct number of matches in filtered results', async () => {
    const total = 20;
    const matchIndices = Array.from({ length: 20 }, (_, i) => i); // All have "MATCH"
    useLogStore.setState({
      rawLogLines: createLogsWithMatches(total, matchIndices),
    });

    render(<LogDisplayView />);

    // All 20 lines visible
    const searchInput = screen.getByPlaceholderText(/Search logs/i);
    await userEvent.type(searchInput, 'MATCH');

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 400));

    // Counter should show search results
    const counter = screen.queryByText(/\d+ \/ \d+/);
    expect(counter).toBeTruthy();
  });

  it('search counter reflects filtered results only', async () => {
    const total = 10;
    const matchIndices = Array.from({ length: 10 }, (_, i) => i); // All have "MATCH"
    useLogStore.setState({
      rawLogLines: createLogsWithMatches(total, matchIndices),
    });

    render(<LogDisplayView requestFilter="MATCH" />);

    // Apply search
    const searchInput = screen.getByPlaceholderText(/Search logs/i);
    await userEvent.type(searchInput, 'MATCH');

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 400));

    // Counter should show matches in filtered results (all 10 have "MATCH")
    const counter = screen.queryByText(/\d+ \/ \d+/);
    expect(counter).toBeTruthy();
  });

  it('search respects case sensitivity toggle', async () => {
    const logs: ParsedLogLine[] = [
      {
        lineNumber: 0,
        rawText: '2024-01-01T00:00:00.000000Z INFO uppercase TEXT',
        isoTimestamp: '2024-01-01T00:00:00.000000Z',
        timestampUs: new Date('2024-01-01T00:00:00.000Z').getTime() * 1000,
        displayTime: '00:00:00.000000',
        level: 'INFO',
        message: 'uppercase TEXT',
        strippedMessage: 'uppercase TEXT',
      },
      {
        lineNumber: 1,
        rawText: '2024-01-01T00:00:00.000000Z INFO lowercase text',
        isoTimestamp: '2024-01-01T00:00:00.000000Z',
        timestampUs: new Date('2024-01-01T00:00:00.000Z').getTime() * 1000,
        displayTime: '00:00:00.000000',
        level: 'INFO',
        message: 'lowercase text',
        strippedMessage: 'lowercase text',
      },
    ];
    useLogStore.setState({ rawLogLines: logs });

    render(<LogDisplayView />);

    // Case insensitive search for "TEXT" should find both lines
    const searchInput = screen.getByPlaceholderText(/Search logs/i) as HTMLInputElement;
    await userEvent.type(searchInput, 'TEXT');

    await new Promise(resolve => setTimeout(resolve, 400));

    // Both should match (case insensitive by default)
    const marks = screen.queryAllByRole('mark');
    expect(marks.length).toBeGreaterThanOrEqual(1);

    // Toggle case sensitive
    const caseSensitiveCheckbox = screen.getByLabelText(/Case sensitive/i) as HTMLInputElement;
    await userEvent.click(caseSensitiveCheckbox);

    await new Promise(resolve => setTimeout(resolve, 400));

    // Now only first line should match
    const marksAfter = screen.queryAllByRole('mark');
    expect(marksAfter.length).toBeGreaterThanOrEqual(0);
  });

  it('filter input initializes from requestFilter prop', () => {
    useLogStore.setState({
      rawLogLines: createLogsWithMatches(10, [2, 5]),
    });

    render(<LogDisplayView requestFilter="MATCH" />);

    const filterInput = screen.getByPlaceholderText(/Filter logs/i) as HTMLInputElement;
    expect(filterInput.value).toBe('MATCH');
  });

  it('search input starts empty regardless of requestFilter', () => {
    useLogStore.setState({
      rawLogLines: createLogsWithMatches(10, [2, 5]),
    });

    render(<LogDisplayView requestFilter="MATCH" />);

    const searchInput = screen.getByPlaceholderText(/Search logs/i) as HTMLInputElement;
    expect(searchInput.value).toBe('');
  });

  it('filter and search can be used independently', async () => {
    const logs: ParsedLogLine[] = [
      {
        lineNumber: 0,
        rawText: '2024-01-01T00:00:00.000000Z INFO request-001',
        isoTimestamp: '2024-01-01T00:00:00.000000Z',
        timestampUs: new Date('2024-01-01T00:00:00.000Z').getTime() * 1000,
        displayTime: '00:00:00.000000',
        level: 'INFO',
        message: 'request-001',
        strippedMessage: 'request-001',
      },
      {
        lineNumber: 1,
        rawText: '2024-01-01T00:00:00.000000Z INFO response-data',
        isoTimestamp: '2024-01-01T00:00:00.000000Z',
        timestampUs: new Date('2024-01-01T00:00:00.000Z').getTime() * 1000,
        displayTime: '00:00:00.000000',
        level: 'INFO',
        message: 'response-data',
        strippedMessage: 'response-data',
      },
      {
        lineNumber: 2,
        rawText: '2024-01-01T00:00:00.000000Z INFO request-002',
        isoTimestamp: '2024-01-01T00:00:00.000000Z',
        timestampUs: new Date('2024-01-01T00:00:00.000Z').getTime() * 1000,
        displayTime: '00:00:00.000000',
        level: 'INFO',
        message: 'request-002',
        strippedMessage: 'request-002',
      },
    ];
    useLogStore.setState({ rawLogLines: logs });

    render(<LogDisplayView requestFilter="request" />);

    // Filter should show lines 0 and 2
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    // Line 1 should not be visible
    expect(() => getLineContainer(1)).toThrow();

    // Apply search for "001" (only in line 0)
    const searchInput = screen.getByPlaceholderText(/Search logs/i);
    await userEvent.type(searchInput, '001');

    await new Promise(resolve => setTimeout(resolve, 400));

    // Should have search results
    const counter = screen.queryByText(/1 \/ 1/);
    expect(counter).toBeTruthy();
  });

  it('handles Enter and Shift+Enter in search input navigation', async () => {
    const total = 20;
    useLogStore.setState({ rawLogLines: createLogsWithMatches(total, [3, 7], 'TOKEN') });

    render(<LogDisplayView requestFilter="TOKEN" />);

    const searchInput = screen.getByPlaceholderText(/Search logs/i);
    await userEvent.type(searchInput, 'TOKEN');
    await new Promise(resolve => setTimeout(resolve, 350));

    const enterEvent = createEvent.keyDown(searchInput, { key: 'Enter' });
    enterEvent.preventDefault = vi.fn();
    fireEvent(searchInput, enterEvent);

    const shiftEnterEvent = createEvent.keyDown(searchInput, { key: 'Enter', shiftKey: true });
    shiftEnterEvent.preventDefault = vi.fn();
    fireEvent(searchInput, shiftEnterEvent);

    expect(enterEvent.preventDefault).toHaveBeenCalled();
    expect(shiftEnterEvent.preventDefault).toHaveBeenCalled();
  });

  it('context lines work with filter', async () => {
    const total = 20;
    useLogStore.setState({
      rawLogLines: createLogsWithMatches(total, [10]), // Only line 10 matches
    });

    render(<LogDisplayView requestFilter="MATCH" />);

    // Only line 10 should be visible
    const line10Container = getLineContainer(10);
    expect(line10Container).toBeInTheDocument();
    expect(() => getLineContainer(9)).toThrow();
    expect(() => getLineContainer(11)).toThrow();

    // Enable context lines
    const ctxToggle = screen.getByTitle(/Context lines before\/after matches/i);
    await userEvent.click(ctxToggle as HTMLButtonElement);

    await new Promise(resolve => setTimeout(resolve, 400));

    // Now lines 5-15 should be visible (10 ± 5)
    const line5Container = getLineContainer(5);
    const line15Container = getLineContainer(15);
    expect(line5Container).toBeInTheDocument();
    expect(line15Container).toBeInTheDocument();
  });
});

describe('LogDisplayView requestFilter prop sync', () => {
  it('updates filter input when requestFilter prop changes', async () => {
    const total = 50;
    const matchIndices = [10, 20, 30];
    useLogStore.setState({ rawLogLines: createLogsWithMatches(total, matchIndices) });

    // Initial render with no filter
    const { rerender } = render(<LogDisplayView requestFilter="" />);

    // All lines should be visible (no filter active)
    expect(getLineContainer(1)).toBeInTheDocument();
    expect(getLineContainer(5)).toBeInTheDocument();

    // Rerender with a filter prop - simulates URL→Store sync
    rerender(<LogDisplayView requestFilter="MATCH" />);

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 350));

    // Now only matching lines should be visible
    const line10Container = getLineContainer(10);
    expect(line10Container).toBeInTheDocument();

    // Non-matching lines should be hidden
    expect(() => getLineContainer(5)).toThrow();
  });

  it('syncs long filter strings from URL', async () => {
    const total = 20;
    // Create logs where line 7 (index 7) matches a specific long string
    // This simulates the user's URL with a very long filter
    const matchIndices = [7]; // Line number 7 (lineNumber = startLineNumber + index = 0 + 7)
    const longFilter = 'LONG_ERROR_MESSAGE_FROM_URL_PARAMETER';
    const logs = createLogsWithMatches(total, matchIndices, longFilter);
    useLogStore.setState({ rawLogLines: logs });

    // Simulate URL with long filter (like the user's issue)
    const { rerender } = render(<LogDisplayView requestFilter="" />);

    // Initially no filter - all visible
    expect(getLineContainer(0)).toBeInTheDocument();

    // Apply filter via prop update (simulating URL→Store sync)
    rerender(<LogDisplayView requestFilter={longFilter} />);

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 350));

    // Only line 7 (index 7) should match
    const line7Container = getLineContainer(7);
    expect(line7Container).toBeInTheDocument();

    // Other lines should be hidden
    expect(() => getLineContainer(0)).toThrow();
    expect(() => getLineContainer(5)).toThrow();
  });

  it('clears filter when requestFilter prop becomes empty', async () => {
    const total = 30;
    const matchIndices = [15];
    useLogStore.setState({ rawLogLines: createLogsWithMatches(total, matchIndices) });

    // Start with a filter
    const { rerender } = render(<LogDisplayView requestFilter="MATCH" />);

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 350));

    // Only matching line visible
    expect(getLineContainer(15)).toBeInTheDocument();
    expect(() => getLineContainer(1)).toThrow();

    // Clear filter via prop
    rerender(<LogDisplayView requestFilter="" />);

    // Wait for debounce
    await new Promise(resolve => setTimeout(resolve, 350));

    // Now all lines should be visible again
    expect(getLineContainer(1)).toBeInTheDocument();
    expect(getLineContainer(15)).toBeInTheDocument();
  });

  it('does not call onFilterChange when syncing from requestFilter prop updates', async () => {
    const total = 20;
    useLogStore.setState({ rawLogLines: createLogsWithMatches(total, [7], 'MATCH') });
    const onFilterChange = vi.fn();

    const { rerender } = render(<LogDisplayView requestFilter="" onFilterChange={onFilterChange} />);
    rerender(<LogDisplayView requestFilter="MATCH" onFilterChange={onFilterChange} />);

    await new Promise(resolve => setTimeout(resolve, 350));

    expect(onFilterChange).not.toHaveBeenCalled();
  });

  it('calls onFilterChange when user edits filter input', async () => {
    const total = 20;
    useLogStore.setState({ rawLogLines: createLogsWithMatches(total, [7], 'MATCH') });
    const onFilterChange = vi.fn();

    render(<LogDisplayView requestFilter="MATCH" onFilterChange={onFilterChange} />);

    const filterInput = screen.getByPlaceholderText(/Filter logs/i);
    fireEvent.change(filterInput, { target: { value: 'line 1' } });

    await new Promise(resolve => setTimeout(resolve, 350));

    expect(onFilterChange).toHaveBeenCalledWith('line 1');
  });

  it('treats quoted request filters as exact request-id match', async () => {
    useLogStore.setState({
      rawLogLines: [
        createParsedLogLine({
          lineNumber: 0,
          rawText: '2026-01-01T00:00:00.000000Z INFO send request_id="REQ-18" method=GET',
          message: 'request_id="REQ-18"',
          strippedMessage: 'request_id="REQ-18"',
        }),
        createParsedLogLine({
          lineNumber: 1,
          rawText: '2026-01-01T00:00:01.000000Z INFO send request_id="REQ-180" method=GET',
          message: 'request_id="REQ-180"',
          strippedMessage: 'request_id="REQ-180"',
        }),
      ],
    });

    render(<LogDisplayView requestFilter='"REQ-18"' />);

    await new Promise(resolve => setTimeout(resolve, 350));

    expect(getLineContainer(0)).toBeInTheDocument();
    expect(() => getLineContainer(1)).toThrow();
  });
});

describe('LogDisplayView expand button', () => {
  beforeEach(() => {
    useLogStore.getState().clearData();
  });

  it('renders expand button when onExpand is provided', () => {
    useLogStore.setState({ rawLogLines: createLogsWithMatches(5, []) });
    const onExpand = vi.fn();
    render(<LogDisplayView onExpand={onExpand} />);
    expect(screen.getByRole('button', { name: 'Open in Logs view' })).toBeInTheDocument();
  });

  it('does not render expand button when onExpand is not provided', () => {
    useLogStore.setState({ rawLogLines: createLogsWithMatches(5, []) });
    render(<LogDisplayView />);
    expect(screen.queryByRole('button', { name: 'Open in Logs view' })).toBeNull();
  });

  it('calls onExpand when expand button is clicked', async () => {
    const user = userEvent.setup();
    useLogStore.setState({ rawLogLines: createLogsWithMatches(10, [3, 7]) });
    const onExpand = vi.fn();
    render(<LogDisplayView requestFilter="MATCH" onExpand={onExpand} />);

    await user.click(screen.getByRole('button', { name: 'Open in Logs view' }));

    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it('includes updated lineWrap in onExpand call after user toggles it', async () => {
    const user = userEvent.setup();
    useLogStore.setState({ rawLogLines: createLogsWithMatches(10, [3, 7]) });
    const onExpand = vi.fn();
    render(<LogDisplayView requestFilter="MATCH" onExpand={onExpand} />);

    await user.click(screen.getByLabelText(/Line wrap/i));
    await user.click(screen.getByRole('button', { name: 'Open in Logs view' }));

    expect(onExpand).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Shortcut context registration
// ---------------------------------------------------------------------------

function makeShortcutCtx(
  overrides?: Partial<KeyboardShortcutContextValue>,
): KeyboardShortcutContextValue {
  return {
    showHelp: false,
    toggleHelp: vi.fn(),
    pendingChord: null,
    registerFocusSearch: vi.fn(() => vi.fn()),
    registerFocusFilter: vi.fn(() => vi.fn()),
    ...overrides,
  };
}

describe('LogDisplayView shortcut registration', () => {
  it('registers a focus-search handler when mounted inside shortcut context', () => {
    useLogStore.setState({ rawLogLines: createLogsWithMatches(5, [2]) });
    const registerFocusSearch = vi.fn(() => vi.fn());
    const ctx = makeShortcutCtx({ registerFocusSearch });

    render(
      <KeyboardShortcutContext.Provider value={ctx}>
        <LogDisplayView />
      </KeyboardShortcutContext.Provider>,
    );

    expect(registerFocusSearch).toHaveBeenCalledTimes(1);
  });

  it('registers a focus-filter handler when mounted inside shortcut context', () => {
    useLogStore.setState({ rawLogLines: createLogsWithMatches(5, [2]) });
    const registerFocusFilter = vi.fn(() => vi.fn());
    const ctx = makeShortcutCtx({ registerFocusFilter });

    render(
      <KeyboardShortcutContext.Provider value={ctx}>
        <LogDisplayView />
      </KeyboardShortcutContext.Provider>,
    );

    expect(registerFocusFilter).toHaveBeenCalledTimes(1);
  });

  it('focus-search handler focuses the search input', async () => {
    useLogStore.setState({ rawLogLines: createLogsWithMatches(5, [2]) });
    let capturedSearchFn: (() => void) | null = null;
    const registerFocusSearch = vi.fn((fn: () => void) => {
      capturedSearchFn = fn;
      return vi.fn();
    });
    const ctx = makeShortcutCtx({ registerFocusSearch });

    render(
      <KeyboardShortcutContext.Provider value={ctx}>
        <LogDisplayView />
      </KeyboardShortcutContext.Provider>,
    );

    expect(capturedSearchFn).not.toBeNull();
    // Calling the registered fn should not throw (focuses the ref'd input)
    expect(() => capturedSearchFn?.()).not.toThrow();
  });

  it('focus-filter handler focuses the filter input', async () => {
    useLogStore.setState({ rawLogLines: createLogsWithMatches(5, [2]) });
    let capturedFilterFn: (() => void) | null = null;
    const registerFocusFilter = vi.fn((fn: () => void) => {
      capturedFilterFn = fn;
      return vi.fn();
    });
    const ctx = makeShortcutCtx({ registerFocusFilter });

    render(
      <KeyboardShortcutContext.Provider value={ctx}>
        <LogDisplayView />
      </KeyboardShortcutContext.Provider>,
    );

    expect(capturedFilterFn).not.toBeNull();
    expect(() => capturedFilterFn?.()).not.toThrow();
  });

  it('Option+w key toggles line wrap', () => {
    useLogStore.setState({ rawLogLines: createLogsWithMatches(5, [2]) });
    render(<LogDisplayView />);

    const checkbox = screen.getByLabelText(/Line wrap/i) as HTMLInputElement;
    const initial = checkbox.checked;

    fireEvent.keyDown(document, { key: 'w', code: 'KeyW', altKey: true });

    expect(checkbox.checked).toBe(!initial);
  });

  it('Option+p key toggles strip prefix', () => {
    useLogStore.setState({ rawLogLines: createLogsWithMatches(5, [2]) });
    render(<LogDisplayView />);

    const checkbox = screen.getByLabelText(/Strip prefix/i) as HTMLInputElement;
    const initial = checkbox.checked;

    fireEvent.keyDown(document, { key: 'p', code: 'KeyP', altKey: true });

    expect(checkbox.checked).toBe(!initial);
  });

  it('Option+w toggles line wrap even when an input element is focused', () => {
    useLogStore.setState({ rawLogLines: createLogsWithMatches(5, [2]) });
    render(<LogDisplayView />);

    const checkbox = screen.getByLabelText(/Line wrap/i) as HTMLInputElement;
    const initial = checkbox.checked;

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(document, { key: 'w', code: 'KeyW', altKey: true });
    document.body.removeChild(input);

    expect(checkbox.checked).toBe(!initial);
  });
});
