import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';

function fireKey(key: string, options: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, ...options });
  document.dispatchEvent(event);
  return event;
}

describe('useKeyboardShortcuts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onKey for non-chord keys', () => {
    const onKey = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onKey }));

    act(() => { fireKey('a'); });
    expect(onKey).toHaveBeenCalledTimes(1);
    expect(onKey.mock.calls[0][0].key).toBe('a');
  });

  it('starts a chord sequence on leader key "g" when startChord is called', () => {
    const onChordStart = vi.fn();
    const onChordComplete = vi.fn();

    const { result } = renderHook(() =>
      useKeyboardShortcuts({ onChordStart, onChordComplete }),
    );

    act(() => {
      result.current.startChord('g');
    });

    expect(onChordStart).toHaveBeenCalledWith('g');
  });

  it('completes a chord when second key is pressed after hook-initiated chord', () => {
    const onChordComplete = vi.fn();
    const onChordStart = vi.fn();
    let capturedStartChord: (key: 'g') => void = () => {};

    const { result } = renderHook(() =>
      useKeyboardShortcuts({ onChordComplete, onChordStart }),
    );

    // The hook doesn't internally start chords from keyboard; it depends on the
    // consumer calling startChord (pending chord state is managed externally).
    // We test the chord completion by simulating pending state:
    act(() => {
      capturedStartChord = result.current.startChord;
      capturedStartChord('g');
    });

    expect(onChordStart).toHaveBeenCalledWith('g');

    // Now press the second key
    act(() => { fireKey('s'); });

    expect(onChordComplete).toHaveBeenCalledWith('g', 's');
  });

  it('calls onChordTimeout when no second key is pressed within the timeout', () => {
    const onChordTimeout = vi.fn();
    const onChordStart = vi.fn();

    const { result } = renderHook(() =>
      useKeyboardShortcuts({ onChordStart, onChordTimeout }),
    );

    act(() => { result.current.startChord('g'); });
    expect(onChordStart).toHaveBeenCalledWith('g');

    act(() => { vi.runAllTimers(); });

    expect(onChordTimeout).toHaveBeenCalledWith('g');
  });

  it('does not fire onKey while a chord is pending (second key is intercepted)', () => {
    const onKey = vi.fn();
    const { result } = renderHook(() => useKeyboardShortcuts({ onKey }));

    act(() => { result.current.startChord('g'); });

    // The second key should be intercepted by chord handling, not passed to onKey
    act(() => { fireKey('l'); });

    expect(onKey).not.toHaveBeenCalled();
  });

  it('clears pending chord state when clearChord is called', () => {
    const onChordTimeout = vi.fn();
    const onChordComplete = vi.fn();

    const { result } = renderHook(() =>
      useKeyboardShortcuts({ onChordTimeout, onChordComplete }),
    );

    act(() => { result.current.startChord('g'); });
    act(() => { result.current.clearChord(); });

    // After clearing, pressing a key should not trigger chord completion
    act(() => { fireKey('s'); });

    expect(onChordComplete).not.toHaveBeenCalled();
  });

  it('does not fire key handlers when disabled', () => {
    const onKey = vi.fn();
    renderHook(() => useKeyboardShortcuts({ onKey, enabled: false }));

    act(() => { fireKey('a'); });
    expect(onKey).not.toHaveBeenCalled();
  });
});
