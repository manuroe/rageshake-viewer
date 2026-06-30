import styles from './ProcessLegend.module.css';

/**
 * Maps each merged process (log stream) to its colour swatch. Shown above the
 * logs and request views when several processes (console, nse, …) are merged,
 * so the per-row colour stripes can be decoded.
 */
export function ProcessLegend({ colorMap }: { readonly colorMap: ReadonlyMap<string, string> }) {
  return (
    <div className={styles.legend} role="img" aria-label="Process colour legend">
      {[...colorMap].map(([process, color]) => (
        <span key={process} className={styles.item}>
          <span className={styles.swatch} style={{ background: color }} aria-hidden="true" />
          {process}
        </span>
      ))}
    </div>
  );
}
