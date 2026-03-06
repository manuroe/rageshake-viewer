import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    fireEvent.click(screen.getByRole('dialog'));
    expect(toggleHelp).toHaveBeenCalledTimes(1);
  });

  it('calls toggleHelp when Escape is pressed', () => {
    const toggleHelp = vi.fn();
    renderWithCtx(makeCtx({ showHelp: true, toggleHelp }), <ShortcutHelpOverlay />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(toggleHelp).toHaveBeenCalledTimes(1);
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
