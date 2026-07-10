import styles from './LogExportDialog.module.css';

interface ProgressBarProps {
  /** What is happening, e.g. "Fetching files" or "Anonymising files". */
  readonly phase: string;
  /** Completed units (only meaningful when `total > 0`). */
  readonly current: number;
  /** Total units, or 0 for an indeterminate (no-bar) phase. */
  readonly total: number;
}

/**
 * Determinate progress bar with a subtext line, or an indeterminate label when
 * `total === 0`. Presentational only — shared by the save and preview flows.
 */
export function ProgressBar({ phase, current, total }: ProgressBarProps) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  return (
    <>
      {total > 0 && (
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
      )}
      <p className={styles.progressSubtext}>{total > 0 ? `${phase} ${current}/${total}` : `${phase}…`}</p>
    </>
  );
}
