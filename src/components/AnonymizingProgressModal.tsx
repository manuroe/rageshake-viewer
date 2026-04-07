import { createPortal } from 'react-dom';
import { useLogStore } from '../stores/logStore';
import styles from './LogExportDialog.module.css';

/**
 * Full-screen progress modal that appears while an async anonymization pass
 * is running on a large log file. Only renders when `isAnonymizing` is true
 * in the store — no props required.
 *
 * The Cancel button calls `cancelAnonymization()` which aborts the running
 * chunk loop and resets all in-progress state.
 */
export function AnonymizingProgressModal() {
  const { rawLogLines, isAnonymizing, anonymizingProgress, cancelAnonymization } = useLogStore();

  if (!isAnonymizing) return null;

  const total = rawLogLines.length;
  const done = Math.round(anonymizingProgress * total);
  const pct = Math.round(anonymizingProgress * 100);

  return createPortal(
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Anonymising logs">
      <div className={styles.panel}>
        <div className={styles.header}>
          <h2 className={styles.title}>Anonymising logs…</h2>
        </div>
        <div
          className={styles.progressBar}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`${pct}% complete`}
        >
          <div className={styles.progressFill} style={{ width: `${pct}%` }} />
        </div>
        <p className={styles.progressSubtext}>
          {done.toLocaleString()} / {total.toLocaleString()} lines
        </p>
        <div className={styles.actionRow}>
          <button className={styles.actionButton} onClick={cancelAnonymization}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
