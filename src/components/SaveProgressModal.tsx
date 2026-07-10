import { createPortal } from 'react-dom';
import { ProgressBar } from './ProgressBar';
import styles from './LogExportDialog.module.css';

interface SaveProgressModalProps {
  /** What is happening right now, e.g. "Fetching files". */
  readonly phase: string;
  /** Completed units (only meaningful when `total > 0`). */
  readonly current: number;
  /** Total units, or 0 for an indeterminate (no-bar) phase. */
  readonly total: number;
  /** When set, the save failed with this message; a Close button is shown. */
  readonly error?: string | null;
  /** Called to dismiss the modal after an error. */
  readonly onDismiss?: () => void;
}

/**
 * Full-screen overlay shown while a "Save anonymised" export runs, or with an
 * error message + Close button when it fails. Driven by caller state.
 */
export function SaveProgressModal({ phase, current, total, error, onDismiss }: SaveProgressModalProps) {
  return createPortal(
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Saving anonymised">
      <div className={styles.panel}>
        <div className={styles.header}>
          <h2 className={styles.title}>{error ? 'Save failed' : 'Saving anonymised…'}</h2>
        </div>
        {error ? (
          <>
            <p className={styles.progressSubtext} role="alert">{error}</p>
            <div className={styles.actionRow}>
              <button className={styles.actionButton} onClick={onDismiss}>Close</button>
            </div>
          </>
        ) : (
          <ProgressBar phase={phase} current={current} total={total} />
        )}
      </div>
    </div>,
    document.body,
  );
}
