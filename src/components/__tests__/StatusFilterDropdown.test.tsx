import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatusFilterDropdown } from '../StatusFilterDropdown';
import { useLogStore } from '../../stores/logStore';

const mockSetStatusFilter = vi.fn();

vi.mock('../../hooks/useURLParams', () => ({
  useURLParams: () => ({
    setStatusFilter: mockSetStatusFilter,
    setTimeFilter: vi.fn(),
    setScale: vi.fn(),
    setLogFilter: vi.fn(),
  }),
}));

describe('StatusFilterDropdown', () => {
  beforeEach(() => {
    mockSetStatusFilter.mockReset();
    useLogStore.setState({ statusCodeFilter: null });
  });

  describe('button label', () => {
    it('shows "All Status" when no filter is set', () => {
      render(<StatusFilterDropdown availableStatusCodes={['200', '404', '500']} />);
      expect(screen.getByText('All Status')).toBeInTheDocument();
    });

    it('shows single code when one status is selected', () => {
      useLogStore.setState({ statusCodeFilter: new Set(['200']) });
      render(<StatusFilterDropdown availableStatusCodes={['200', '404', '500']} />);
      expect(screen.getByTitle('Filter by status code')).toHaveTextContent('200');
    });

    it('shows count when multiple statuses are selected', () => {
      useLogStore.setState({ statusCodeFilter: new Set(['200', '404']) });
      render(<StatusFilterDropdown availableStatusCodes={['200', '404', '500']} />);
      expect(screen.getByText('2 selected')).toBeInTheDocument();
    });
  });

  describe('dropdown visibility', () => {
    it('dropdown is hidden initially', () => {
      render(<StatusFilterDropdown availableStatusCodes={['200', '404']} />);
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('shows dropdown when button is clicked', () => {
      render(<StatusFilterDropdown availableStatusCodes={['200', '404']} />);
      fireEvent.click(screen.getByTitle('Filter by status code'));
      expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    });

    it('closes dropdown when button is clicked again', () => {
      render(<StatusFilterDropdown availableStatusCodes={['200']} />);
      const btn = screen.getByTitle('Filter by status code');
      fireEvent.click(btn);
      fireEvent.click(btn);
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });

    it('has correct aria-expanded when closed', () => {
      render(<StatusFilterDropdown availableStatusCodes={['200']} />);
      expect(screen.getByTitle('Filter by status code')).toHaveAttribute('aria-expanded', 'false');
    });

    it('has correct aria-expanded when open', () => {
      render(<StatusFilterDropdown availableStatusCodes={['200']} />);
      fireEvent.click(screen.getByTitle('Filter by status code'));
      expect(screen.getByTitle('Filter by status code')).toHaveAttribute('aria-expanded', 'true');
    });
  });

  describe('status code options', () => {
    it('renders all available status codes', () => {
      render(<StatusFilterDropdown availableStatusCodes={['200', '404', '500']} />);
      fireEvent.click(screen.getByTitle('Filter by status code'));
      expect(screen.getByText('200')).toBeInTheDocument();
      expect(screen.getByText('404')).toBeInTheDocument();
      expect(screen.getByText('500')).toBeInTheDocument();
    });

    it('all checkboxes are checked when filter is null (show all)', () => {
      useLogStore.setState({ statusCodeFilter: null });
      render(<StatusFilterDropdown availableStatusCodes={['200', '404']} />);
      fireEvent.click(screen.getByTitle('Filter by status code'));
      const checkboxes = screen.getAllByRole('checkbox');
      checkboxes.forEach(cb => expect(cb).toBeChecked());
    });

    it('checkbox is checked for codes in filter set', () => {
      useLogStore.setState({ statusCodeFilter: new Set(['200']) });
      render(<StatusFilterDropdown availableStatusCodes={['200', '404']} />);
      fireEvent.click(screen.getByTitle('Filter by status code'));
      const checkboxes = screen.getAllByRole('checkbox');
      const checked = checkboxes.filter(cb => (cb as HTMLInputElement).checked);
      const unchecked = checkboxes.filter(cb => !(cb as HTMLInputElement).checked);
      expect(checked).toHaveLength(1);
      expect(unchecked).toHaveLength(1);
    });
  });

  describe('toggle behavior', () => {
    it('when null filter (all), toggling a code excludes it', () => {
      useLogStore.setState({ statusCodeFilter: null });
      render(<StatusFilterDropdown availableStatusCodes={['200', '404', '500']} />);
      fireEvent.click(screen.getByTitle('Filter by status code'));
      const checkboxes = screen.getAllByRole('checkbox');
      // Click first checkbox to toggle '200'
      fireEvent.click(checkboxes[0]);
      expect(mockSetStatusFilter).toHaveBeenCalledWith(new Set(['404', '500']));
    });

    it('when a filter is active, toggling an included code removes it', () => {
      useLogStore.setState({ statusCodeFilter: new Set(['200', '404']) });
      render(<StatusFilterDropdown availableStatusCodes={['200', '404', '500']} />);
      fireEvent.click(screen.getByTitle('Filter by status code'));
      const checkboxes = screen.getAllByRole('checkbox');
      // Click first checkbox to toggle '200' (currently included in filter)
      fireEvent.click(checkboxes[0]);
      expect(mockSetStatusFilter).toHaveBeenCalled();
    });

    it('when a filter is active, toggling an excluded code adds it', () => {
      useLogStore.setState({ statusCodeFilter: new Set(['200']) });
      render(<StatusFilterDropdown availableStatusCodes={['200', '404', '500']} />);
      fireEvent.click(screen.getByTitle('Filter by status code'));
      const checkboxes = screen.getAllByRole('checkbox');
      // Click second checkbox to toggle '404' (not in filter)
      fireEvent.click(checkboxes[1]);
      expect(mockSetStatusFilter).toHaveBeenCalled();
    });

    it('Select All resets filter to null', () => {
      useLogStore.setState({ statusCodeFilter: new Set(['200']) });
      render(<StatusFilterDropdown availableStatusCodes={['200', '404']} />);
      fireEvent.click(screen.getByTitle('Filter by status code'));
      fireEvent.click(screen.getByText('Select All'));
      expect(mockSetStatusFilter).toHaveBeenCalledWith(null);
    });

    it('selecting all codes via toggles resets to null', () => {
      useLogStore.setState({ statusCodeFilter: new Set(['200']) });
      render(<StatusFilterDropdown availableStatusCodes={['200', '404']} />);
      fireEvent.click(screen.getByTitle('Filter by status code'));
      const checkboxes = screen.getAllByRole('checkbox');
      // Click second checkbox to add '404' - now all codes selected → reset to null
      fireEvent.click(checkboxes[1]);
      // Should reset to null since all codes are now selected
      expect(mockSetStatusFilter).toHaveBeenCalledWith(null);
    });

    it('removing last code from filter resets to null', () => {
      useLogStore.setState({ statusCodeFilter: new Set(['200']) });
      render(<StatusFilterDropdown availableStatusCodes={['200', '404']} />);
      fireEvent.click(screen.getByTitle('Filter by status code'));
      const checkboxes = screen.getAllByRole('checkbox');
      // Toggle the only selected code (200) - toggleStatusCode removes it from the filter
      fireEvent.click(checkboxes[0]);
      expect(mockSetStatusFilter).toHaveBeenCalledWith(null);
    });
  });

  describe('close on outside click', () => {
    it('closes when clicking outside the dropdown', () => {
      render(
        <div>
          <StatusFilterDropdown availableStatusCodes={['200', '404']} />
          <div data-testid="outside">outside</div>
        </div>
      );
      fireEvent.click(screen.getByTitle('Filter by status code'));
      expect(screen.getAllByRole('checkbox')).toHaveLength(2);

      fireEvent.mouseDown(screen.getByTestId('outside'));
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });
  });

  describe('empty available codes', () => {
    it('renders with empty available status codes', () => {
      render(<StatusFilterDropdown availableStatusCodes={[]} />);
      expect(screen.getByText('All Status')).toBeInTheDocument();
    });

    it('shows only Select All with no codes', () => {
      render(<StatusFilterDropdown availableStatusCodes={[]} />);
      fireEvent.click(screen.getByTitle('Filter by status code'));
      expect(screen.getByText('Select All')).toBeInTheDocument();
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    });
  });
});
