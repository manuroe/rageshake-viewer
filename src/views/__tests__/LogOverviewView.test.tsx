import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import { screen } from '@testing-library/dom';
import { useLogStore } from '../../stores/logStore';
import { LogOverviewView } from '../LogOverviewView';
import { createParsedLogLine } from '../../test/fixtures';
import type { ParsedLogLine } from '../../types/log.types';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../../components/BurgerMenu', () => ({
  BurgerMenu: () => <div data-testid="burger-menu">Menu</div>,
}));
vi.mock('../../components/TimeRangeSelector', () => ({
  TimeRangeSelector: () => <div data-testid="time-range-selector">Selector</div>,
}));

// Isolate the view: stub LogDisplayView and expose the wired props via buttons.
vi.mock('../LogDisplayView', () => ({
  LogDisplayView: (props: { highlightLineNumber?: number; onExpand?: () => void; onClose?: () => void }) => (
    <div data-testid="log-display">
      <span data-testid="highlight">{props.highlightLineNumber}</span>
      <button data-testid="expand" onClick={props.onExpand}>expand</button>
      <button data-testid="close" onClick={props.onClose}>close</button>
    </div>
  ),
}));

// A representative set of lines: two Rust targets (http_client with a source
// location, send_queue without) plus a bracket-tag INFO line and an
// untargeted UNKNOWN line.
function seedLines(): ParsedLogLine[] {
  return [
    createParsedLogLine({
      lineNumber: 1,
      level: 'ERROR',
      rawText: 'ERROR matrix_sdk::http_client: request failed',
      message: 'errmsg-one',
      filePath: 'crates/matrix-sdk/src/http_client/native.rs',
      sourceLineNumber: 10,
    }),
    createParsedLogLine({
      lineNumber: 2,
      level: 'WARN',
      rawText: 'WARN matrix_sdk::send_queue: retrying request_id="req-1" method=GET',
      message: 'retrying request_id="req-1" method=GET',
    }),
    createParsedLogLine({
      lineNumber: 3,
      level: 'INFO',
      rawText: 'INFO [matrix-rust-sdk] hello world',
      message: 'hello world',
    }),
    createParsedLogLine({
      lineNumber: 4,
      level: 'UNKNOWN',
      rawText: 'plain line with no level keyword',
      message: 'plain-unknown',
    }),
  ];
}

// jsdom does not toggle <details> on summary click, so open them manually and
// fire the toggle event the view's lazy-render effect listens for. Repeat to
// reach nested/newly-mounted <details>.
function expandAll(container: HTMLElement) {
  for (let i = 0; i < 5; i++) {
    let changed = false;
    container.querySelectorAll('details').forEach((d) => {
      if (!d.open) {
        d.open = true;
        act(() => { fireEvent(d, new Event('toggle')); });
        changed = true;
      }
    });
    if (!changed) break;
  }
}

