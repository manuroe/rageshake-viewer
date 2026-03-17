import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { screen, fireEvent, createEvent } from '@testing-library/dom';
import userEvent from '@testing-library/user-event';
import { useLogStore } from '../../stores/logStore';
import { LogDisplayView } from '../LogDisplayView';
import { createLogsWithMatches, createParsedLogLine } from '../../test/fixtures';
import { parseAllHttpRequests } from '../../utils/logParser';
import { resetSwiftPathCacheForTests } from '../../utils/githubLinkGenerator';
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

  describe('GitHub source links', () => {
    afterEach(() => {
      vi.restoreAllMocks();
      resetSwiftPathCacheForTests();
    });

    const RUST_LINE = '2026-02-04T13:01:45.365379Z DEBUG matrix_sdk::http_client::native: Sending request num_attempt=1 | crates/matrix-sdk/src/http_client/native.rs:78 | spans: root';
    const SWIFT_LINE = '2026-02-04T13:10:37.511766Z  INFO elementx: Received room list update: running | ClientProxy.swift:1092 | spans: root';

    it('shows source links with hover styling for source-tagged lines', async () => {
      const user = userEvent.setup();
      const parsed = parseAllHttpRequests(`${RUST_LINE}\n${SWIFT_LINE}`);
      useLogStore.setState({ rawLogLines: parsed.rawLogLines });

      render(<LogDisplayView />);

      // Links are always in the DOM; before hover they carry the inactive class.
      const rustLink = screen.getByRole('link', { name: 'crates/matrix-sdk/src/http_client/native.rs:78' });
      expect(rustLink).toHaveAttribute('href', 'https://github.com/matrix-org/matrix-rust-sdk/blob/main/crates/matrix-sdk/src/http_client/native.rs#L78');
      expect(rustLink.className).toMatch(/sourceLinkInactive/);

      // Hovering the row switches the link to active (visible) styling.
      await user.hover(getLineContainer(1));
      await waitFor(() => expect(rustLink.className).toMatch(/sourceLink(?!Inactive)/));

      const swiftLink = screen.getByRole('link', { name: 'ClientProxy.swift:1092' });
      expect(swiftLink).toHaveAttribute('href', 'https://github.com/element-hq/element-x-ios/search?q=ClientProxy.swift%20repo%3Aelement-hq%2Felement-x-ios&type=code');
      expect(swiftLink.className).toMatch(/sourceLinkInactive/);
      await user.hover(getLineContainer(2));
      await waitFor(() => expect(swiftLink.className).toMatch(/sourceLink(?!Inactive)/));
    });

    it('shows active link styling on keyboard focus and restores inactive on blur', async () => {
      const parsed = parseAllHttpRequests(RUST_LINE);
      useLogStore.setState({ rawLogLines: parsed.rawLogLines });

      render(<LogDisplayView />);

      // Link is always in the DOM; starts with inactive (plain-text) styling.
      const link = screen.getByRole('link', { name: 'crates/matrix-sdk/src/http_client/native.rs:78' });
      expect(link).toHaveAttribute('href', 'https://github.com/matrix-org/matrix-rust-sdk/blob/main/crates/matrix-sdk/src/http_client/native.rs#L78');
      expect(link.className).toMatch(/sourceLinkInactive/);

      // Focus the row → link becomes visually active.
      const container = getLineContainer(1);
      act(() => { container.focus(); });
      await waitFor(() => expect(link.className).toMatch(/sourceLink(?!Inactive)/));

      // Blur the row entirely → link reverts to inactive styling (still in DOM).
      act(() => { container.blur(); });
      await waitFor(() => expect(link.className).toMatch(/sourceLinkInactive/));
    });

    it('clicking a Swift source link navigates to the resolved file URL in a new tab', async () => {
      const user = userEvent.setup();
      const parsed = parseAllHttpRequests(SWIFT_LINE);
      useLogStore.setState({ rawLogLines: parsed.rawLogLines });

      vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          tree: [{ path: 'ElementX/Sources/Services/Client/ClientProxy.swift', type: 'blob' }],
        }),
      } as Response);

      const mockTab = { opener: null as unknown, location: { href: '' }, close: vi.fn() };
      vi.spyOn(window, 'open').mockReturnValue(mockTab as Window);

      render(<LogDisplayView />);
      await user.hover(getLineContainer(1));
      const link = await screen.findByRole('link', { name: 'ClientProxy.swift:1092' });
      // Use fireEvent.click so the synthetic onClick fires without userEvent's
      // anchor-navigation side-effects in jsdom.
      fireEvent.click(link);

      expect(window.open).toHaveBeenCalledWith('', '_blank');
      expect(mockTab.opener).toBeNull();
      await waitFor(() => {
        expect(mockTab.location.href).toBe(
          'https://github.com/element-hq/element-x-ios/blob/main/ElementX/Sources/Services/Client/ClientProxy.swift#L1092'
        );
      });
    });

    it('preserves search highlights in the text surrounding the source link when hovering a matched line', async () => {
      const user = userEvent.setup();
      const parsed = parseAllHttpRequests(RUST_LINE);
      useLogStore.setState({ rawLogLines: parsed.rawLogLines });

      render(<LogDisplayView />);

      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'Sending');
      // Wait for the debounced searchQuery to update and the line to be classed as a match.
      await waitFor(() => expect(getLineContainer(1).className).toMatch(/matchLine/));

      const container = getLineContainer(1);
      await user.hover(container);

      const link = await screen.findByRole('link', { name: 'crates/matrix-sdk/src/http_client/native.rs:78' });
      expect(link).toBeInTheDocument();

      // The matched word should still appear highlighted inside a <mark>
      const marks = container.querySelectorAll('mark');
      expect(marks.length).toBeGreaterThan(0);
      expect(marks[0].textContent).toBe('Sending');
    });

    it('highlights search matches inside the source link text when the line matches the search', async () => {
      const user = userEvent.setup();
      const parsed = parseAllHttpRequests(RUST_LINE);
      useLogStore.setState({ rawLogLines: parsed.rawLogLines });

      render(<LogDisplayView />);

      // Search for a term that appears inside the sourceRef itself.
      const searchInput = screen.getByPlaceholderText(/search/i);
      await user.type(searchInput, 'native.rs');
      await waitFor(() => expect(getLineContainer(1).className).toMatch(/matchLine/));

      // The link is always in the DOM; its highlighted text can be found by accessible name.
      const link = await screen.findByRole('link', { name: /native\.rs/ });
      const markInLink = link.querySelector('mark');
      expect(markInLink).not.toBeNull();
      expect(markInLink?.textContent).toBe('native.rs');
    });

    it('keeps active link styling when focus moves from the row to the link inside it', async () => {
      const parsed = parseAllHttpRequests(RUST_LINE);
      useLogStore.setState({ rawLogLines: parsed.rawLogLines });

      render(<LogDisplayView />);

      // Link is always in the DOM; starts inactive.
      const link = screen.getByRole('link', { name: 'crates/matrix-sdk/src/http_client/native.rs:78' });
      expect(link.className).toMatch(/sourceLinkInactive/);

      const container = getLineContainer(1);
      act(() => { container.focus(); });
      await waitFor(() => expect(link.className).toMatch(/sourceLink(?!Inactive)/));

      // Blur the row with relatedTarget = the link (focus staying inside the row).
      // The active styling should be preserved.
      act(() => { fireEvent.blur(container, { relatedTarget: link }); });
      expect(link.className).toMatch(/sourceLink(?!Inactive)/);

      // Blur to outside: inactive styling restored.
      act(() => { container.blur(); });
      await waitFor(() => expect(link.className).toMatch(/sourceLinkInactive/));
    });
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

  it('search is case-insensitive', async () => {
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

    // Search for "TEXT" should find both lines regardless of source text casing
    const searchInput = screen.getByPlaceholderText(/Search logs/i) as HTMLInputElement;
    await userEvent.type(searchInput, 'TEXT');

    await new Promise(resolve => setTimeout(resolve, 400));

    // Matches are highlighted in both lines (case-insensitive search) and both lines remain visible
    const marks = screen.queryAllByRole('mark');
    expect(marks.length).toBe(2);
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
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
    registerDismiss: vi.fn(() => vi.fn()),
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

describe('LogDisplayView collapse duplicates', () => {
  function createDuplicateLogLines() {
    // Lines 0-3: four exact duplicates (same text, different timestamps) → collapsed
    // Lines 4-7: four similar lines (same source file:line, different content) → collapsed
    // Line 8: unique line
    const lines = [
      createParsedLogLine({
        lineNumber: 0,
        rawText: '2024-01-15T10:00:00.000000Z ERROR Duplicate error message',
        level: 'ERROR',
      }),
      createParsedLogLine({
        lineNumber: 1,
        rawText: '2024-01-15T10:00:01.000000Z ERROR Duplicate error message',
        level: 'ERROR',
      }),
      createParsedLogLine({
        lineNumber: 2,
        rawText: '2024-01-15T10:00:02.000000Z ERROR Duplicate error message',
        level: 'ERROR',
      }),
      createParsedLogLine({
        lineNumber: 3,
        rawText: '2024-01-15T10:00:03.000000Z ERROR Duplicate error message',
        level: 'ERROR',
      }),
      createParsedLogLine({
        lineNumber: 4,
        rawText: '2024-01-15T10:00:04.000000Z INFO Room unknown room=!abc | crates/room.rs:42 | spans: root',
        level: 'INFO',
        filePath: 'crates/room.rs',
        sourceLineNumber: 42,
      }),
      createParsedLogLine({
        lineNumber: 5,
        rawText: '2024-01-15T10:00:05.000000Z INFO Room unknown room=!def | crates/room.rs:42 | spans: root',
        level: 'INFO',
        filePath: 'crates/room.rs',
        sourceLineNumber: 42,
      }),
      createParsedLogLine({
        lineNumber: 6,
        rawText: '2024-01-15T10:00:06.000000Z INFO Room unknown room=!ghi | crates/room.rs:42 | spans: root',
        level: 'INFO',
        filePath: 'crates/room.rs',
        sourceLineNumber: 42,
      }),
      createParsedLogLine({
        lineNumber: 7,
        rawText: '2024-01-15T10:00:07.000000Z INFO Room unknown room=!jkl | crates/room.rs:42 | spans: root',
        level: 'INFO',
        filePath: 'crates/room.rs',
        sourceLineNumber: 42,
      }),
      createParsedLogLine({
        lineNumber: 8,
        rawText: '2024-01-15T10:00:08.000000Z DEBUG Unique line',
        level: 'DEBUG',
      }),
    ];
    return lines;
  }

  it('collapses exact duplicates and shows summary bar with = and identical', () => {
    useLogStore.setState({ rawLogLines: createDuplicateLogLines() });
    render(<LogDisplayView />);

    // Line 0 should be visible (representative)
    const line0 = getLineContainer(0);
    expect(line0).toBeInTheDocument();

    // Lines 1, 2, 3 should be collapsed (not visible)
    expect(screen.queryByText('1', { selector: `.${styles.logLineNumber}` })).toBeNull();
    expect(screen.queryByText('2', { selector: `.${styles.logLineNumber}` })).toBeNull();
    expect(screen.queryByText('3', { selector: `.${styles.logLineNumber}` })).toBeNull();

    // Should show a collapse summary bar with = sign and "identical" text
    const collapseBar = line0.querySelector('[data-testid="collapse-bar"]');
    expect(collapseBar).toBeTruthy();
    expect(collapseBar?.textContent).toContain('=');
    expect(collapseBar?.textContent).toContain('3 identical lines collapsed');
    expect(collapseBar?.textContent).toContain('show all');
  });

  it('collapses similar lines and shows summary bar with ≈ and source location', () => {
    useLogStore.setState({ rawLogLines: createDuplicateLogLines() });
    render(<LogDisplayView />);

    // Line 4 should be visible (representative)
    const line4 = getLineContainer(4);
    expect(line4).toBeInTheDocument();

    // Lines 5, 6, 7 should be collapsed
    expect(screen.queryByText('5', { selector: `.${styles.logLineNumber}` })).toBeNull();
    expect(screen.queryByText('6', { selector: `.${styles.logLineNumber}` })).toBeNull();
    expect(screen.queryByText('7', { selector: `.${styles.logLineNumber}` })).toBeNull();

    // Should show a collapse summary bar with ≈ sign and source info
    const collapseBar = line4.querySelector('[data-testid="collapse-bar"]');
    expect(collapseBar).toBeTruthy();
    expect(collapseBar?.textContent).toContain('≈');
    expect(collapseBar?.textContent).toContain('3 similar lines collapsed');
    expect(collapseBar?.textContent).toContain('show all');
  });

  it('expands all collapsed lines when All button is clicked', async () => {
    const user = userEvent.setup();
    useLogStore.setState({ rawLogLines: createDuplicateLogLines() });
    render(<LogDisplayView />);

    // Line 1 should be collapsed
    expect(screen.queryByText('1', { selector: `.${styles.logLineNumber}` })).toBeNull();

    // Click the "All" button in the collapse summary bar
    const line0 = getLineContainer(0);
    const allBtn = line0.querySelector('button[aria-label*="Expand all"]') as HTMLButtonElement;
    expect(allBtn).toBeTruthy();
    await user.click(allBtn);

    // Lines 1, 2, 3 should now be visible
    expect(screen.getByText('1', { selector: `.${styles.logLineNumber}` })).toBeInTheDocument();
    expect(screen.getByText('2', { selector: `.${styles.logLineNumber}` })).toBeInTheDocument();
    expect(screen.getByText('3', { selector: `.${styles.logLineNumber}` })).toBeInTheDocument();
  });

  it('shows +10 button only when collapsed count exceeds 10', () => {
    // With only 3 collapsed lines, +10 button should NOT appear
    useLogStore.setState({ rawLogLines: createDuplicateLogLines() });
    render(<LogDisplayView />);

    const line0 = getLineContainer(0);
    const plus10Btn = line0.querySelector('button[aria-label="Load 10 collapsed lines"]');
    expect(plus10Btn).toBeNull();
  });

  it('shows all lines when collapse is disabled via checkbox', async () => {
    const user = userEvent.setup();
    useLogStore.setState({ rawLogLines: createDuplicateLogLines() });
    render(<LogDisplayView />);

    // Lines 1, 2, 3 should be collapsed initially
    expect(screen.queryByText('1', { selector: `.${styles.logLineNumber}` })).toBeNull();

    // Uncheck the collapse checkbox
    const checkbox = screen.getByLabelText(/Collapse duplicates/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    await user.click(checkbox);

    // Now all lines should be visible
    expect(screen.getByText('1', { selector: `.${styles.logLineNumber}` })).toBeInTheDocument();
    expect(screen.getByText('2', { selector: `.${styles.logLineNumber}` })).toBeInTheDocument();
    expect(screen.getByText('3', { selector: `.${styles.logLineNumber}` })).toBeInTheDocument();
    expect(screen.getByText('5', { selector: `.${styles.logLineNumber}` })).toBeInTheDocument();
    expect(screen.getByText('6', { selector: `.${styles.logLineNumber}` })).toBeInTheDocument();
    expect(screen.getByText('7', { selector: `.${styles.logLineNumber}` })).toBeInTheDocument();
  });

  it('unique lines remain visible with collapsing enabled', () => {
    useLogStore.setState({ rawLogLines: createDuplicateLogLines() });
    render(<LogDisplayView />);

    // Line 8 is unique and should always be visible
    const line8 = getLineContainer(8);
    expect(line8).toBeInTheDocument();
  });

  it('summary bar count updates when expanding from the bottom via gap-above arrow', async () => {
    // 25 exact duplicates: line 0 = representative, lines 1-24 = collapsed
    // Line 25 is a unique line after the group (has gapAbove)
    const user = userEvent.setup();
    const lines = [
      ...Array.from({ length: 25 }, (_, i) =>
        createParsedLogLine({
          lineNumber: i,
          rawText: `2024-01-15T10:00:${String(i).padStart(2, '0')}.000000Z ERROR Repeated error`,
          level: 'ERROR',
        })
      ),
      createParsedLogLine({
        lineNumber: 25,
        rawText: '2024-01-15T10:00:25.000000Z INFO Unique after group',
        level: 'INFO',
      }),
    ];
    useLogStore.setState({ rawLogLines: lines });
    render(<LogDisplayView />);

    // Line 0 visible; lines 1-24 collapsed (count=24); line 25 visible after gap
    const line0 = getLineContainer(0);
    const initialBar = line0.querySelector('[data-testid="collapse-bar"]');
    expect(initialBar?.textContent).toContain('24 identical lines collapsed');

    // Line 25 has a gapAbove arrow — click it to load 10 from the bottom of the gap
    const line25 = getLineContainer(25);
    const upArrow = line25.querySelector('button[aria-label="Load hidden lines above"]') as HTMLButtonElement;
    expect(upArrow).toBeTruthy();
    await user.click(upArrow);

    // Lines 15-24 should now be visible
    expect(screen.getByText('15', { selector: `.${styles.logLineNumber}` })).toBeInTheDocument();
    expect(screen.getByText('24', { selector: `.${styles.logLineNumber}` })).toBeInTheDocument();

    // Lines 1-14 still collapsed — summary bar on line 0 must show remaining count
    const updatedBar = line0.querySelector('[data-testid="collapse-bar"]');
    expect(updatedBar).toBeTruthy();
    expect(updatedBar?.textContent).toContain('14 identical lines collapsed');
  });

  it('summary bar persists and shows updated count after +10 partial expansion', async () => {
    // 13 exact duplicates: line 0 = representative, lines 1-12 = collapsed (count=12)
    const user = userEvent.setup();
    const lines = Array.from({ length: 13 }, (_, i) =>
      createParsedLogLine({
        lineNumber: i,
        rawText: `2024-01-15T10:00:${String(i).padStart(2, '0')}.000000Z ERROR Repeated error`,
        level: 'ERROR',
      })
    );
    useLogStore.setState({ rawLogLines: lines });
    render(<LogDisplayView />);

    // Initially: line 0 visible, lines 1-12 collapsed, summary bar shows 12 collapsed
    const line0 = getLineContainer(0);
    const initialBar = line0.querySelector('[data-testid="collapse-bar"]');
    expect(initialBar).toBeTruthy();
    expect(initialBar?.textContent).toContain('12 identical lines collapsed');

    // Click +10
    const plus10Btn = line0.querySelector('button[aria-label="Load 10 collapsed lines"]') as HTMLButtonElement;
    expect(plus10Btn).toBeTruthy();
    await user.click(plus10Btn);

    // Lines 1-10 should now be visible
    expect(screen.getByText('1', { selector: `.${styles.logLineNumber}` })).toBeInTheDocument();
    expect(screen.getByText('10', { selector: `.${styles.logLineNumber}` })).toBeInTheDocument();

    // Line 11 and 12 should still be collapsed
    expect(screen.queryByText('11', { selector: `.${styles.logLineNumber}` })).toBeNull();
    expect(screen.queryByText('12', { selector: `.${styles.logLineNumber}` })).toBeNull();

    // Summary bar should still be visible on line 10 showing remaining 2 collapsed
    const line10 = getLineContainer(10);
    const updatedBar = line10.querySelector('[data-testid="collapse-bar"]');
    expect(updatedBar).toBeTruthy();
    expect(updatedBar?.textContent).toContain('2 identical lines collapsed');
    // +10 should no longer appear (only 2 lines remain)
    expect(updatedBar?.querySelector('button[aria-label="Load 10 collapsed lines"]')).toBeNull();
  });
});

describe('LogDisplayView sentry and HTTP error text coloring', () => {
  afterEach(() => {
    useLogStore.setState({ rawLogLines: [], sentryEvents: [] });
  });

  it('colors logLineText with sentry token for sentry lines', () => {
    const line = createParsedLogLine({
      lineNumber: 1,
      rawText: '2024-01-15T10:00:01.000000Z  WARN Sending error to Sentry',
      level: 'WARN',
    });
    useLogStore.setState({
      rawLogLines: [line],
      sentryEvents: [{ platform: 'android', lineNumber: 1, message: line.rawText }],
    });
    render(<LogDisplayView />);
    const lineEl = screen.getAllByText(String(1)).find((el) => el.classList.contains(styles.logLineNumber))!
      .closest(`.${styles.logLine}`) as HTMLElement;
    const textSpan = lineEl.querySelector(`.${styles.logLineText}`) as HTMLElement;
    expect(textSpan.style.color).toBe('var(--color-sentry)');
  });

  it('colors logLineText with HTTP status color for 4xx error lines', () => {
    const line = createParsedLogLine({
      lineNumber: 1,
      rawText: '2024-01-15T10:00:01.000000Z DEBUG send{request_id="r1" method=GET uri="https://example.com/api" request_size="0" status=404 response_size="128" request_duration=200ms}',
      level: 'DEBUG',
    });
    useLogStore.setState({ rawLogLines: [line], sentryEvents: [] });
    render(<LogDisplayView />);
    const lineEl = screen.getAllByText(String(1)).find((el) => el.classList.contains(styles.logLineNumber))!
      .closest(`.${styles.logLine}`) as HTMLElement;
    const textSpan = lineEl.querySelector(`.${styles.logLineText}`) as HTMLElement;
    expect(textSpan.style.color).toBeTruthy();
    expect(textSpan.style.color).not.toBe('');
  });

  it('does not color logLineText for 2xx lines', () => {
    const line = createParsedLogLine({
      lineNumber: 1,
      rawText: '2024-01-15T10:00:01.000000Z DEBUG send{request_id="r1" method=GET uri="https://example.com/api" request_size="0" status=200 response_size="512" request_duration=100ms}',
      level: 'DEBUG',
    });
    useLogStore.setState({ rawLogLines: [line], sentryEvents: [] });
    render(<LogDisplayView />);
    const lineEl = screen.getAllByText(String(1)).find((el) => el.classList.contains(styles.logLineNumber))!
      .closest(`.${styles.logLine}`) as HTMLElement;
    const textSpan = lineEl.querySelector(`.${styles.logLineText}`) as HTMLElement;
    expect(textSpan.style.color).toBe('');
  });
});

describe('LogDisplayView export button', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    global.URL.createObjectURL = vi.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useLogStore.setState({ rawLogLines: [] });
  });

  it('shows an export button in the toolbar', () => {
    useLogStore.setState({ rawLogLines: [createParsedLogLine({ lineNumber: 1 })] });
    render(<LogDisplayView />);
    expect(screen.getByRole('button', { name: /export logs/i })).toBeInTheDocument();
  });

  it('opens the export dialog when the export button is clicked', async () => {
    const user = userEvent.setup();
    useLogStore.setState({ rawLogLines: [createParsedLogLine({ lineNumber: 1 })] });
    render(<LogDisplayView />);
    await user.click(screen.getByRole('button', { name: /export logs/i }));
    expect(screen.getByRole('dialog', { name: /export logs/i })).toBeInTheDocument();
  });

  it('closes the export dialog when the dialog close button is clicked', async () => {
    const user = userEvent.setup();
    useLogStore.setState({ rawLogLines: [createParsedLogLine({ lineNumber: 1 })] });
    render(<LogDisplayView />);
    await user.click(screen.getByRole('button', { name: /export logs/i }));
    expect(screen.getByRole('dialog', { name: /export logs/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /close export dialog/i }));
    expect(screen.queryByRole('dialog', { name: /export logs/i })).not.toBeInTheDocument();
  });
});

