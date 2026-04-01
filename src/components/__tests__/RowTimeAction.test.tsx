/**
 * Unit tests for RowTimeAction component.
 * Tests menu open/close, event propagation isolation, time-filter dispatch,
 * and boundary-crossing clamping behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RowTimeAction } from '../RowTimeAction';
import { useLogStore } from '../../stores/logStore';

const mockSetTimeFilter = vi.fn();

vi.mock('../../hooks/useURLParams', () => ({
  useURLParams: () => ({
    setTimeFilter: mockSetTimeFilter,
    setScale: vi.fn(),
    setStatusFilter: vi.fn(),
    setLogFilter: vi.fn(),
    setRequestId: vi.fn(),
  }),
}));

/**
 * timestampUs = 1700000005000000 µs
 * → ISO '2023-11-14T22:13:25.000000Z'
 */
const TEST_TIMESTAMP_US = 1700000005000000;
const TEST_ISO = '2023-11-14T22:13:25.000000Z';

/** An ISO timestamp reliably later than TEST_ISO (+ 5 s). */
const LATER_ISO = '2023-11-14T22:13:30.000000Z';
/** An ISO timestamp reliably earlier than TEST_ISO (- 5 s). */
const EARLIER_ISO = '2023-11-14T22:13:20.000000Z';

