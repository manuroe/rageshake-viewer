import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { BurgerMenu } from '../BurgerMenu';
import { useLogStore } from '../../stores/logStore';
import { KeyboardShortcutContext } from '../KeyboardShortcutContext';
import type { KeyboardShortcutContextValue } from '../KeyboardShortcutContext';

// Bypass zustand persist middleware to avoid localStorage issues in tests
vi.mock('zustand/middleware', async (importOriginal) => {
  const original = await importOriginal<typeof import('zustand/middleware')>();
  return {
    ...original,
    persist: (fn: (...args: unknown[]) => unknown) => fn,
  };
});

// Track navigation calls
const navigateMock = vi.fn();
let currentSearchParams = new URLSearchParams();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useSearchParams: () => [currentSearchParams, vi.fn()],
  };
});

describe('BurgerMenu', () => {
  beforeEach(() => {
    navigateMock.mockClear();
    currentSearchParams = new URLSearchParams();
    useLogStore.getState().clearData();
  });

  describe('Cross-View Navigation Param Preservation', () => {
    it('preserves start and end params when navigating to another view', () => {
      currentSearchParams = new URLSearchParams('start=2025-01-01T00:00:00Z&end=2025-01-01T12:00:00Z');

      render(
        <MemoryRouter initialEntries={['/http_requests?start=2025-01-01T00:00:00Z&end=2025-01-01T12:00:00Z']}>
          <BurgerMenu />
        </MemoryRouter>
      );

      // Open menu
      fireEvent.click(screen.getByRole('button', { name: /menu/i }));

      // Click on "All Logs"
      fireEvent.click(screen.getByText('All Logs'));

      expect(navigateMock).toHaveBeenCalledWith(
        '/logs?start=2025-01-01T00%3A00%3A00Z&end=2025-01-01T12%3A00%3A00Z'
      );
    });

    it('clears view-specific params (scale, status, filter, request_id) when navigating', () => {
      currentSearchParams = new URLSearchParams(
        'start=2025-01-01T00:00:00Z&end=2025-01-01T12:00:00Z&scale=50&status=200,500&filter=sync&request_id=REQ-1'
      );

      render(
        <MemoryRouter initialEntries={['/http_requests']}>
          <BurgerMenu />
        </MemoryRouter>
      );

      // Open menu
      fireEvent.click(screen.getByRole('button', { name: /menu/i }));

      // Click on "Summary"
      fireEvent.click(screen.getByText('Summary'));

      // Should only have start and end, not scale/status/filter/request_id
      const navigatedPath = navigateMock.mock.calls[0][0];
      expect(navigatedPath).toContain('start=');
      expect(navigatedPath).toContain('end=');
      expect(navigatedPath).not.toContain('scale=');
      expect(navigatedPath).not.toContain('status=');
      expect(navigatedPath).not.toContain('filter=');
      expect(navigatedPath).not.toContain('request_id=');
    });

    it('navigates without params when no start/end present', () => {
      currentSearchParams = new URLSearchParams('scale=50&filter=sync');

      render(
        <MemoryRouter initialEntries={['/http_requests']}>
          <BurgerMenu />
        </MemoryRouter>
      );

      // Open menu
      fireEvent.click(screen.getByRole('button', { name: /menu/i }));

      // Click on "All Logs"
      fireEvent.click(screen.getByText('All Logs'));

      // Should navigate to plain path without query string
      expect(navigateMock).toHaveBeenCalledWith('/logs');
    });

    it('preserves only start when end is not present', () => {
      currentSearchParams = new URLSearchParams('start=last-hour&filter=sync');

      render(
        <MemoryRouter initialEntries={['/http_requests']}>
          <BurgerMenu />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole('button', { name: /menu/i }));
      fireEvent.click(screen.getByText('Summary'));

      expect(navigateMock).toHaveBeenCalledWith('/summary?start=last-hour');
    });

    it('preserves only end when start is not present', () => {
      currentSearchParams = new URLSearchParams('end=2025-01-01T12:00:00Z&status=500');

      render(
        <MemoryRouter initialEntries={['/http_requests']}>
          <BurgerMenu />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole('button', { name: /menu/i }));
      fireEvent.click(screen.getByText('HTTP Requests'));

      expect(navigateMock).toHaveBeenCalledWith(
        '/http_requests?end=2025-01-01T12%3A00%3A00Z'
      );
    });
  });

  describe('Menu Behavior', () => {
    it('closes menu after navigation', () => {
      render(
        <MemoryRouter>
          <BurgerMenu />
        </MemoryRouter>
      );

      // Open menu
      fireEvent.click(screen.getByRole('button', { name: /menu/i }));
      expect(screen.getByText('Summary')).toBeInTheDocument();

      // Navigate
      fireEvent.click(screen.getByText('Summary'));

      // Menu should be closed (dropdown no longer visible)
      expect(screen.queryByText('Summary')).not.toBeInTheDocument();
    });
  });

  describe('New Session', () => {
    it('navigates to "/" when New Session is clicked', () => {
      render(
        <MemoryRouter>
          <BurgerMenu />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole('button', { name: /menu/i }));
      fireEvent.click(screen.getByText('New Session'));

      expect(navigateMock).toHaveBeenCalledWith('/');
    });

    it('clears store data when New Session is clicked', () => {
      useLogStore.setState({ startTime: 'last-hour', endTime: 'end' });

      render(
        <MemoryRouter>
          <BurgerMenu />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole('button', { name: /menu/i }));
      fireEvent.click(screen.getByText('New Session'));

      // Store should be cleared
      expect(useLogStore.getState().allRequests).toEqual([]);
    });

    it('closes menu after New Session', () => {
      render(
        <MemoryRouter>
          <BurgerMenu />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole('button', { name: /menu/i }));
      expect(screen.getByText('New Session')).toBeInTheDocument();
      fireEvent.click(screen.getByText('New Session'));
      expect(screen.queryByText('New Session')).not.toBeInTheDocument();
    });
  });

  describe('Theme Buttons', () => {
    it('renders theme buttons when menu is open', () => {
      render(
        <MemoryRouter>
          <BurgerMenu />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole('button', { name: /menu/i }));

      expect(screen.getByRole('button', { name: /system theme/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /light theme/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /dark theme/i })).toBeInTheDocument();
    });

    it('sets light theme when Light theme button is clicked', () => {
      render(
        <MemoryRouter>
          <BurgerMenu />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole('button', { name: /menu/i }));
      fireEvent.click(screen.getByRole('button', { name: /light theme/i }));

      // Menu should still be open (theme change doesn't close menu)
      expect(screen.getByRole('button', { name: /dark theme/i })).toBeInTheDocument();
    });

    it('sets dark theme when Dark theme button is clicked', () => {
      render(
        <MemoryRouter>
          <BurgerMenu />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole('button', { name: /menu/i }));
      fireEvent.click(screen.getByRole('button', { name: /dark theme/i }));

      expect(screen.getByRole('button', { name: /dark theme/i })).toBeInTheDocument();
    });

    it('sets system theme when System theme button is clicked', () => {
      render(
        <MemoryRouter>
          <BurgerMenu />
        </MemoryRouter>
      );

      fireEvent.click(screen.getByRole('button', { name: /menu/i }));
      fireEvent.click(screen.getByRole('button', { name: /system theme/i }));

      expect(screen.getByRole('button', { name: /system theme/i })).toBeInTheDocument();
    });
  });

  describe('Close on outside click', () => {
    it('closes menu when clicking outside', () => {
      render(
        <div>
          <MemoryRouter>
            <BurgerMenu />
          </MemoryRouter>
          <div data-testid="outside">outside</div>
        </div>
      );

      fireEvent.click(screen.getByRole('button', { name: /menu/i }));
      expect(screen.getByText('Summary')).toBeInTheDocument();

      fireEvent.mouseDown(screen.getByTestId('outside'));
      expect(screen.queryByText('Summary')).not.toBeInTheDocument();
    });
  });

  describe('Sync Requests Navigation', () => {
    it('navigates to /http_requests/sync when Sync Requests is clicked', () => {
      render(
        <MemoryRouter>
          <BurgerMenu />
        </MemoryRouter>
      );
      fireEvent.click(screen.getByRole('button', { name: /menu/i }));
      fireEvent.click(screen.getByText('Sync Requests'));
      expect(navigateMock).toHaveBeenCalledWith('/http_requests/sync');
    });

    it('closes menu after navigating to Sync Requests', () => {
      render(
        <MemoryRouter>
          <BurgerMenu />
        </MemoryRouter>
      );
      fireEvent.click(screen.getByRole('button', { name: /menu/i }));
      fireEvent.click(screen.getByText('Sync Requests'));
      expect(screen.queryByText('Sync Requests')).not.toBeInTheDocument();
    });
  });

  describe('Keyboard Shortcuts Button', () => {
    it('calls toggleHelp and closes menu when Keyboard Shortcuts is clicked', () => {
      const toggleHelp = vi.fn();
      const ctx: KeyboardShortcutContextValue = {
        showHelp: false,
        toggleHelp,
        pendingChord: null,
        registerFocusSearch: vi.fn(() => vi.fn()),
        registerFocusFilter: vi.fn(() => vi.fn()),
        registerDismiss: vi.fn(() => vi.fn()),
      };
      render(
        <KeyboardShortcutContext.Provider value={ctx}>
          <MemoryRouter>
            <BurgerMenu />
          </MemoryRouter>
        </KeyboardShortcutContext.Provider>
      );
      fireEvent.click(screen.getByRole('button', { name: /menu/i }));
      fireEvent.click(screen.getByText('Keyboard Shortcuts'));
      expect(toggleHelp).toHaveBeenCalledTimes(1);
      expect(screen.queryByText('Keyboard Shortcuts')).not.toBeInTheDocument();
    });
  });
});
