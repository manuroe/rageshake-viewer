import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { useEffect } from 'react';
import { renderHook } from '@testing-library/react';
import { KeyboardShortcutProvider } from '../KeyboardShortcutProvider';
import {
  useKeyboardShortcutContext,
  useKeyboardShortcutContextOptional,
} from '../KeyboardShortcutContext';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Use vi.hoisted so these values are available inside the mock factory
// (vi.mock calls are hoisted to the top of the file by Vitest's transformer)
const { stableSearchParams, mockNavigate } = vi.hoisted(() => ({
  stableSearchParams: new URLSearchParams(),
  mockNavigate: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  // Return the SAME object each render so useCallback deps are stable and the
  // useKeyboardShortcuts effect isn't torn down between chord keys.
  useSearchParams: () => [stableSearchParams, vi.fn()],
  useNavigate: () => mockNavigate,
}));

const mockSetTheme = vi.fn();
let currentTheme = 'system';
vi.mock('../../stores/themeStore', () => ({
  useThemeStore: () => ({ theme: currentTheme, setTheme: mockSetTheme }),
}));

vi.mock('zustand/middleware', async (importOriginal) => {
  const original = await importOriginal<typeof import('zustand/middleware')>();
  return {
    ...original,
    persist: (fn: (...args: unknown[]) => unknown) => fn,
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render the provider with a context-consumer child that exposes state. */
function ContextConsumer() {
  const ctx = useKeyboardShortcutContext();
  return (
    <div>
      <span data-testid="show-help">{String(ctx.showHelp)}</span>
      <span data-testid="pending-chord">{ctx.pendingChord ?? 'none'}</span>
      <button data-testid="toggle-help" onClick={ctx.toggleHelp}>
        Toggle Help
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <KeyboardShortcutProvider>
      <ContextConsumer />
    </KeyboardShortcutProvider>,
  );
}

function fireKey(key: string, options: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  document.dispatchEvent(event);
  return event;
}

// ---------------------------------------------------------------------------
// useKeyboardShortcutContext — throw path
// ---------------------------------------------------------------------------

describe('useKeyboardShortcutContext', () => {
  it('throws when used outside the provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useKeyboardShortcutContext())).toThrow(
      'useKeyboardShortcutContext must be used inside KeyboardShortcutProvider',
    );
  });

  it('useKeyboardShortcutContextOptional returns null outside provider', () => {
    const { result } = renderHook(() => useKeyboardShortcutContextOptional());
    expect(result.current).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// KeyboardShortcutProvider — core state & toggleHelp
// ---------------------------------------------------------------------------

describe('KeyboardShortcutProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockNavigate.mockClear();
    mockSetTheme.mockClear();
    currentTheme = 'system';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes showHelp=false by default', () => {
    renderProvider();
    expect(screen.getByTestId('show-help').textContent).toBe('false');
  });

  it('exposes pendingChord=none by default', () => {
    renderProvider();
    expect(screen.getByTestId('pending-chord').textContent).toBe('none');
  });

  it('toggleHelp via context button toggles showHelp', () => {
    renderProvider();
    act(() => { fireEvent.click(screen.getByTestId('toggle-help')); });
    expect(screen.getByTestId('show-help').textContent).toBe('true');
    act(() => { fireEvent.click(screen.getByTestId('toggle-help')); });
    expect(screen.getByTestId('show-help').textContent).toBe('false');
  });

  // ---------------------------------------------------------------------------
  // Plain-key shortcuts
  // ---------------------------------------------------------------------------

  it('? key opens help overlay', () => {
    renderProvider();
    act(() => { fireKey('?'); });
    expect(screen.getByTestId('show-help').textContent).toBe('true');
  });

  it('? key toggles help overlay closed when already open', () => {
    renderProvider();
    act(() => { fireKey('?'); });
    act(() => { fireKey('?'); });
    expect(screen.getByTestId('show-help').textContent).toBe('false');
  });

  it('? key does nothing when an input element is focused', () => {
    renderProvider();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    act(() => { fireKey('?'); });
    expect(screen.getByTestId('show-help').textContent).toBe('false');
    document.body.removeChild(input);
  });

  it('Escape key closes help overlay when open', () => {
    renderProvider();
    act(() => { fireKey('?'); });
    expect(screen.getByTestId('show-help').textContent).toBe('true');
    act(() => { fireKey('Escape'); });
    expect(screen.getByTestId('show-help').textContent).toBe('false');
  });

  it('Escape key does not re-open help overlay when already closed', () => {
    renderProvider();
    act(() => { fireKey('Escape'); });
    expect(screen.getByTestId('show-help').textContent).toBe('false');
  });

  it('t key cycles theme system → light', () => {
    currentTheme = 'system';
    renderProvider();
    act(() => { fireKey('t'); });
    expect(mockSetTheme).toHaveBeenCalledWith('light');
  });

  it('t key cycles theme light → dark', () => {
    currentTheme = 'light';
    renderProvider();
    act(() => { fireKey('t'); });
    expect(mockSetTheme).toHaveBeenCalledWith('dark');
  });

  it('t key cycles theme dark → system', () => {
    currentTheme = 'dark';
    renderProvider();
    act(() => { fireKey('t'); });
    expect(mockSetTheme).toHaveBeenCalledWith('system');
  });

  it('t key does nothing when an input is focused', () => {
    renderProvider();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    act(() => { fireKey('t'); });
    expect(mockSetTheme).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  // ---------------------------------------------------------------------------
  // Chord navigation: g + second key
  // ---------------------------------------------------------------------------

  it('g+s chord navigates to /summary', () => {
    renderProvider();
    act(() => { fireKey('g'); });
    act(() => { fireKey('s'); });
    expect(mockNavigate).toHaveBeenCalledWith('/summary');
  });

  it('g+l chord navigates to /logs', () => {
    renderProvider();
    act(() => { fireKey('g'); });
    act(() => { fireKey('l'); });
    expect(mockNavigate).toHaveBeenCalledWith('/logs');
  });

  it('g+h chord navigates to /http_requests', () => {
    renderProvider();
    act(() => { fireKey('g'); });
    act(() => { fireKey('h'); });
    expect(mockNavigate).toHaveBeenCalledWith('/http_requests');
  });

  it('g+y chord navigates to /http_requests/sync', () => {
    renderProvider();
    act(() => { fireKey('g'); });
    act(() => { fireKey('y'); });
    expect(mockNavigate).toHaveBeenCalledWith('/http_requests/sync');
  });

  it('g chord sets pendingChord to "g"', () => {
    renderProvider();
    act(() => { fireKey('g'); });
    expect(screen.getByTestId('pending-chord').textContent).toBe('g');
  });

  it('pendingChord clears after chord completion', () => {
    renderProvider();
    act(() => { fireKey('g'); });
    act(() => { fireKey('s'); });
    expect(screen.getByTestId('pending-chord').textContent).toBe('none');
  });

  it('pendingChord clears after chord timeout', () => {
    renderProvider();
    act(() => { fireKey('g'); });
    expect(screen.getByTestId('pending-chord').textContent).toBe('g');
    act(() => { vi.runAllTimers(); });
    expect(screen.getByTestId('pending-chord').textContent).toBe('none');
  });

  it('g chord does nothing when an input is focused', () => {
    renderProvider();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    act(() => { fireKey('g'); });
    expect(screen.getByTestId('pending-chord').textContent).toBe('none');
    document.body.removeChild(input);
  });

  // ---------------------------------------------------------------------------
  // registerFocusSearch / registerFocusFilter
  // ---------------------------------------------------------------------------

  it('/ key calls a registered focus-search handler', () => {
    const searchHandler = vi.fn();
    function RegisterSearch() {
      const ctx = useKeyboardShortcutContext();
      useEffect(() => ctx.registerFocusSearch(searchHandler), [ctx]);
      return null;
    }
    render(
      <KeyboardShortcutProvider>
        <RegisterSearch />
      </KeyboardShortcutProvider>,
    );
    act(() => { fireKey('/'); });
    expect(searchHandler).toHaveBeenCalledTimes(1);
  });

  it('/ key does nothing when input is focused', () => {
    const searchHandler = vi.fn();
    function RegisterSearch() {
      const ctx = useKeyboardShortcutContext();
      useEffect(() => ctx.registerFocusSearch(searchHandler), [ctx]);
      return null;
    }
    render(
      <KeyboardShortcutProvider>
        <RegisterSearch />
      </KeyboardShortcutProvider>,
    );
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    act(() => { fireKey('/'); });
    expect(searchHandler).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('/ key does nothing when no search handler is registered', () => {
    renderProvider();
    // No handler registered - should not throw
    expect(() => act(() => { fireKey('/'); })).not.toThrow();
  });

  it('Cmd+/ calls a registered focus-filter handler', () => {
    const filterHandler = vi.fn();
    function RegisterFilter() {
      const ctx = useKeyboardShortcutContext();
      useEffect(() => ctx.registerFocusFilter(filterHandler), [ctx]);
      return null;
    }
    render(
      <KeyboardShortcutProvider>
        <RegisterFilter />
      </KeyboardShortcutProvider>,
    );
    act(() => { fireKey('/', { metaKey: true }); });
    expect(filterHandler).toHaveBeenCalledTimes(1);
  });

  it('Cmd+/ does not preventDefault when no filter handler is registered', () => {
    renderProvider();
    const event = new KeyboardEvent('keydown', {
      key: '/',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => { document.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
  });

  it('Cmd+F calls a registered focus-filter handler', () => {
    const filterHandler = vi.fn();
    function RegisterFilter() {
      const ctx = useKeyboardShortcutContext();
      useEffect(() => ctx.registerFocusFilter(filterHandler), [ctx]);
      return null;
    }
    render(
      <KeyboardShortcutProvider>
        <RegisterFilter />
      </KeyboardShortcutProvider>,
    );
    act(() => { fireKey('f', { metaKey: true }); });
    expect(filterHandler).toHaveBeenCalledTimes(1);
  });

  it('Cmd+F does not preventDefault when no filter handler is registered', () => {
    renderProvider();
    const event = new KeyboardEvent('keydown', {
      key: 'f',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => { document.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
  });

  it('registerFocusSearch cleans up when the returned function is called', () => {
    const searchHandler = vi.fn();
    function RegisterSearch() {
      const ctx = useKeyboardShortcutContext();
      useEffect(() => {
        const unregister = ctx.registerFocusSearch(searchHandler);
        return unregister;
      }, [ctx]);
      return null;
    }
    const { unmount } = render(
      <KeyboardShortcutProvider>
        <RegisterSearch />
      </KeyboardShortcutProvider>,
    );
    // Unmounting calls the cleanup returned by useEffect → calls unregister
    unmount();
    // Handler should no longer be called after unregister
    act(() => { fireKey('/'); });
    expect(searchHandler).not.toHaveBeenCalled();
  });

  it('registerFocusFilter cleans up when the returned function is called', () => {
    const filterHandler = vi.fn();
    function RegisterFilter() {
      const ctx = useKeyboardShortcutContext();
      useEffect(() => {
        const unregister = ctx.registerFocusFilter(filterHandler);
        return unregister;
      }, [ctx]);
      return null;
    }
    const { unmount } = render(
      <KeyboardShortcutProvider>
        <RegisterFilter />
      </KeyboardShortcutProvider>,
    );
    unmount();
    act(() => { fireKey('/', { metaKey: true }); });
    expect(filterHandler).not.toHaveBeenCalled();
  });
});
