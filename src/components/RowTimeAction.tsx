import { useRef, useState } from 'react';
import { useURLParams } from '../hooks/useURLParams';
import { useLogStore } from '../stores/logStore';
import { microsToISO } from '../utils/timeUtils';
import { useClickOutside } from '../hooks/useClickOutside';
import type { TimestampMicros } from '../types/time.types';
import styles from './RowTimeAction.module.css';

export interface RowTimeActionProps {
  /** Microsecond timestamp of the request's send time (used as the boundary value). */
  timestampUs: TimestampMicros;
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
export function RowTimeAction({ timestampUs }: RowTimeActionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { setTimeFilter } = useURLParams();
  const { startTime, endTime } = useLogStore();

  useClickOutside(containerRef, () => setIsOpen(false), isOpen);

  const iso = microsToISO(timestampUs);

  /** Set the window start to this row's timestamp, clearing end if it would precede it. */
  const handleSetStart = () => {
    // If there is an existing end boundary, resolve it to compare against the
    // new start.  We do a simple lexicographic comparison on ISO strings which
    // works because both are full UTC ISO-8601 values.
    const newEnd = endTime && endTime > iso ? endTime : null;
    setTimeFilter(iso, newEnd);
    setIsOpen(false);
  };

  /** Set the window end to this row's timestamp, clearing start if it would follow it. */
  const handleSetEnd = () => {
    const newStart = startTime && startTime < iso ? startTime : null;
    setTimeFilter(newStart, iso);
    setIsOpen(false);
  };

  const handleButtonClick = (e: React.MouseEvent) => {
    // Prevent the row-level click handlers (log viewer toggle, waterfall scroll)
    e.stopPropagation();
    setIsOpen((prev) => !prev);
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
        aria-haspopup="menu"
        aria-expanded={isOpen}
        tabIndex={0}
      >
        {/* ≡ conveys an expandable action list; ⏱ was time-specific */}
        ≡
      </button>

      {isOpen && (
        <div
          className={styles.menu}
          role="menu"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className={styles.menuItem}
            role="menuitem"
            onClick={handleSetStart}
          >
            Set window <strong>start</strong> here
          </button>
          <button
            className={styles.menuItem}
            role="menuitem"
            onClick={handleSetEnd}
          >
            Set window <strong>end</strong> here
          </button>
        </div>
      )}
    </div>
  );
}
