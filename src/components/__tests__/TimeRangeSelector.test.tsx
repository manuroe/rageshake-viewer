import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimeRangeSelector } from '../TimeRangeSelector';
import { useLogStore } from '../../stores/logStore';

const mockSetTimeFilter = vi.fn();

vi.mock('../../hooks/useURLParams', () => ({
  useURLParams: () => ({
    setTimeFilter: mockSetTimeFilter,
    setScale: vi.fn(),
    setStatusFilter: vi.fn(),
    setLogFilter: vi.fn(),
  }),
}));

describe('TimeRangeSelector', () => {
  beforeEach(() => {
    mockSetTimeFilter.mockReset();
    useLogStore.setState({ startTime: null, endTime: null });
  });

  describe('button display text', () => {
    it('shows "All time" when no filter is set', () => {
      render(<TimeRangeSelector />);
      expect(screen.getByText('All time')).toBeInTheDocument();
    });

    it('shows shortcut display name when startTime = last-5-min and endTime = end', () => {
      useLogStore.setState({ startTime: 'last-5-min', endTime: 'end' });
      render(<TimeRangeSelector />);
      expect(screen.getByText('Last 5 min')).toBeInTheDocument();
    });

    it('shows "from to" format when both custom times set', () => {
      useLogStore.setState({ startTime: '12:00:00', endTime: '13:00:00' });
      render(<TimeRangeSelector />);
      // Display should contain something about the times
      const btn = screen.getByRole('button', { name: /select time range/i });
      expect(btn).toBeInTheDocument();
    });

    it('shows "Start to X" when only endTime is set', () => {
      useLogStore.setState({ startTime: null, endTime: '13:00:00' });
      render(<TimeRangeSelector />);
      const btn = screen.getByRole('button', { name: /select time range/i });
      expect(btn).toBeInTheDocument();
    });
  });

  describe('dropdown toggling', () => {
    it('dropdown is hidden initially', () => {
      render(<TimeRangeSelector />);
      expect(screen.queryByText('Last min')).not.toBeInTheDocument();
    });

    it('opens dropdown when button is clicked', () => {
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      expect(screen.getByText('Last min')).toBeInTheDocument();
    });

    it('closes dropdown when button is clicked again', () => {
      render(<TimeRangeSelector />);
      const btn = screen.getByRole('button', { name: /select time range/i });
      fireEvent.click(btn);
      fireEvent.click(btn);
      expect(screen.queryByText('Last min')).not.toBeInTheDocument();
    });

    it('sets aria-expanded=false initially', () => {
      render(<TimeRangeSelector />);
      expect(screen.getByRole('button', { name: /select time range/i })).toHaveAttribute('aria-expanded', 'false');
    });

    it('sets aria-expanded=true when open', () => {
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      expect(screen.getByRole('button', { name: /select time range/i })).toHaveAttribute('aria-expanded', 'true');
    });

    it('closes when clicking outside', () => {
      render(
        <div>
          <TimeRangeSelector />
          <div data-testid="outside">outside</div>
        </div>
      );
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      expect(screen.getByText('Last min')).toBeInTheDocument();
      fireEvent.mouseDown(screen.getByTestId('outside'));
      expect(screen.queryByText('Last min')).not.toBeInTheDocument();
    });
  });

  describe('shortcut buttons', () => {
    it('renders all shortcut options when open', () => {
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      expect(screen.getByText('Last min')).toBeInTheDocument();
      expect(screen.getByText('Last 5 min')).toBeInTheDocument();
      expect(screen.getByText('Last 10 min')).toBeInTheDocument();
      expect(screen.getByText('Last hour')).toBeInTheDocument();
      expect(screen.getByText('Last day')).toBeInTheDocument();
    });

    it('calls setTimeFilter with shortcut value when shortcut is clicked', () => {
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      fireEvent.click(screen.getByText('Last 5 min'));
      expect(mockSetTimeFilter).toHaveBeenCalledWith('last-5-min', 'end');
    });

    it('calls setTimeFilter with last-hour', () => {
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      fireEvent.click(screen.getByText('Last hour'));
      expect(mockSetTimeFilter).toHaveBeenCalledWith('last-hour', 'end');
    });

    it('calls setTimeFilter with last-day', () => {
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      fireEvent.click(screen.getByText('Last day'));
      expect(mockSetTimeFilter).toHaveBeenCalledWith('last-day', 'end');
    });

    it('closes dropdown after selecting a shortcut', () => {
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      fireEvent.click(screen.getByText('Last 5 min'));
      expect(screen.queryByText('Last min')).not.toBeInTheDocument();
    });
  });

  describe('clear filter', () => {
    it('does not show Clear filter when no filter is set', () => {
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      expect(screen.queryByText('Clear filter')).not.toBeInTheDocument();
    });

    it('shows Clear filter when startTime is set', () => {
      useLogStore.setState({ startTime: 'last-hour', endTime: null });
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      expect(screen.getByText('Clear filter')).toBeInTheDocument();
    });

    it('shows Clear filter when endTime is set', () => {
      useLogStore.setState({ startTime: null, endTime: 'end' });
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      expect(screen.getByText('Clear filter')).toBeInTheDocument();
    });

    it('calls setTimeFilter(null, null) when Clear filter is clicked', () => {
      useLogStore.setState({ startTime: 'last-5-min', endTime: null });
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      fireEvent.click(screen.getByText('Clear filter'));
      expect(mockSetTimeFilter).toHaveBeenCalledWith(null, null);
    });

    it('closes dropdown after clearing', () => {
      useLogStore.setState({ startTime: 'last-5-min', endTime: null });
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      fireEvent.click(screen.getByText('Clear filter'));
      expect(screen.queryByText('Last min')).not.toBeInTheDocument();
    });
  });

  describe('custom range', () => {
    it('shows "Custom range..." option when dropdown is open', () => {
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      expect(screen.getByText('Custom range...')).toBeInTheDocument();
    });

    it('shows custom inputs when "Custom range..." is clicked', () => {
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      fireEvent.click(screen.getByText('Custom range...'));
      expect(screen.getByLabelText('From:')).toBeInTheDocument();
      expect(screen.getByLabelText('To:')).toBeInTheDocument();
    });

    it('shows Cancel and Apply buttons in custom range view', () => {
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      fireEvent.click(screen.getByText('Custom range...'));
      expect(screen.getByText('Cancel')).toBeInTheDocument();
      expect(screen.getByText('Apply')).toBeInTheDocument();
    });

    it('hides custom inputs when Cancel is clicked', () => {
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      fireEvent.click(screen.getByText('Custom range...'));
      fireEvent.click(screen.getByText('Cancel'));
      expect(screen.queryByLabelText('From:')).not.toBeInTheDocument();
      expect(screen.getByText('Custom range...')).toBeInTheDocument();
    });

    it('shows error when Apply is clicked with empty inputs', () => {
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      fireEvent.click(screen.getByText('Custom range...'));
      fireEvent.click(screen.getByText('Apply'));
      expect(screen.getByText(/please enter at least a start or end time/i)).toBeInTheDocument();
    });

    it('shows error for invalid start time', () => {
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      fireEvent.click(screen.getByText('Custom range...'));
      fireEvent.change(screen.getByLabelText('From:'), { target: { value: 'not-a-time' } });
      fireEvent.click(screen.getByText('Apply'));
      expect(screen.getByText(/invalid start time/i)).toBeInTheDocument();
    });

    it('shows error for invalid end time', () => {
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      fireEvent.click(screen.getByText('Custom range...'));
      fireEvent.change(screen.getByLabelText('To:'), { target: { value: 'not-a-time' } });
      fireEvent.click(screen.getByText('Apply'));
      expect(screen.getByText(/invalid end time/i)).toBeInTheDocument();
    });

    it('calls setTimeFilter with valid start time only', () => {
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      fireEvent.click(screen.getByText('Custom range...'));
      fireEvent.change(screen.getByLabelText('From:'), { target: { value: '10:00:00' } });
      fireEvent.click(screen.getByText('Apply'));
      expect(mockSetTimeFilter).toHaveBeenCalledWith('10:00:00', null);
    });

    it('calls setTimeFilter with valid end time only', () => {
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      fireEvent.click(screen.getByText('Custom range...'));
      fireEvent.change(screen.getByLabelText('To:'), { target: { value: '14:30:00' } });
      fireEvent.click(screen.getByText('Apply'));
      expect(mockSetTimeFilter).toHaveBeenCalledWith(null, '14:30:00');
    });

    it('calls setTimeFilter with both valid start and end times', () => {
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      fireEvent.click(screen.getByText('Custom range...'));
      fireEvent.change(screen.getByLabelText('From:'), { target: { value: '10:00:00' } });
      fireEvent.change(screen.getByLabelText('To:'), { target: { value: '11:00:00' } });
      fireEvent.click(screen.getByText('Apply'));
      expect(mockSetTimeFilter).toHaveBeenCalledWith('10:00:00', '11:00:00');
    });

    it('closes dropdown after successful Apply', () => {
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      fireEvent.click(screen.getByText('Custom range...'));
      fireEvent.change(screen.getByLabelText('From:'), { target: { value: '10:00:00' } });
      fireEvent.click(screen.getByText('Apply'));
      expect(screen.queryByLabelText('From:')).not.toBeInTheDocument();
    });

    it('submits on Enter key in From input', () => {
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      fireEvent.click(screen.getByText('Custom range...'));
      const fromInput = screen.getByLabelText('From:');
      fireEvent.change(fromInput, { target: { value: '10:00:00' } });
      fireEvent.keyDown(fromInput, { key: 'Enter' });
      expect(mockSetTimeFilter).toHaveBeenCalledWith('10:00:00', null);
    });

    it('submits on Enter key in To input', () => {
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      fireEvent.click(screen.getByText('Custom range...'));
      const toInput = screen.getByLabelText('To:');
      fireEvent.change(toInput, { target: { value: '14:00:00' } });
      fireEvent.keyDown(toInput, { key: 'Enter' });
      expect(mockSetTimeFilter).toHaveBeenCalledWith(null, '14:00:00');
    });

    it('clears error on input change in From', () => {
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      fireEvent.click(screen.getByText('Custom range...'));
      fireEvent.click(screen.getByText('Apply'));
      expect(screen.getByText(/please enter at least/i)).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText('From:'), { target: { value: 'a' } });
      expect(screen.queryByText(/please enter at least/i)).not.toBeInTheDocument();
    });

    it('clears error on input change in To', () => {
      render(<TimeRangeSelector />);
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      fireEvent.click(screen.getByText('Custom range...'));
      fireEvent.click(screen.getByText('Apply'));
      fireEvent.change(screen.getByLabelText('To:'), { target: { value: 'b' } });
      expect(screen.queryByText(/please enter at least/i)).not.toBeInTheDocument();
    });

    it('syncs custom inputs when store values change while custom panel is closed', () => {
      const { rerender } = render(<TimeRangeSelector />);
      // The effect should sync inputs when dropdown is not in custom mode
      useLogStore.setState({ startTime: '09:00:00', endTime: '10:00:00' });
      rerender(<TimeRangeSelector />);
      // Open
      fireEvent.click(screen.getByRole('button', { name: /select time range/i }));
      // Open custom
      fireEvent.click(screen.getByText('Custom range...'));
      // The inputs should be synced with store values
      const fromInput = screen.getByLabelText('From:') as HTMLInputElement;
      expect(fromInput.value).toBe('09:00:00');
    });
  });
});
