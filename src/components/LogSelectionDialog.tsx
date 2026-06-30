import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useLogStore } from '../stores/logStore';
import { useArchiveStore } from '../stores/archiveStore';
import { useListingStore } from '../stores/listingStore';
import { isAnalyzableEntry } from '../utils/archiveSummary';
import { sortEntries, stripEntryPrefix } from '../utils/listingEntries';
import { openMergedEntries } from '../utils/openMergedLogs';
import { useKeyboardShortcutContextOptional } from './KeyboardShortcutContext';
import styles from './LogExportDialog.module.css';

interface LogSelectionDialogProps {
  /** Called when the dialog should be closed. */
  readonly onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal that lets the user re-pick which log files are displayed together.
 *
 * Lists every analyzable log file from the active source (archive or listing),
 * pre-ticking the ones currently merged into the view. Applying re-merges the
 * new selection into one timeline.
 */
export function LogSelectionDialog({ onClose }: LogSelectionDialogProps) {
  const loadedEntryNames = useLogStore((state) => state.loadedEntryNames);
  const archiveEntries = useArchiveStore((state) => state.archiveEntries);
  const listingEntries = useListingStore((state) => state.listingEntries);

  const sourceEntries = archiveEntries.length > 0 ? archiveEntries : listingEntries;
  const logEntries = sortEntries(sourceEntries.filter((e) => isAnalyzableEntry(e.name)));

  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set(loadedEntryNames));
  const [applying, setApplying] = useState(false);
  const navigate = useNavigate();

  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const shortcutCtx = useKeyboardShortcutContextOptional();
  useEffect(() => {
    if (!shortcutCtx) return;
    return shortcutCtx.registerDismiss(onClose);
  }, [shortcutCtx, onClose]);

  // Focus the close button on open; restore focus on close.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => prev?.focus();
  }, []);

  // Focus trap + local Escape fallback.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const hasCentralEsc = !!shortcutCtx;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!hasCentralEsc) onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    panel.addEventListener('keydown', handleKey);
    return () => panel.removeEventListener('keydown', handleKey);
  }, [onClose, shortcutCtx]);

  const handleBackdropClick = useCallback(
    (e: MouseEvent) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const handleApply = () => {
    setApplying(true);
    void openMergedEntries([...selected]).then((route) => {
      setApplying(false);
      if (route) {
        void navigate(route);
        onClose();
      }
    }).catch(() => setApplying(false));
  };

  return createPortal(
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Select logs to display"
      >
        <div className={styles.header}>
          <h2 className={styles.title}>Select logs</h2>
          <button
            ref={closeButtonRef}
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close log selection dialog"
            title="Close"
          >
            ×
          </button>
        </div>

        <div className={styles.optionsSection} style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          {logEntries.map((entry) => (
            <label key={entry.name} className={styles.optionRow}>
              <input
                type="checkbox"
                checked={selected.has(entry.name)}
                onChange={() => toggle(entry.name)}
              />
              <span className={styles.optionLabel}>{stripEntryPrefix(entry.name)}</span>
            </label>
          ))}
        </div>

        <hr className={styles.divider} />

        <div className={styles.actionRow}>
          <button
            className={styles.actionButton}
            onClick={handleApply}
            disabled={selected.size === 0 || applying}
            title="Display the selected logs merged into one timeline"
          >
            {applying ? 'Opening…' : `Display ${selected.size} selected`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