describe('RowTimeAction', () => {
  beforeEach(() => {
    mockSetTimeFilter.mockReset();
    useLogStore.setState({ startTime: null, endTime: null });
  });

  // -----------------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------------

  it('renders a trigger button', () => {
    render(<RowTimeAction timestampUs={TEST_TIMESTAMP_US} />);
    expect(screen.getByRole('button', { name: /row actions/i })).toBeInTheDocument();
  });

  it('does not show the menu initially', () => {
    render(<RowTimeAction timestampUs={TEST_TIMESTAMP_US} />);
    expect(screen.queryByText(/set window start here/i)).not.toBeInTheDocument();
  });

  it('sets aria-expanded=false on the trigger initially', () => {
    render(<RowTimeAction timestampUs={TEST_TIMESTAMP_US} />);
    expect(screen.getByRole('button', { name: /row actions/i })).toHaveAttribute('aria-expanded', 'false');
  });

  // -----------------------------------------------------------------------
  // Menu toggle
  // -----------------------------------------------------------------------

  it('opens the menu when trigger is clicked', () => {
    render(<RowTimeAction timestampUs={TEST_TIMESTAMP_US} />);
    fireEvent.click(screen.getByRole('button', { name: /row actions/i }));
    expect(screen.getByRole('button', { name: /set window start here/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set window end here/i })).toBeInTheDocument();
  });

  it('closes the menu when trigger is clicked again', () => {
    render(<RowTimeAction timestampUs={TEST_TIMESTAMP_US} />);
    const trigger = screen.getByRole('button', { name: /row actions/i });
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(screen.queryByText(/set window start here/i)).not.toBeInTheDocument();
  });

  it('sets aria-expanded=true when menu is open', () => {
    render(<RowTimeAction timestampUs={TEST_TIMESTAMP_US} />);
    fireEvent.click(screen.getByRole('button', { name: /row actions/i }));
    expect(screen.getByRole('button', { name: /row actions/i })).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes when clicking outside', () => {
    render(
      <div>
        <RowTimeAction timestampUs={TEST_TIMESTAMP_US} />
        <div data-testid="outside">outside</div>
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: /row actions/i }));
    expect(screen.getByRole('button', { name: /set window start here/i })).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText(/set window start here/i)).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // Event propagation
  // -----------------------------------------------------------------------

  it('does not propagate trigger clicks to the parent row', () => {
    const rowClickHandler = vi.fn();
    render(
      <div onClick={rowClickHandler}>
        <RowTimeAction timestampUs={TEST_TIMESTAMP_US} />
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: /row actions/i }));
    expect(rowClickHandler).not.toHaveBeenCalled();
  });

  it('does not propagate menu item clicks to the parent row', () => {
    const rowClickHandler = vi.fn();
    render(
      <div onClick={rowClickHandler}>
        <RowTimeAction timestampUs={TEST_TIMESTAMP_US} />
      </div>
    );
    fireEvent.click(screen.getByRole('button', { name: /row actions/i }));
    fireEvent.click(screen.getByRole('button', { name: /set window start here/i }));
    expect(rowClickHandler).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // "Set window start here"
  // -----------------------------------------------------------------------

  it('calls setTimeFilter with the row timestamp as start', () => {
    render(<RowTimeAction timestampUs={TEST_TIMESTAMP_US} />);
    fireEvent.click(screen.getByRole('button', { name: /row actions/i }));
    fireEvent.click(screen.getByRole('button', { name: /set window start here/i }));
    expect(mockSetTimeFilter).toHaveBeenCalledWith(TEST_ISO, null);
  });

  it('preserves an existing end boundary when it is later than the new start', () => {
    useLogStore.setState({ endTime: LATER_ISO });
    render(<RowTimeAction timestampUs={TEST_TIMESTAMP_US} />);
    fireEvent.click(screen.getByRole('button', { name: /row actions/i }));
    fireEvent.click(screen.getByRole('button', { name: /set window start here/i }));
    expect(mockSetTimeFilter).toHaveBeenCalledWith(TEST_ISO, LATER_ISO);
  });

  it('clears an existing end boundary when it precedes the new start', () => {
    useLogStore.setState({ endTime: EARLIER_ISO });
    render(<RowTimeAction timestampUs={TEST_TIMESTAMP_US} />);
    fireEvent.click(screen.getByRole('button', { name: /row actions/i }));
    fireEvent.click(screen.getByRole('button', { name: /set window start here/i }));
    expect(mockSetTimeFilter).toHaveBeenCalledWith(TEST_ISO, null);
  });

  it('closes the menu after setting the start', () => {
    render(<RowTimeAction timestampUs={TEST_TIMESTAMP_US} />);
    fireEvent.click(screen.getByRole('button', { name: /row actions/i }));
    fireEvent.click(screen.getByRole('button', { name: /set window start here/i }));
    expect(screen.queryByText(/set window start here/i)).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // "Set window end here"
  // -----------------------------------------------------------------------

  it('calls setTimeFilter with the row timestamp as end', () => {
    render(<RowTimeAction timestampUs={TEST_TIMESTAMP_US} />);
    fireEvent.click(screen.getByRole('button', { name: /row actions/i }));
    fireEvent.click(screen.getByRole('button', { name: /set window end here/i }));
    expect(mockSetTimeFilter).toHaveBeenCalledWith(null, TEST_ISO);
  });

  it('preserves an existing start boundary when it precedes the new end', () => {
    useLogStore.setState({ startTime: EARLIER_ISO });
    render(<RowTimeAction timestampUs={TEST_TIMESTAMP_US} />);
    fireEvent.click(screen.getByRole('button', { name: /row actions/i }));
    fireEvent.click(screen.getByRole('button', { name: /set window end here/i }));
    expect(mockSetTimeFilter).toHaveBeenCalledWith(EARLIER_ISO, TEST_ISO);
  });

  it('clears an existing start boundary when it is later than the new end', () => {
    useLogStore.setState({ startTime: LATER_ISO });
    render(<RowTimeAction timestampUs={TEST_TIMESTAMP_US} />);
    fireEvent.click(screen.getByRole('button', { name: /row actions/i }));
    fireEvent.click(screen.getByRole('button', { name: /set window end here/i }));
    expect(mockSetTimeFilter).toHaveBeenCalledWith(null, TEST_ISO);
  });

  it('closes the menu after setting the end', () => {
    render(<RowTimeAction timestampUs={TEST_TIMESTAMP_US} />);
    fireEvent.click(screen.getByRole('button', { name: /row actions/i }));
    fireEvent.click(screen.getByRole('button', { name: /set window end here/i }));
    expect(screen.queryByText(/set window start here/i)).not.toBeInTheDocument();
  });

  it('does not render when timestamp is missing', () => {
    render(<RowTimeAction timestampUs={null} />);
    expect(screen.queryByRole('button', { name: /row actions/i })).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------------
  // onOpenChange callback
  // -----------------------------------------------------------------------

  it('calls onOpenChange(true) when the menu opens', () => {
    const onOpenChange = vi.fn();
    render(<RowTimeAction timestampUs={TEST_TIMESTAMP_US} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole('button', { name: /row actions/i }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('calls onOpenChange(false) when the menu closes via trigger', () => {
    const onOpenChange = vi.fn();
    render(<RowTimeAction timestampUs={TEST_TIMESTAMP_US} onOpenChange={onOpenChange} />);
    const trigger = screen.getByRole('button', { name: /row actions/i });
    fireEvent.click(trigger);
    onOpenChange.mockReset();
    fireEvent.click(trigger);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls onOpenChange(false) when a menu item is selected', () => {
    const onOpenChange = vi.fn();
    render(<RowTimeAction timestampUs={TEST_TIMESTAMP_US} onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole('button', { name: /row actions/i }));
    onOpenChange.mockReset();
    fireEvent.click(screen.getByRole('button', { name: /set window start here/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
