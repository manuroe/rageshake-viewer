import { createContext, useContext } from 'react';

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

export interface KeyboardShortcutContextValue {
  /** Whether the help overlay is visible */
  showHelp: boolean;
  /** Toggle the help overlay */
  toggleHelp: () => void;
  /** The chord leader key currently waiting for a second key (e.g. 'g'), or null */
  pendingChord: string | null;
  /**
   * Register a handler to be called when Cmd+/ is pressed (focus search).
   * Returns an unregister function.
   */
  registerFocusSearch: (fn: () => void) => () => void;
  /**
   * Register a handler to be called when Cmd+F is pressed (focus filter).
   * Returns an unregister function.
   */
  registerFocusFilter: (fn: () => void) => () => void;
}

export const KeyboardShortcutContext = createContext<KeyboardShortcutContextValue | null>(null);

// ---------------------------------------------------------------------------
// Consumer hooks
// ---------------------------------------------------------------------------

export function useKeyboardShortcutContext(): KeyboardShortcutContextValue {
  const ctx = useContext(KeyboardShortcutContext);
  if (!ctx) {
    throw new Error('useKeyboardShortcutContext must be used inside KeyboardShortcutProvider');
  }
  return ctx;
}

/**
 * Like useKeyboardShortcutContext but returns null when used outside the provider.
 * Use this in components that are optionally rendered inside the provider.
 */
export function useKeyboardShortcutContextOptional(): KeyboardShortcutContextValue | null {
  return useContext(KeyboardShortcutContext);
}
