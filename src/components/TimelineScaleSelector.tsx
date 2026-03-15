import { useRef, useState, useCallback } from 'react';
import { useURLParams } from '../hooks/useURLParams';
import { useClickOutside } from '../hooks/useClickOutside';
import styles from './TimelineScaleSelector.module.css';

// Available timeline scale options (ms per pixel)
const TIMELINE_SCALE_OPTIONS = [
  { value: 5, label: '1px = 5ms' },
  { value: 10, label: '1px = 10ms' },
  { value: 25, label: '1px = 25ms' },
  { value: 50, label: '1px = 50ms' },
  { value: 100, label: '1px = 100ms' },
  { value: 250, label: '1px = 250ms' },
  { value: 500, label: '1px = 500ms' },
  { value: 1000, label: '1px = 1000ms' },
];

interface TimelineScaleSelectorProps {
  /** Current ms per pixel value */
  msPerPixel: number;
}

/**
 * Dropdown for selecting the timeline scale (ms per pixel).
 */
export function TimelineScaleSelector({ msPerPixel }: TimelineScaleSelectorProps) {
  const { setScale } = useURLParams();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useClickOutside(dropdownRef, () => setIsOpen(false), isOpen);

  const handleSelect = useCallback((value: number) => {
    setScale(value);
    setIsOpen(false);
  }, [setScale]);

  const currentOption = TIMELINE_SCALE_OPTIONS.find(opt => opt.value === msPerPixel);
  const buttonLabel = currentOption?.label ?? `1px = ${msPerPixel}ms`;

  return (
    <div className={styles.container} ref={dropdownRef}>
      <button
        className={styles.button}
        onClick={() => setIsOpen(!isOpen)}
        title="Timeline scale"
        aria-expanded={isOpen}
      >
        {buttonLabel}
      </button>
      {isOpen && (
        <div className={styles.dropdown}>
          {TIMELINE_SCALE_OPTIONS.map((option) => (
            <button
              key={option.value}
              className={`${styles.option} ${option.value === msPerPixel ? styles.active : ''}`}
              onClick={() => handleSelect(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
