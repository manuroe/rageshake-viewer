import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useThemeStore } from '../stores/themeStore';
import { isInputFocused } from '../utils/shortcuts';
import { useKeyboardShortcuts, type ChordKey } from '../hooks/useKeyboardShortcuts';
import {
  KeyboardShortcutContext,
  type KeyboardShortcutContextValue,
} from './KeyboardShortcutContext';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface KeyboardShortcutProviderProps {
  children: ReactNode;
}

export function KeyboardShortcutProvider({ children }: KeyboardShortcutProviderProps) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { theme, setTheme } = useThemeStore();

  const [showHelp, setShowHelp] = useState(false);
  const [pendingChord, setPendingChord] = useState<string | null>(null);

  // Registered handlers for view-specific actions
  const focusSearchHandlerRef = useRef<(() => void) | null>(null);
  const focusFilterHandlerRef = useRef<(() => void) | null>(null);

  // startChord ref — populated after useKeyboardShortcuts hook runs below;
  // declared here so handleKey can call it without a stale closure.
  const startChordRef = useRef<(chord: ChordKey) => void>(() => undefined);
  const registerFocusSearch = useCallback((fn: () => void) => {
    focusSearchHandlerRef.current = fn;
    return () => {
      if (focusSearchHandlerRef.current === fn) {
        focusSearchHandlerRef.current = null;
      }
    };
  }, []);

  const registerFocusFilter = useCallback((fn: () => void) => {
    focusFilterHandlerRef.current = fn;
    return () => {
      if (focusFilterHandlerRef.current === fn) {
        focusFilterHandlerRef.current = null;
      }
    };
  }, []);

  const toggleHelp = useCallback(() => setShowHelp((v) => !v), []);

  // Navigate helper that preserves time params
  const navigateTo = useCallback(
    (path: string) => {
      const start = searchParams.get('start');
      const end = searchParams.get('end');
      const params = new URLSearchParams();
      if (start) params.set('start', start);
      if (end) params.set('end', end);
      const qs = params.toString();
      void navigate(qs ? `${path}?${qs}` : path);
    },
    [navigate, searchParams],
  );

  // Cycle theme: system → light → dark → system
  const cycleTheme = useCallback(() => {
    const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    setTheme(next);
  }, [theme, setTheme]);

  // Handle chord completion (g + second key)
  const handleChordComplete = useCallback(
    (_chord: ChordKey, second: string) => {
      setPendingChord(null);
      switch (second) {
        case 's': navigateTo('/summary'); break;
        case 'l': navigateTo('/logs'); break;
        case 'h': navigateTo('/http_requests'); break;
        case 'y': navigateTo('/http_requests/sync'); break;
        default: break;
      }
    },
    [navigateTo],
  );

  const handleChordStart = useCallback((_chord: ChordKey) => {
    setPendingChord('g');
  }, []);

  const handleChordTimeout = useCallback((_chord: ChordKey) => {
    setPendingChord(null);
  }, []);

  // Handle individual key events
  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const shift = e.shiftKey;

      // --- Modifier-based shortcuts (work even when input is focused) ---

      // Cmd+/ → focus filter (only when a filter handler is registered)
      if (meta && !shift && e.key === '/') {
        const handler = focusFilterHandlerRef.current;
        if (handler) {
          e.preventDefault();
          handler();
          return;
        }
      }

      // Cmd+F → focus filter alias (only when a filter handler is registered)
      if (meta && !shift && e.key === 'f') {
        const handler = focusFilterHandlerRef.current;
        if (handler) {
          e.preventDefault();
          handler();
          return;
        }
      }

      // Escape → close help overlay
      if (e.key === 'Escape') {
        setShowHelp((current) => {
          if (current) return false;
          return current;
        });
        return;
      }

      // --- Plain-key shortcuts (only when no input is focused) ---
      if (isInputFocused()) return;

      // / → focus search
      if (e.key === '/' && !meta && !shift) {
        e.preventDefault();
        focusSearchHandlerRef.current?.();
        return;
      }

      // Chord leader: g
      if (e.key === 'g' && !meta && !shift) {
        e.preventDefault();
        startChordRef.current('g');
        return;
      }

      // ? → toggle help
      if (e.key === '?' && !meta) {
        e.preventDefault();
        setShowHelp((v) => !v);
        return;
      }

      // t → cycle theme
      if (e.key === 't' && !meta && !shift) {
        e.preventDefault();
        cycleTheme();
        return;
      }
    },
    [cycleTheme],
  );

  const { startChord } = useKeyboardShortcuts({
    onChordStart: handleChordStart,
    onChordComplete: handleChordComplete,
    onChordTimeout: handleChordTimeout,
    onKey: handleKey,
  });

  // Keep startChordRef in sync after each render (outside render path)
  useLayoutEffect(() => {
    startChordRef.current = startChord;
  });

  const contextValue: KeyboardShortcutContextValue = {
    showHelp,
    toggleHelp,
    pendingChord,
    registerFocusSearch,
    registerFocusFilter,
  };

  return (
    <KeyboardShortcutContext.Provider value={contextValue}>
      {children}
    </KeyboardShortcutContext.Provider>
  );
}
