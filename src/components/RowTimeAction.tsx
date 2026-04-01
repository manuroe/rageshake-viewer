import { useRef, useState } from 'react';
import { useURLParams } from '../hooks/useURLParams';
import { useLogStore } from '../stores/logStore';
import { isFullISODatetime, microsToISO } from '../utils/timeUtils';
import { useClickOutside } from '../hooks/useClickOutside';
import type { TimestampMicros } from '../types/time.types';
import styles from './RowTimeAction.module.css';

export interface RowTimeActionProps {
  /** Microsecond timestamp of the request's send time (used as the boundary value). */
  readonly timestampUs: TimestampMicros | null | undefined;
  /**
   * Called whenever the action menu opens or closes.
   * Parents use this to elevate their row's z-index so the menu is never
   * painted over by subsequent sibling rows in the same stacking context.
   */
  readonly onOpenChange?: (open: boolean) => void;
}

/**
 * Per-row time-range action button for the request table.
 * Renders a compact clock icon button that, when activated, shows a small menu
 * with two actions: "Set window start here" and "Set window end here".
 *
 * The button is visually suppressed until the row is hovered or focused so the
 * table stays dense and readable at a glance. CSS-controlled visibility lets the
 * parent table use a `.row-hovered` class to reveal the button without React
 * re-renders on every mouse move.
 *
 * Both actions update the global time filter via URL params
 * (`useURLParams().setTimeFilter`), which App.tsx syncs back to the store.
 * When the new boundary would cross the existing opposite boundary the opposite
 * boundary is cleared (set to null) so the resulting range is always valid.
 */
export function RowTimeAction({ timestampUs, onOpenChange }: RowTimeActionProps) {
  const [isOpen, setIsOpen] = useState(false);

  /** Wrapper that keeps isOpen and the parent callback in sync. */
  const setMenuOpen = (open: boolean) => {
    setIsOpen(open);
    onOpenChange?.(open);
  };
  const containerRef = useRef<HTMLDivElement>(null);
  const { setTimeFilter } = useURLParams();
  const startTime = useLogStore((state) => state.startTime);
  const endTime = useLogStore((state) => state.endTime);

  useClickOutside(containerRef, () => setMenuOpen(false), isOpen);

  if (timestampUs === null || timestampUs === undefined) {
    return null;
  }

  const iso = microsToISO(timestampUs);

  /** Set the window start to this row's timestamp, clearing end if it would precede it. */
  const handleSetStart = () => {
    const newEnd = endTime && isFullISODatetime(endTime)
      ? (endTime > iso ? endTime : null)
      : endTime;
    setTimeFilter(iso, newEnd);
    setMenuOpen(false);
  };

  /** Set the window end to this row's timestamp, clearing start if it would follow it. */
  const handleSetEnd = () => {
    const newStart = startTime && isFullISODatetime(startTime)
      ? (startTime < iso ? startTime : null)
      : startTime;
    setTimeFilter(newStart, iso);
    setMenuOpen(false);
  };

  const handleButtonClick = (e: React.MouseEvent) => {
    // Prevent the row-level click handlers (log viewer toggle, waterfall scroll)
    e.stopPropagation();
    setMenuOpen(!isOpen);
  };

  return (
    <div
      ref={containerRef}
      className={styles.container}
      // Stop row-level mouse events from the container itself (e.g. onMouseEnter
      // row highlighting is fine; only click propagation needs blocking).
    >
      <button
        className={styles.trigger}
        onClick={handleButtonClick}
        aria-label="Row actions"
        aria-expanded={isOpen}
        tabIndex={-1}
      >
        {/* ≡ conveys an expandable action list; ⏱ was time-specific */}
        ≡
      </button>

      {isOpen && (
        <div
          className={styles.menu}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className={styles.menuItem}
            onClick={handleSetStart}
          >
            Set window <strong>start</strong> here
          </button>
          <button
            className={styles.menuItem}
            onClick={handleSetEnd}
          >
            Set window <strong>end</strong> here
          </button>
        </div>
      )}
    </div>
  );
}
