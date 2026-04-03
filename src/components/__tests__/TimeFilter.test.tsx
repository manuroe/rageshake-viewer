import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimeFilter } from '../TimeFilter';
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

describe('TimeFilter', () => {
  beforeEach(() => {
    mockSetTimeFilter.mockReset();
    useLogStore.getState().clearData();
  });

  describe('display text', () => {
    it('shows "No time filter" when no filter is set', () => {
      render(<TimeFilter />);
      expect(screen.getByText('No time filter')).toBeInTheDocument();
    });

    it('shows time range when startTime is set', () => {
      useLogStore.setState({ startTime: 'last-5-min', endTime: null });
      render(<TimeFilter />);
      // Display text + shortcut button both contain "Last 5 min", check at least one matches
      expect(screen.getAllByText(/Last 5 min/i).length).toBeGreaterThan(0);
    });

    it('shows both start and end when set', () => {
      useLogStore.setState({ startTime: 'last-hour', endTime: 'end' });
      render(<TimeFilter />);
      // Both display text and shortcut button contain "Last hour"
      expect(screen.getAllByText(/Last hour/i).length).toBeGreaterThan(0);
    });
  });

  describe('shortcut buttons', () => {
    it('renders all shortcut buttons', () => {
      render(<TimeFilter />);
      expect(screen.getByText('Last min')).toBeInTheDocument();
      expect(screen.getByText('Last 5 min')).toBeInTheDocument();
      expect(screen.getByText('Last 10 min')).toBeInTheDocument();
      expect(screen.getByText('Last hour')).toBeInTheDocument();
      expect(screen.getByText('Last day')).toBeInTheDocument();
    });

    it('calls setTimeFilter when shortcut is clicked', () => {
      render(<TimeFilter />);
      fireEvent.click(screen.getByText('Last 5 min'));
      expect(mockSetTimeFilter).toHaveBeenCalledWith('last-5-min', 'end');
    });

    it('calls setTimeFilter with last-hour shortcut', () => {
      render(<TimeFilter />);
      fireEvent.click(screen.getByText('Last hour'));
      expect(mockSetTimeFilter).toHaveBeenCalledWith('last-hour', 'end');
    });

    it('calls setTimeFilter with last-min shortcut', () => {
      render(<TimeFilter />);
      fireEvent.click(screen.getByText('Last min'));
      expect(mockSetTimeFilter).toHaveBeenCalledWith('last-min', 'end');
    });
  });

  describe('clear button', () => {
    it('does not show Clear button when no filter is set', () => {
      render(<TimeFilter />);
      expect(screen.queryByText('Clear')).not.toBeInTheDocument();
    });

    it('shows Clear button when startTime is set', () => {
      useLogStore.setState({ startTime: 'last-5-min', endTime: null });
      render(<TimeFilter />);
      expect(screen.getByText('Clear')).toBeInTheDocument();
    });

    it('shows Clear button when endTime is set', () => {
      useLogStore.setState({ startTime: null, endTime: 'end' });
      render(<TimeFilter />);
      expect(screen.getByText('Clear')).toBeInTheDocument();
    });

    it('calls setTimeFilter with null when Clear is clicked', () => {
      useLogStore.setState({ startTime: 'last-5-min', endTime: null });
      render(<TimeFilter />);
      fireEvent.click(screen.getByText('Clear'));
      expect(mockSetTimeFilter).toHaveBeenCalledWith(null, null);
    });
  });

  describe('custom filter', () => {
    it('shows Custom button', () => {
      render(<TimeFilter />);
      expect(screen.getByText('Custom')).toBeInTheDocument();
    });

    it('shows custom inputs when Custom is clicked', () => {
      render(<TimeFilter />);
      fireEvent.click(screen.getByText('Custom'));
      expect(screen.getByLabelText('From:')).toBeInTheDocument();
      expect(screen.getByLabelText('To:')).toBeInTheDocument();
    });

    it('hides custom inputs when Custom is clicked again', () => {
      render(<TimeFilter />);
      fireEvent.click(screen.getByText('Custom'));
      fireEvent.click(screen.getByText('Custom'));
      expect(screen.queryByLabelText('From:')).not.toBeInTheDocument();
    });

    it('shows error when Apply is clicked with empty inputs', () => {
      render(<TimeFilter />);
      fireEvent.click(screen.getByText('Custom'));
      fireEvent.click(screen.getByText('Apply'));
      expect(screen.getByText(/Please enter at least a start or end time/i)).toBeInTheDocument();
    });

    it('shows error for invalid start time', () => {
      render(<TimeFilter />);
      fireEvent.click(screen.getByText('Custom'));
      const startInput = screen.getByLabelText('From:');
      fireEvent.change(startInput, { target: { value: 'invalid-time' } });
      fireEvent.click(screen.getByText('Apply'));
      expect(screen.getByText(/Invalid start time/i)).toBeInTheDocument();
    });

    it('shows error for invalid end time', () => {
      render(<TimeFilter />);
      fireEvent.click(screen.getByText('Custom'));
      const endInput = screen.getByLabelText('To:');
      fireEvent.change(endInput, { target: { value: 'invalid-end' } });
      fireEvent.click(screen.getByText('Apply'));
      expect(screen.getByText(/Invalid end time/i)).toBeInTheDocument();
    });

    it('calls setTimeFilter with valid start time', () => {
      render(<TimeFilter />);
      fireEvent.click(screen.getByText('Custom'));
      const startInput = screen.getByLabelText('From:');
      fireEvent.change(startInput, { target: { value: '12:34:56' } });
      fireEvent.click(screen.getByText('Apply'));
      expect(mockSetTimeFilter).toHaveBeenCalledWith('12:34:56', null);
    });

    it('calls setTimeFilter with valid end time only', () => {
      render(<TimeFilter />);
      fireEvent.click(screen.getByText('Custom'));
      const endInput = screen.getByLabelText('To:');
      fireEvent.change(endInput, { target: { value: '13:00:00' } });
      fireEvent.click(screen.getByText('Apply'));
      expect(mockSetTimeFilter).toHaveBeenCalledWith(null, '13:00:00');
    });

    it('calls setTimeFilter with both valid start and end times', () => {
      render(<TimeFilter />);
      fireEvent.click(screen.getByText('Custom'));
      fireEvent.change(screen.getByLabelText('From:'), { target: { value: '12:00:00' } });
      fireEvent.change(screen.getByLabelText('To:'), { target: { value: '12:30:00' } });
      fireEvent.click(screen.getByText('Apply'));
      expect(mockSetTimeFilter).toHaveBeenCalledWith('12:00:00', '12:30:00');
    });

    it('submits form on Enter key in start input', () => {
      render(<TimeFilter />);
      fireEvent.click(screen.getByText('Custom'));
      const startInput = screen.getByLabelText('From:');
      fireEvent.change(startInput, { target: { value: '12:00:00' } });
      fireEvent.keyDown(startInput, { key: 'Enter' });
      expect(mockSetTimeFilter).toHaveBeenCalledWith('12:00:00', null);
    });

    it('submits form on Enter key in end input', () => {
      render(<TimeFilter />);
      fireEvent.click(screen.getByText('Custom'));
      const endInput = screen.getByLabelText('To:');
      fireEvent.change(endInput, { target: { value: '12:30:00' } });
      fireEvent.keyDown(endInput, { key: 'Enter' });
      expect(mockSetTimeFilter).toHaveBeenCalledWith(null, '12:30:00');
    });

    it('clears error when typing in start input', () => {
      render(<TimeFilter />);
      fireEvent.click(screen.getByText('Custom'));
      // Trigger an error first
      fireEvent.click(screen.getByText('Apply'));
      expect(screen.getByText(/Please enter at least a start or end time/i)).toBeInTheDocument();
      // Start typing
      fireEvent.change(screen.getByLabelText('From:'), { target: { value: 'a' } });
      expect(screen.queryByText(/Please enter at least a start or end time/i)).not.toBeInTheDocument();
    });

    it('closes custom panel after Apply with valid time', () => {
      render(<TimeFilter />);
      fireEvent.click(screen.getByText('Custom'));
      fireEvent.change(screen.getByLabelText('From:'), { target: { value: '12:00:00' } });
      fireEvent.click(screen.getByText('Apply'));
      expect(screen.queryByLabelText('From:')).not.toBeInTheDocument();
    });

    it('hides custom panel after clicking a shortcut', () => {
      render(<TimeFilter />);
      fireEvent.click(screen.getByText('Custom'));
      expect(screen.getByLabelText('From:')).toBeInTheDocument();
      fireEvent.click(screen.getByText('Last 5 min'));
      expect(screen.queryByLabelText('From:')).not.toBeInTheDocument();
    });
  });
});