describe('LogOverviewView', () => {
  beforeEach(() => {
    useLogStore.getState().clearData();
    mockNavigate.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the header and defaults to only WARN + ERROR', () => {
    useLogStore.setState({ rawLogLines: seedLines() });
    render(<LogOverviewView />);

    expect(screen.getByText('Triaged Logs')).toBeInTheDocument();
    expect(screen.getByTestId('burger-menu')).toBeInTheDocument();

    // 2 WARN/ERROR + 1 UNKNOWN (never filtered) shown; the INFO line is hidden.
    expect(screen.getByText('3', { selector: '#shown-count' })).toBeInTheDocument();
    expect(screen.getByText('4', { selector: '#total-count' })).toBeInTheDocument();

    // Default level checkboxes: WARN/ERROR checked, the rest not.
    expect((screen.getByRole('checkbox', { name: 'ERROR' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'WARN' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'INFO' }) as HTMLInputElement).checked).toBe(false);

    // matrix_sdk branch is present; the INFO-only bracket target is not.
    expect(screen.getByText('matrix_sdk')).toBeInTheDocument();
    expect(screen.queryByText('matrix-rust-sdk')).not.toBeInTheDocument();
  });

  it('adds a level to the tree when its checkbox is toggled on', () => {
    useLogStore.setState({ rawLogLines: seedLines() });
    render(<LogOverviewView />);

    act(() => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'INFO' }));
    });

    expect(screen.getByText('4', { selector: '#shown-count' })).toBeInTheDocument();
    expect(screen.getByText('matrix-rust-sdk')).toBeInTheDocument();
  });

  it('prunes the tree with the text filter (debounced)', () => {
    vi.useFakeTimers();
    useLogStore.setState({ rawLogLines: seedLines() });
    render(<LogOverviewView />);

    const input = screen.getByPlaceholderText('Filter by target or text...');
    act(() => { fireEvent.change(input, { target: { value: 'send_queue' } }); });
    act(() => { vi.advanceTimersByTime(400); });

    // Only the send_queue WARN line matches.
    expect(screen.getByText('1', { selector: '#shown-count' })).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('clears the text filter via the clear button', () => {
    useLogStore.setState({ rawLogLines: seedLines() });
    render(<LogOverviewView />);

    const input = screen.getByPlaceholderText('Filter by target or text...') as HTMLInputElement;
    act(() => { fireEvent.change(input, { target: { value: 'send_queue' } }); });
    act(() => { fireEvent.click(screen.getByLabelText('Clear input')); });

    expect(input.value).toBe('');
  });

  it('shows the empty state when nothing matches the filter', () => {
    vi.useFakeTimers();
    useLogStore.setState({ rawLogLines: seedLines() });
    render(<LogOverviewView />);

    const input = screen.getByPlaceholderText('Filter by target or text...');
    act(() => { fireEvent.change(input, { target: { value: 'zzz-no-match' } }); });
    act(() => { vi.advanceTimersByTime(400); });

    expect(screen.getByText('No log lines match the current filters.')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('drills into an occurrence, highlights it, opens in Logs view, and closes', () => {
    useLogStore.setState({ rawLogLines: seedLines() });
    const { container } = render(<LogOverviewView />);

    expandAll(container);

    // Click the first occurrence row (the ERROR line, lineNumber 1).
    const occ = container.querySelector('button[class*="occurrence"]') as HTMLElement;
    expect(occ).toBeTruthy();
    act(() => { fireEvent.click(occ); });

    // Drilldown panel mounts with the clicked line highlighted.
    expect(screen.getByTestId('log-display')).toBeInTheDocument();
    expect(screen.getByTestId('highlight')).toHaveTextContent('1');

    // "Open in Logs view" navigates to /logs?line=1.
    act(() => { fireEvent.click(screen.getByTestId('expand')); });
    expect(mockNavigate).toHaveBeenCalledWith('/logs?line=1');

    // Close removes the panel.
    act(() => { fireEvent.click(screen.getByTestId('close')); });
    expect(screen.queryByTestId('log-display')).not.toBeInTheDocument();
  });

  it('includes the time range in the Logs view link when set', () => {
    useLogStore.setState({
      rawLogLines: seedLines(),
      startTime: '2024-01-15T10:00:00Z',
      endTime: '2024-01-15T11:00:00Z',
    });
    const { container } = render(<LogOverviewView />);
    expandAll(container);

    act(() => { fireEvent.click(container.querySelector('button[class*="occurrence"]') as HTMLElement); });
    act(() => { fireEvent.click(screen.getByTestId('expand')); });

    const url = mockNavigate.mock.calls[0][0] as string;
    expect(url).toContain('line=1');
    expect(url).toContain('start=');
    expect(url).toContain('end=');
  });

  it('resizes the drilldown panel by dragging the divider and restores user-select', () => {
    useLogStore.setState({ rawLogLines: seedLines() });
    document.body.style.userSelect = 'text'; // pre-existing value to preserve
    const { container } = render(<LogOverviewView />);
    expandAll(container);
    act(() => { fireEvent.click(container.querySelector('button[class*="occurrence"]') as HTMLElement); });

    const panel = container.querySelector('[class*="bottomPanel"]') as HTMLElement;
    expect(panel.style.height).toBe('350px');

    const resizer = container.querySelector('[class*="resizer"]') as HTMLElement;
    act(() => { fireEvent.mouseDown(resizer, { clientY: 500 }); });
    expect(document.body.style.userSelect).toBe('none'); // disabled during drag
    act(() => { fireEvent.mouseMove(window, { clientY: 300 }); }); // drag up 200px → taller
    act(() => { fireEvent.mouseUp(window); });

    expect(panel.style.height).toBe('550px');
    expect(document.body.style.userSelect).toBe('text'); // prior value restored, not ''
    document.body.style.userSelect = '';
  });

  it('resizes the drilldown panel with the keyboard on the separator', () => {
    useLogStore.setState({ rawLogLines: seedLines() });
    const { container } = render(<LogOverviewView />);
    expandAll(container);
    act(() => { fireEvent.click(container.querySelector('button[class*="occurrence"]') as HTMLElement); });

    const resizer = container.querySelector('[class*="resizer"]') as HTMLElement;
    expect(resizer).toHaveAttribute('aria-valuenow', '350');
    expect(resizer).toHaveAttribute('tabindex', '0');
    const panel = container.querySelector('[class*="bottomPanel"]') as HTMLElement;

    act(() => { fireEvent.keyDown(resizer, { key: 'ArrowUp' }); }); // +PANEL_RESIZE_STEP (24)
    expect(panel.style.height).toBe('374px');
    act(() => { fireEvent.keyDown(resizer, { key: 'ArrowDown' }); });
    expect(panel.style.height).toBe('350px');
  });

  it('tears down an in-progress drag on unmount', () => {
    useLogStore.setState({ rawLogLines: seedLines() });
    document.body.style.userSelect = 'text';
    const { container, unmount } = render(<LogOverviewView />);
    expandAll(container);
    act(() => { fireEvent.click(container.querySelector('button[class*="occurrence"]') as HTMLElement); });

    const resizer = container.querySelector('[class*="resizer"]') as HTMLElement;
    act(() => { fireEvent.mouseDown(resizer, { clientY: 500 }); });
    expect(document.body.style.userSelect).toBe('none');

    act(() => { unmount(); }); // unmount mid-drag → stop() runs via effect cleanup
    expect(document.body.style.userSelect).toBe('text'); // restored, listeners gone

    document.body.style.userSelect = '';
  });

  it('renders without crashing when there are no logs', () => {
    useLogStore.setState({ rawLogLines: [] });
    render(<LogOverviewView />);
    expect(screen.getByText('0', { selector: '#shown-count' })).toBeInTheDocument();
    expect(screen.getByText('No log lines match the current filters.')).toBeInTheDocument();
  });
});
