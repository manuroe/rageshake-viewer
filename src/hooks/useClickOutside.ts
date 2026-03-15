import { useEffect } from 'react';

/**
 * Attaches a `mousedown` listener that fires `onClose` whenever the user clicks
 * outside the element referenced by `ref`. Automatically removes the listener
 * when `enabled` is false or when the component unmounts.
 *
 * Extracted from four components that all duplicated the same
 * `handleClickOutside / addEventListener / removeEventListener` pattern:
 * `BurgerMenu`, `TimelineScaleSelector`, `TimeRangeSelector`, `StatusFilterDropdown`.
 *
 * @param ref     - Ref to the container element; clicks outside it trigger `onClose`.
 * @param onClose - Callback fired when an outside click is detected.
 * @param enabled - Whether the listener is active. Defaults to `true`.
 *
 * @example
 * const containerRef = useRef<HTMLDivElement>(null);
 * useClickOutside(containerRef, () => setIsOpen(false), isOpen);
 */
export function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  enabled = true
): void {
  useEffect(() => {
    if (!enabled) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [ref, onClose, enabled]);
}
