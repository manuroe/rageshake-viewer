import { useEffect, useRef, useCallback } from 'react';

/** Duration in ms to wait for the second key in a chord sequence */
const CHORD_TIMEOUT_MS = 1000;

export type ChordKey = 'g';

export type KeyHandler = (e: KeyboardEvent) => void;

interface UseKeyboardShortcutsOptions {
  /** Called when a chord leader key is pressed (e.g. 'g') */
  onChordStart?: (chord: ChordKey) => void;
  /** Called when the chord sequence completes (e.g. 'g' + 's') */
  onChordComplete?: (chord: ChordKey, second: string) => void;
  /** Called when the chord times out without a second key */
  onChordTimeout?: (chord: ChordKey) => void;
  /** Additional one-off key handlers (called for non-chord keys) */
  onKey?: KeyHandler;
  /** Whether the hook is active. Defaults to true. */
  enabled?: boolean;
}

/**
 * Low-level hook for detecting Vim-style chord sequences and individual key events.
 *
 * Chord example — the hook intercepts individual key events and the consumer
 * drives chord state by calling `startChord(key)` from the `onKey` callback:
 *   Consumer calls `startChord('g')` → chord starts (onChordStart fires)
 *   Press 's' within CHORD_TIMEOUT_MS → chord completes (onChordComplete fires with 'g', 's')
 *   If no second key within timeout → chord cancels (onChordTimeout fires)
 */
export function useKeyboardShortcuts({
  onChordStart,
  onChordComplete,
  onChordTimeout,
  onKey,
  enabled = true,
}: UseKeyboardShortcutsOptions) {
  const pendingChordRef = useRef<ChordKey | null>(null);
  const chordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearChord = useCallback(() => {
    if (chordTimerRef.current !== null) {
      clearTimeout(chordTimerRef.current);
      chordTimerRef.current = null;
    }
    pendingChordRef.current = null;
  }, []);

  const startChord = useCallback(
    (chord: ChordKey) => {
      clearChord();
      pendingChordRef.current = chord;
      onChordStart?.(chord);
      chordTimerRef.current = setTimeout(() => {
        const pending = pendingChordRef.current;
        pendingChordRef.current = null;
        chordTimerRef.current = null;
        if (pending) onChordTimeout?.(pending);
      }, CHORD_TIMEOUT_MS);
    },
    [clearChord, onChordStart, onChordTimeout],
  );

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (pendingChordRef.current === 'g') {
        // We're completing the chord
        const second = e.key.toLowerCase();
        const chord = pendingChordRef.current;
        clearChord();
        // Don't propagate chord-sequence keys to the page
        e.preventDefault();
        onChordComplete?.(chord, second);
        return;
      }

      onKey?.(e);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      clearChord();
    };
  }, [enabled, clearChord, onChordComplete, onKey]);

  return { startChord, clearChord };
}
