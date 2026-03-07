import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ShortcutHelpOverlay, ChordToast } from '../ShortcutHelpOverlay';
import { KeyboardShortcutContext } from '../KeyboardShortcutContext';
import type { KeyboardShortcutContextValue } from '../KeyboardShortcutContext';

// Bypass zustand persist middleware
vi.mock('zustand/middleware', async (importOriginal) => {
  const original = await importOriginal<typeof import('zustand/middleware')>();
  return {
    ...original,
    persist: (fn: (...args: unknown[]) => unknown) => fn,
  };
});

function makeCtx(overrides?: Partial<KeyboardShortcutContextValue>): KeyboardShortcutContextValue {
  return {
    showHelp: false,
    toggleHelp: vi.fn(),
    pendingChord: null,
    registerFocusSearch: vi.fn(() => vi.fn()),
    registerFocusFilter: vi.fn(() => vi.fn()),
    ...overrides,
  };
}

function renderWithCtx(ctx: KeyboardShortcutContextValue, ui: React.ReactElement) {
  return render(
    <KeyboardShortcutContext.Provider value={ctx}>
      {ui}
    </KeyboardShortcutContext.Provider>,
  );
}

describe('ShortcutHelpOverlay', () => {
  it('renders nothing when showHelp is false', () => {
    renderWithCtx(makeCtx({ showHelp: false }), <ShortcutHelpOverlay />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders the overlay when showHelp is true', () => {
    renderWithCtx(makeCtx({ showHelp: true }), <ShortcutHelpOverlay />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
  });

  it('calls toggleHelp when the close button is clicked', () => {
    const toggleHelp = vi.fn();
    renderWithCtx(makeCtx({ showHelp: true, toggleHelp }), <ShortcutHelpOverlay />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(toggleHelp).toHaveBeenCalledTimes(1);
  });

  it('calls toggleHelp when the backdrop is clicked', () => {
    const toggleHelp = vi.fn();
    renderWithCtx(makeCtx({ showHelp: true, toggleHelp }), <ShortcutHelpOverlay />);
    // Backdrop is the parent of the dialog panel
    const panel = screen.getByRole('dialog');
    fireEvent.click(panel.parentElement!);
    expect(toggleHelp).toHaveBeenCalledTimes(1);
  });

  it('does not call toggleHelp when clicking inside the panel', () => {
    const toggleHelp = vi.fn();
    renderWithCtx(makeCtx({ showHelp: true, toggleHelp }), <ShortcutHelpOverlay />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(toggleHelp).not.toHaveBeenCalled();
  });

  it('focuses the close button when the overlay opens', () => {
    renderWithCtx(makeCtx({ showHelp: true }), <ShortcutHelpOverlay />);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /close/i }));
  });

  it('restores focus to previous element when overlay closes', () => {
    const button = document.createElement('button');
    button.textContent = 'prev';
    document.body.appendChild(button);
    button.focus();

    const toggleHelp = vi.fn();
    const ctx = makeCtx({ showHelp: true, toggleHelp });
    const { rerender } = renderWithCtx(ctx, <ShortcutHelpOverlay />);

    // Close the overlay
    act(() => {
      rerender(
        <KeyboardShortcutContext.Provider value={makeCtx({ showHelp: false, toggleHelp })}>
          <ShortcutHelpOverlay />
        </KeyboardShortcutContext.Provider>,
      );
    });

    expect(document.activeElement).toBe(button);
    document.body.removeChild(button);
  });

  it('does not call toggleHelp on Escape (handled by KeyboardShortcutProvider)', () => {
    const toggleHelp = vi.fn();
    renderWithCtx(makeCtx({ showHelp: true, toggleHelp }), <ShortcutHelpOverlay />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggleHelp).not.toHaveBeenCalled();
  });

  it('shows navigation shortcuts in the overlay', () => {
    renderWithCtx(makeCtx({ showHelp: true }), <ShortcutHelpOverlay />);
    expect(screen.getByText('Go to Summary')).toBeInTheDocument();
    expect(screen.getByText('Go to All Logs')).toBeInTheDocument();
    expect(screen.getByText('Go to HTTP Requests')).toBeInTheDocument();
    expect(screen.getByText('Go to Sync Requests')).toBeInTheDocument();
  });

  it('shows theme and session shortcuts', () => {
    renderWithCtx(makeCtx({ showHelp: true }), <ShortcutHelpOverlay />);
    expect(screen.getByText(/cycle theme/i)).toBeInTheDocument();
    expect(screen.getByText(/new session/i)).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // Focus trap
  // ---------------------------------------------------------------------------

  it('Tab on the last focusable element wraps focus to first', () => {
    renderWithCtx(makeCtx({ showHelp: true }), <ShortcutHelpOverlay />);
    const panel = screen.getByRole('dialog');
    const closeBtn = screen.getByRole('button', { name: /close/i });
    // Close button is both first and last focusable element; move focus to it
    closeBtn.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    panel.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(closeBtn);
  });

  it('Shift+Tab on the first focusable element wraps focus to last', () => {
    renderWithCtx(makeCtx({ showHelp: true }), <ShortcutHelpOverlay />);
    const panel = screen.getByRole('dialog');
    const closeBtn = screen.getByRole('button', { name: /close/i });
    closeBtn.focus();
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    panel.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(closeBtn);
  });

  it('non-Tab key inside the panel is not intercepted', () => {
    renderWithCtx(makeCtx({ showHelp: true }), <ShortcutHelpOverlay />);
    const panel = screen.getByRole('dialog');
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    panel.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('ChordToast', () => {
  it('renders nothing when pendingChord is null', () => {
    renderWithCtx(makeCtx({ pendingChord: null }), <ChordToast />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('renders the pending chord key when active', () => {
    renderWithCtx(makeCtx({ pendingChord: 'g' }), <ChordToast />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('g')).toBeInTheDocument();
  });
});
