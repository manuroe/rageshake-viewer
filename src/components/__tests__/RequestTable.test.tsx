/**
 * Unit tests for RequestTable.tsx
 * Tests rendering, user interactions, and edge cases.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RequestTable } from '../RequestTable';
import type { RequestTableProps, ColumnDef } from '../RequestTable';
import { useLogStore } from '../../stores/logStore';
import { createHttpRequest, createParsedLogLine } from '../../test/fixtures';
import { mockVirtualizer } from '../../test/mocks';

// Mock the virtualizer hook used by WaterfallTimeline
vi.mock('@tanstack/react-virtual', () => mockVirtualizer());

// Spy on navigate to verify onExpand routing
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const mod = await importOriginal<typeof import('react-router-dom')>();
  return { ...mod, useNavigate: () => mockNavigate };
});

// Mock LogDisplayView to avoid deep rendering
vi.mock('../../views/LogDisplayView', () => ({
  LogDisplayView: vi.fn(({ onClose, onExpand }) => (
    <div data-testid="log-display-view">
      <button onClick={onClose}>Close</button>
      <button onClick={onExpand}>Expand</button>
    </div>
  )),
}));

// Mock BurgerMenu
vi.mock('../BurgerMenu', () => ({
  BurgerMenu: () => <div data-testid="burger-menu" />,
}));

// Mock useURLParams to directly update store (simulating App.tsx URL→Store sync)
vi.mock('../../hooks/useURLParams', () => ({
  useURLParams: () => ({
    setUriFilter: (filter: string | null) => {
      useLogStore.getState().setUriFilter(filter);
    },
    setStatusFilter: (codes: Set<string> | null) => {
      useLogStore.getState().setStatusFilter(codes);
    },
    setTimeFilter: () => {},
    setScale: (scale: number) => {
      useLogStore.getState().setTimelineScale(scale);
    },
    setRequestId: () => {},
  }),
}));

// Default columns for testing
const defaultColumns: ColumnDef[] = [
  { id: 'requestId', label: 'Request ID', getValue: (r) => r.requestId },
  { id: 'method', label: 'Method', getValue: (r) => r.method },
  { id: 'status', label: 'Status', getValue: (r) => r.status },
];

// Create default props factory
function createProps(overrides: Partial<RequestTableProps> = {}): RequestTableProps {
  return {
    title: 'Test Requests',
    columns: defaultColumns,
    filteredRequests: [],
    totalCount: 0,
    showIncomplete: false,
    onShowIncompleteChange: vi.fn(),
    msPerPixel: 10,
    availableStatusCodes: ['200', '404', '500'],
    ...overrides,
  };
}

// Wrapper to provide router context
function renderWithRouter(ui: React.ReactElement, initialEntries: string[] = ['/http_requests']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      {ui}
    </MemoryRouter>
  );
}

describe('RequestTable', () => {
  beforeEach(() => {
    useLogStore.getState().clearData();
    // Reset location hash
    window.location.hash = '';
  });

  describe('rendering', () => {
    it('renders the title', () => {
      renderWithRouter(<RequestTable {...createProps({ title: 'My Requests' })} />);

      expect(screen.getByText('My Requests')).toBeInTheDocument();
    });

    it('renders column headers', () => {
      renderWithRouter(<RequestTable {...createProps()} />);

      expect(screen.getByText('Request ID')).toBeInTheDocument();
      expect(screen.getByText('Method')).toBeInTheDocument();
      expect(screen.getByText('Status')).toBeInTheDocument();
    });

    it('renders the incomplete checkbox', () => {
      renderWithRouter(<RequestTable {...createProps({ showIncomplete: true })} />);

      const checkbox = screen.getByRole('checkbox', { name: /incomplete/i });
      expect(checkbox).toBeInTheDocument();
      expect(checkbox).toBeChecked();
    });

    it('renders the /sync checkbox enabled by default', () => {
      renderWithRouter(<RequestTable {...createProps()} />);

      const syncCheckbox = screen.getByRole('checkbox', { name: '/sync' });
      expect(syncCheckbox).toBeInTheDocument();
      expect(syncCheckbox).toBeChecked();
    });

    it('renders request count stats', () => {
      renderWithRouter(<RequestTable {...createProps({ 
        filteredRequests: createRequests(3),
        totalCount: 5 
      })} />);

      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('renders empty message when no requests', () => {
      renderWithRouter(<RequestTable {...createProps({ 
        filteredRequests: [],
        emptyMessage: 'Nothing to display' 
      })} />);

      expect(screen.getByText('Nothing to display')).toBeInTheDocument();
    });

    it('renders default empty message', () => {
      renderWithRouter(<RequestTable {...createProps({ filteredRequests: [] })} />);

      expect(screen.getByText('No requests found')).toBeInTheDocument();
    });

    it('renders headerSlot when provided', () => {
      renderWithRouter(<RequestTable {...createProps({
        headerSlot: <div data-testid="custom-slot">Custom Header</div>
      })} />);

      expect(screen.getByTestId('custom-slot')).toBeInTheDocument();
    });

    it('renders timeline scale selector', () => {
      renderWithRouter(<RequestTable {...createProps({ msPerPixel: 25 })} />);

      const scaleButton = screen.getByTitle('Timeline scale');
      expect(scaleButton).toHaveTextContent('1px = 25ms');
    });
  });

  describe('interactions', () => {
    it('calls onShowIncompleteChange when checkbox is toggled', () => {
      const onShowIncompleteChange = vi.fn();
      renderWithRouter(<RequestTable {...createProps({ 
        showIncomplete: true,
        onShowIncompleteChange
      })} />);

      const checkbox = screen.getByRole('checkbox', { name: /incomplete/i });
      fireEvent.click(checkbox);

      expect(onShowIncompleteChange).toHaveBeenCalledWith(false);
    });

    it('hides /sync requests when /sync checkbox is unchecked', () => {
      const requests = [
        createHttpRequest({
          requestId: 'SYNC-REQ',
          uri: 'https://matrix.example.org/_matrix/client/v3/sync?since=abc',
          sendLineNumber: 0,
          responseLineNumber: 1,
        }),
        createHttpRequest({
          requestId: 'NONSYNC-REQ',
          uri: 'https://matrix.example.org/_matrix/client/v3/rooms/!room:example.org/messages',
          sendLineNumber: 2,
          responseLineNumber: 3,
        }),
      ];
      const rawLines = [
        createParsedLogLine({ lineNumber: 0, timestampUs: 1700000000000000 }),
        createParsedLogLine({ lineNumber: 1, timestampUs: 1700000001000000 }),
        createParsedLogLine({ lineNumber: 2, timestampUs: 1700000002000000 }),
        createParsedLogLine({ lineNumber: 3, timestampUs: 1700000003000000 }),
      ];
      useLogStore.getState().setHttpRequests(requests, rawLines);

      renderWithRouter(<RequestTable {...createProps({ filteredRequests: requests, totalCount: 2 })} />);

      expect(screen.getByText('SYNC-REQ')).toBeInTheDocument();
      expect(screen.getByText('NONSYNC-REQ')).toBeInTheDocument();
      expect(document.getElementById('shown-count')).toHaveTextContent('2');

      const syncCheckbox = screen.getByRole('checkbox', { name: '/sync' });
      fireEvent.click(syncCheckbox);

      expect(screen.queryByText('SYNC-REQ')).not.toBeInTheDocument();
      expect(screen.getByText('NONSYNC-REQ')).toBeInTheDocument();
      expect(document.getElementById('shown-count')).toHaveTextContent('1');
    });

    it('updates timeline scale when selector changes', () => {
      renderWithRouter(<RequestTable {...createProps({ msPerPixel: 10 })} />);

      // Open the dropdown
      const scaleButton = screen.getByTitle('Timeline scale');
      fireEvent.click(scaleButton);

      // Click the 50ms option
      const option = screen.getByText('1px = 50ms');
      fireEvent.click(option);

      expect(useLogStore.getState().timelineScale).toBe(50);
    });

    it('highlights both left and right panels on row hover', () => {
      const requests = createRequests(2);
      const rawLines = [
        createParsedLogLine({ lineNumber: 0, timestampUs: 1700000000000000 }),
        createParsedLogLine({ lineNumber: 1, timestampUs: 1700000001000000 }),
        createParsedLogLine({ lineNumber: 2, timestampUs: 1700000002000000 }),
        createParsedLogLine({ lineNumber: 3, timestampUs: 1700000003000000 }),
      ];
      useLogStore.getState().setHttpRequests(requests, rawLines);

      const { container } = renderWithRouter(<RequestTable {...createProps({ 
        filteredRequests: requests, 
        totalCount: 2 
      })} />);

      // Get the first row in the left panel
      // Row keys now use sendLineNumber || responseLineNumber (not requestId).
      // For REQ-0 with sendLineNumber=0 (falsy), rowKey = responseLineNumber=1.
      const leftRow = container.querySelector('[data-row-id="sticky-1"]');
      const rightRow = container.querySelector('[data-row-id="waterfall-1"]');

      expect(leftRow).toBeInTheDocument();
      expect(rightRow).toBeInTheDocument();

      // Simulate hover on left panel row
      fireEvent.mouseEnter(leftRow!);

      // Both rows should have the row-hovered class
      expect(leftRow?.classList.contains('row-hovered')).toBe(true);
      expect(rightRow?.classList.contains('row-hovered')).toBe(true);

      // Simulate mouse leave
      fireEvent.mouseLeave(leftRow!);

      // Both rows should not have the row-hovered class
      expect(leftRow?.classList.contains('row-hovered')).toBe(false);
      expect(rightRow?.classList.contains('row-hovered')).toBe(false);
    });

    it('highlights both panels when hovering waterfall row', () => {
      const requests = createRequests(2);
      const rawLines = [
        createParsedLogLine({ lineNumber: 0, timestampUs: 1700000000000000 }),
        createParsedLogLine({ lineNumber: 1, timestampUs: 1700000001000000 }),
        createParsedLogLine({ lineNumber: 2, timestampUs: 1700000002000000 }),
        createParsedLogLine({ lineNumber: 3, timestampUs: 1700000003000000 }),
      ];
      useLogStore.getState().setHttpRequests(requests, rawLines);

      const { container } = renderWithRouter(<RequestTable {...createProps({ 
        filteredRequests: requests, 
        totalCount: 2 
      })} />);

      // Row keys use sendLineNumber || responseLineNumber.
      // REQ-1 has sendLineNumber=2, so rowKey=2.
      const leftRow = container.querySelector('[data-row-id="sticky-2"]');
      const rightRow = container.querySelector('[data-row-id="waterfall-2"]');

      // Simulate hover on waterfall row
      fireEvent.mouseEnter(rightRow!);

      // Both rows should be highlighted
      expect(leftRow?.classList.contains('row-hovered')).toBe(true);
      expect(rightRow?.classList.contains('row-hovered')).toBe(true);

      // Simulate mouse leave on waterfall row
      fireEvent.mouseLeave(rightRow!);

      // Both rows should lose highlight
      expect(leftRow?.classList.contains('row-hovered')).toBe(false);
      expect(rightRow?.classList.contains('row-hovered')).toBe(false);
    });
  });

  describe('request row rendering', () => {
    it('renders request rows with column values', () => {
      const requests = [
        createHttpRequest({ requestId: 'REQ-1', method: 'GET', status: '200' }),
        createHttpRequest({ requestId: 'REQ-2', method: 'POST', status: '404' }),
      ];
      const rawLines = [
        createParsedLogLine({ lineNumber: 0, timestampUs: 1700000000000000 }),
        createParsedLogLine({ lineNumber: 1, timestampUs: 1700000001000000 }),
      ];
      useLogStore.getState().setHttpRequests(requests, rawLines);

      renderWithRouter(<RequestTable {...createProps({ 
        filteredRequests: requests, 
        totalCount: 2 
      })} />);

      expect(screen.getByText('REQ-1')).toBeInTheDocument();
      expect(screen.getByText('REQ-2')).toBeInTheDocument();
      expect(screen.getByText('GET')).toBeInTheDocument();
      expect(screen.getByText('POST')).toBeInTheDocument();
    });

    it('renders requests without status as incomplete', () => {
      const requests = [
        createHttpRequest({ requestId: 'REQ-1', status: '' }),
      ];
      const rawLines = [createParsedLogLine({ lineNumber: 0 })];
      useLogStore.getState().setHttpRequests(requests, rawLines);
      
      // Custom column that shows "Incomplete" for empty status
      const columnsWithIncompleteDisplay: ColumnDef[] = [
        { id: 'status', label: 'Status', getValue: (r) => r.status || 'Incomplete' },
      ];

      renderWithRouter(<RequestTable {...createProps({ 
        columns: columnsWithIncompleteDisplay,
        filteredRequests: requests, 
        totalCount: 1 
      })} />);

      expect(screen.getAllByText('Incomplete').length).toBeGreaterThan(0);
    });
  });

  describe('status filter dropdown', () => {
    it('renders StatusFilterDropdown with available codes', () => {
      renderWithRouter(<RequestTable {...createProps({ 
        availableStatusCodes: ['200', '201', '404']
      })} />);

      // StatusFilterDropdown shows "All Status" by default
      expect(screen.getByText('All Status')).toBeInTheDocument();
    });
  });

  describe('containerClassName', () => {
    it('applies containerClassName to app wrapper', () => {
      const { container } = renderWithRouter(<RequestTable {...createProps({ 
        containerClassName: 'http-view'
      })} />);

      expect(container.querySelector('.app.http-view')).toBeInTheDocument();
    });

    it('applies default app class when no containerClassName', () => {
      const { container } = renderWithRouter(<RequestTable {...createProps()} />);

      expect(container.querySelector('.app')).toBeInTheDocument();
    });
  });

  describe('expanded log viewer', () => {
    beforeEach(() => {
      mockNavigate.mockClear();
    });

    it('navigates to /logs with filter=requestId on onExpand', async () => {
      const req = createHttpRequest({
        requestId: 'REQ-LOG',
        sendLineNumber: 10,
        responseLineNumber: 20,
      });
      const rawLines = Array.from({ length: 25 }, (_, i) =>
        createParsedLogLine({ lineNumber: i, timestampUs: 1700000000000000 + i * 1000000 })
      );
      useLogStore.getState().setHttpRequests([req], rawLines);

      renderWithRouter(<RequestTable {...createProps({ filteredRequests: [req], totalCount: 1 })} />);

      // Open the log viewer programmatically (rowKey = sendLineNumber=10)
      act(() => {
        useLogStore.setState({
          openLogViewerIds: new Set<number>([10]),
          expandedRows: new Set<number>([10]),
        });
      });

      // The mocked LogDisplayView should be visible
      expect(await screen.findByTestId('log-display-view')).toBeInTheDocument();

      // Click Expand
      fireEvent.click(screen.getByText('Expand'));

      // Should navigate to /logs with filter set to the request ID, without start_line/end_line params
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      const navigatedUrl: string = mockNavigate.mock.calls[0][0] as string;
      expect(navigatedUrl).toMatch(/^\/logs\?/);
      expect(navigatedUrl).toContain('filter=REQ-LOG');
      expect(navigatedUrl).not.toContain('start_line');
      expect(navigatedUrl).not.toContain('end_line');
    });
  });

  // ============================================================================
  // URI Filter Integration Tests
  // ============================================================================

  describe('URI Filter SearchInput', () => {
    it('renders SearchInput when showUriFilter is true', () => {
      renderWithRouter(<RequestTable {...createProps({ 
        showUriFilter: true,
        filteredRequests: createRequests(2),
        totalCount: 2,
      })} />);

      const filterInput = screen.getByPlaceholderText('Filter URI...');
      expect(filterInput).toBeInTheDocument();
    });

    it('does not render SearchInput when showUriFilter is false', () => {
      renderWithRouter(<RequestTable {...createProps({ 
        showUriFilter: false,
        filteredRequests: createRequests(2),
        totalCount: 2,
      })} />);

      const filterInput = screen.queryByPlaceholderText('Filter URI...');
      expect(filterInput).not.toBeInTheDocument();
    });

    it('renders SearchInput by default (showUriFilter defaults to true)', () => {
      renderWithRouter(<RequestTable {...createProps({ 
        filteredRequests: createRequests(2),
        totalCount: 2,
      })} />);

      const filterInput = screen.getByPlaceholderText('Filter URI...');
      expect(filterInput).toBeInTheDocument();
    });
  });

  describe('URI Filter Value Sync', () => {
    it('syncs SearchInput value to store via debounce', async () => {
      const requests = createRequests(5);
      const rawLines = Array.from({ length: 10 }, (_, i) => 
        createParsedLogLine({ lineNumber: i, timestampUs: 1700000000000000 + i * 1000000 })
      );
      useLogStore.getState().setHttpRequests(requests, rawLines);

      renderWithRouter(<RequestTable {...createProps({ 
        showUriFilter: true,
        filteredRequests: requests,
        totalCount: 5,
      })} />);

      const filterInput = screen.getByPlaceholderText('Filter URI...') as HTMLInputElement;
      
      // Type in the input
      fireEvent.change(filterInput, { target: { value: 'sync' } });
      
      // Should not sync immediately (debounced 300ms)
      expect(useLogStore.getState().uriFilter).toBeNull();

      // Wait for debounce to complete
      await new Promise(resolve => setTimeout(resolve, 350));

      // Now it should be synced to store
      expect(useLogStore.getState().uriFilter).toBe('sync');
    });

    it('debounces rapid typing - no intermediate filters', async () => {
      const requests = createRequests(5);
      const rawLines = Array.from({ length: 10 }, (_, i) => 
        createParsedLogLine({ lineNumber: i, timestampUs: 1700000000000000 + i * 1000000 })
      );
      useLogStore.getState().setHttpRequests(requests, rawLines);

      renderWithRouter(<RequestTable {...createProps({ 
        showUriFilter: true,
        filteredRequests: requests,
        totalCount: 5,
      })} />);

      const filterInput = screen.getByPlaceholderText('Filter URI...') as HTMLInputElement;
      
      // Rapid typing
      fireEvent.change(filterInput, { target: { value: 's' } });
      await new Promise(resolve => setTimeout(resolve, 50));
      fireEvent.change(filterInput, { target: { value: 'sy' } });
      await new Promise(resolve => setTimeout(resolve, 50));
      fireEvent.change(filterInput, { target: { value: 'syn' } });
      await new Promise(resolve => setTimeout(resolve, 50));
      fireEvent.change(filterInput, { target: { value: 'sync' } });
      
      // All typed within 150ms, so debounce not yet triggered
      expect(useLogStore.getState().uriFilter).toBeNull();

      // Wait for debounce
      await new Promise(resolve => setTimeout(resolve, 350));

      // Should only apply final value after debounce
      expect(useLogStore.getState().uriFilter).toBe('sync');
    });

    it('clears filter when SearchInput is cleared', async () => {
      const requests = createRequests(5);
      const rawLines = Array.from({ length: 10 }, (_, i) => 
        createParsedLogLine({ lineNumber: i, timestampUs: 1700000000000000 + i * 1000000 })
      );
      useLogStore.getState().setHttpRequests(requests, rawLines);
      useLogStore.getState().setUriFilter('sync');

      renderWithRouter(<RequestTable {...createProps({ 
        showUriFilter: true,
        filteredRequests: requests,
        totalCount: 5,
      })} />);

      const filterInput = screen.getByPlaceholderText('Filter URI...') as HTMLInputElement;
      expect(filterInput.value).toBe('sync');

      // Click clear button
      const clearButton = screen.getByLabelText('Clear input');
      fireEvent.click(clearButton);

      // Wait for debounce to trigger sync
      await new Promise(resolve =>  setTimeout(resolve, 350));

      expect(useLogStore.getState().uriFilter).toBeNull();
      expect(filterInput.value).toBe('');
    });
  });

  describe('URI Filter Store to Input Sync', () => {
    it('syncs store changes back to SearchInput', async () => {
      const requests = createRequests(5);
      const rawLines = Array.from({ length: 10 }, (_, i) => 
        createParsedLogLine({ lineNumber: i, timestampUs: 1700000000000000 + i * 1000000 })
      );
      useLogStore.getState().setHttpRequests(requests, rawLines);

      renderWithRouter(<RequestTable {...createProps({ 
        showUriFilter: true,
        filteredRequests: requests,
        totalCount: 5,
      })} />);

      const filterInput = screen.getByPlaceholderText('Filter URI...') as HTMLInputElement;
      expect(filterInput.value).toBe('');

      // Change filter in store (e.g., via URL parameter)
      useLogStore.getState().setUriFilter('keys');

      // Wait for input to reflect store change
      await waitFor(() => {
        expect(filterInput.value).toBe('keys');
      });
    });

    it('clears input when store filter is cleared', async () => {
      const requests = createRequests(5);
      const rawLines = Array.from({ length: 10 }, (_, i) => 
        createParsedLogLine({ lineNumber: i, timestampUs: 1700000000000000 + i * 1000000 })
      );
      useLogStore.getState().setHttpRequests(requests, rawLines);
      useLogStore.getState().setUriFilter('sync');

      renderWithRouter(<RequestTable {...createProps({ 
        showUriFilter: true,
        filteredRequests: requests,
        totalCount: 5,
      })} />);

      const filterInput = screen.getByPlaceholderText('Filter URI...') as HTMLInputElement;
      expect(filterInput.value).toBe('sync');

      // Clear filter from store
      useLogStore.getState().setUriFilter(null);

      // Wait for input to be cleared
      await waitFor(() => {
        expect(filterInput.value).toBe('');
      });
    });
  });

  describe('URI Filter with Special Characters', () => {
    it('handles Matrix URIs with underscores and slashes', async () => {
      const requests = createRequests(5);
      const rawLines = Array.from({ length: 10 }, (_, i) => 
        createParsedLogLine({ lineNumber: i, timestampUs: 1700000000000000 + i * 1000000 })
      );
      useLogStore.getState().setHttpRequests(requests, rawLines);

      renderWithRouter(<RequestTable {...createProps({ 
        showUriFilter: true,
        filteredRequests: requests,
        totalCount: 5,
      })} />);

      const filterInput = screen.getByPlaceholderText('Filter URI...') as HTMLInputElement;
      const uri = '_matrix/client/r0/sync';
      
      fireEvent.change(filterInput, { target: { value: uri } });

      await new Promise(resolve => setTimeout(resolve, 350));

      expect(useLogStore.getState().uriFilter).toBe(uri);
    });

    it('handles filter with query parameters', async () => {
      const requests = createRequests(5);
      const rawLines = Array.from({ length: 10 }, (_, i) => 
        createParsedLogLine({ lineNumber: i, timestampUs: 1700000000000000 + i * 1000000 })
      );
      useLogStore.getState().setHttpRequests(requests, rawLines);

      renderWithRouter(<RequestTable {...createProps({ 
        showUriFilter: true,
        filteredRequests: requests,
        totalCount: 5,
      })} />);

      const filterInput = screen.getByPlaceholderText('Filter URI...') as HTMLInputElement;
      const uri = '/sync?filter=state&limit=10';
      
      fireEvent.change(filterInput, { target: { value: uri } });

      await new Promise(resolve => setTimeout(resolve, 350));

      expect(useLogStore.getState().uriFilter).toBe(uri);
    });

    it('handles filter with spaces', async () => {
      const requests = createRequests(5);
      const rawLines = Array.from({ length: 10 }, (_, i) => 
        createParsedLogLine({ lineNumber: i, timestampUs: 1700000000000000 + i * 1000000 })
      );
      useLogStore.getState().setHttpRequests(requests, rawLines);

      renderWithRouter(<RequestTable {...createProps({ 
        showUriFilter: true,
        filteredRequests: requests,
        totalCount: 5,
      })} />);

      const filterInput = screen.getByPlaceholderText('Filter URI...') as HTMLInputElement;
      const uri = 'room list sync';
      
      fireEvent.change(filterInput, { target: { value: uri } });

      await new Promise(resolve => setTimeout(resolve, 350));

      expect(useLogStore.getState().uriFilter).toBe(uri);
    });
  });

  describe('URI Filter Escaping Behavior', () => {
    it('Escape key clears the filter input', async () => {
      const requests = createRequests(5);
      const rawLines = Array.from({ length: 10 }, (_, i) => 
        createParsedLogLine({ lineNumber: i, timestampUs: 1700000000000000 + i * 1000000 })
      );
      useLogStore.getState().setHttpRequests(requests, rawLines);

      renderWithRouter(<RequestTable {...createProps({ 
        showUriFilter: true,
        filteredRequests: requests,
        totalCount: 5,
      })} />);

      const filterInput = screen.getByPlaceholderText('Filter URI...') as HTMLInputElement;
      
      fireEvent.change(filterInput, { target: { value: 'sync' } });

      await new Promise(resolve => setTimeout(resolve, 350));
      
      expect(useLogStore.getState().uriFilter).toBe('sync');

      // Press Escape
      fireEvent.keyDown(filterInput, { key: 'Escape' });

      await new Promise(resolve => setTimeout(resolve, 350));

      expect(useLogStore.getState().uriFilter).toBeNull();
      expect(filterInput.value).toBe('');
    });
  });

  describe('URI Filter Persistence', () => {
    it('filter persists when other properties change', async () => {
      const requests = createRequests(5);
      const rawLines = Array.from({ length: 10 }, (_, i) => 
        createParsedLogLine({ lineNumber: i, timestampUs: 1700000000000000 + i * 1000000 })
      );
      useLogStore.getState().setHttpRequests(requests, rawLines);
      useLogStore.getState().setUriFilter('sync');

      const { rerender } = renderWithRouter(<RequestTable {...createProps({ 
        showUriFilter: true,
        filteredRequests: requests,
        totalCount: 5,
        msPerPixel: 10,
      })} />);

      expect(useLogStore.getState().uriFilter).toBe('sync');

      // Change timeline scale
      useLogStore.getState().setTimelineScale(25);

      rerender(
        <MemoryRouter initialEntries={['/http_requests']}>
          <RequestTable {...createProps({ 
            showUriFilter: true,
            filteredRequests: requests,
            totalCount: 5,
            msPerPixel: 25,
          })} />
        </MemoryRouter>
      );

      // Filter should still be there
      expect(useLogStore.getState().uriFilter).toBe('sync');

      const filterInput = screen.getByPlaceholderText('Filter URI...') as HTMLInputElement;
      expect(filterInput.value).toBe('sync');
    });
  });
});

// Helper to create requests for tests
function createRequests(count: number) {
  return Array.from({ length: count }, (_, i) => 
    createHttpRequest({ 
      requestId: `REQ-${i}`,
      sendLineNumber: i * 2,
      responseLineNumber: i * 2 + 1,
    })
  );
}
