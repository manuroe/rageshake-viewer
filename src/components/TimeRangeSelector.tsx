import { useState, useRef, useEffect, useCallback } from 'react';
import { useLogStore } from '../stores/logStore';
import { useURLParams } from '../hooks/useURLParams';
import { getTimeDisplayName, parseTimeInput } from '../utils/timeUtils';
import { ValidationError } from '../utils/errorHandling';
import { useClickOutside } from '../hooks/useClickOutside';
import ErrorDisplay from './ErrorDisplay';
import styles from './TimeRangeSelector.module.css';

const SHORTCUTS = [
  { value: 'last-min', label: 'Last min' },
  { value: 'last-5-min', label: 'Last 5 min' },
  { value: 'last-10-min', label: 'Last 10 min' },
  { value: 'last-hour', label: 'Last hour' },
  { value: 'last-day', label: 'Last day' },
];

export function TimeRangeSelector() {
  const { startTime, endTime } = useLogStore();
  const { setTimeFilter } = useURLParams();
  const [isOpen, setIsOpen] = useState(false);
  const [showCustom, setShowCustom] = useState(false);
  const [customStart, setCustomStart] = useState(startTime || '');
  const [customEnd, setCustomEnd] = useState(endTime || '');
  const [error, setError] = useState<ValidationError | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync custom inputs when store values change (but not while the user is editing them)
  useEffect(() => {
    if (!showCustom) {
      setCustomStart(startTime || '');
      setCustomEnd(endTime || '');
    }
  }, [startTime, endTime, showCustom]);

  const handleDropdownClose = useCallback(() => {
    setIsOpen(false);
    setShowCustom(false);
    setError(null);
  }, []);

  useClickOutside(dropdownRef, handleDropdownClose, isOpen);

  const handleShortcut = (shortcut: string) => {
    setTimeFilter(shortcut, 'end');
    setIsOpen(false);
    setShowCustom(false);
    setError(null);
  };

  const handleClear = () => {
    setTimeFilter(null, null);
    setCustomStart('');
    setCustomEnd('');
    setIsOpen(false);
    setShowCustom(false);
    setError(null);
  };

  const handleCustomApply = () => {
    const start = customStart.trim();
    const end = customEnd.trim();

    if (!start && !end) {
      setError(new ValidationError('Please enter at least a start or end time'));
      return;
    }

    const validStart = !start || parseTimeInput(start);
    const validEnd = !end || parseTimeInput(end);

    if (!validStart) {
      setError(new ValidationError(`Invalid start time: "${start}"`));
      return;
    }

    if (!validEnd) {
      setError(new ValidationError(`Invalid end time: "${end}"`));
      return;
    }

    setTimeFilter(
      typeof validStart === 'string' ? validStart : null,
      typeof validEnd === 'string' ? validEnd : null
    );
    setIsOpen(false);
    setShowCustom(false);
    setError(null);
  };

  const getDisplayText = () => {
    if (!startTime && !endTime) {
      return 'All time';
    }
    const startName = startTime ? getTimeDisplayName(startTime) : 'Start';
    const endName = endTime ? getTimeDisplayName(endTime) : 'End';
    
    // Shorten display for common patterns
    if (startTime && startTime.startsWith('last-') && endTime === 'end') {
      return getTimeDisplayName(startTime);
    }
    
    return `${startName} to ${endName}`;
  };

  return (
    <div className={styles.timeRangeSelector} ref={dropdownRef}>
      <button
        className={styles.timeRangeButton}
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Select time range"
        aria-expanded={isOpen}
      >
        <span className={styles.timeRangeIcon}>⏱</span>
        <span className={styles.timeRangeText}>{getDisplayText()}</span>
      </button>

      {isOpen && (
        <div className={styles.timeRangeDropdown}>
          <div className={styles.timeRangeShortcuts}>
            {SHORTCUTS.map((shortcut) => (
              <button
                key={shortcut.value}
                className={`${styles.timeRangeItem} ${startTime === shortcut.value ? styles.active : ''}`}
                onClick={() => handleShortcut(shortcut.value)}
              >
                {shortcut.label}
              </button>
            ))}
          </div>

          <div className={styles.timeRangeDivider} />

          {!showCustom ? (
            <>
              <button
                className={styles.timeRangeItem}
                onClick={() => setShowCustom(true)}
              >
                Custom range...
              </button>
              {(startTime || endTime) && (
                <button
                  className={`${styles.timeRangeItem} ${styles.timeRangeClear}`}
                  onClick={handleClear}
                >
                  Clear filter
                </button>
              )}
            </>
          ) : (
            <div className={styles.timeRangeCustom}>
              <div className={styles.customInputGroup}>
                <label htmlFor="time-range-from">From:</label>
                <input
                  id="time-range-from"
                  type="text"
                  placeholder="start, last-5-min, 1970-01-01T12:34:56.123456Z"
                  value={customStart}
                  onChange={(e) => {
                    setCustomStart(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCustomApply();
                  }}
                  autoFocus
                />
              </div>
              <div className={styles.customInputGroup}>
                <label htmlFor="time-range-to">To:</label>
                <input
                  id="time-range-to"
                  type="text"
                  placeholder="end, 1970-01-01T12:34:56.123456Z"
                  value={customEnd}
                  onChange={(e) => {
                    setCustomEnd(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCustomApply();
                  }}
                />
              </div>
              <ErrorDisplay error={error} onDismiss={() => setError(null)} />
              <div className={styles.customActions}>
                <button className="btn-secondary btn-sm" onClick={() => setShowCustom(false)}>
                  Cancel
                </button>
                <button className="btn-primary btn-sm" onClick={handleCustomApply}>
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
