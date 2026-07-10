import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { AnonymizationDictionary } from '../types/log.types';
import { buildAnonymizationDictionary } from '../utils/anonymizeUtils';
import { useLogStore } from '../stores/logStore';
import { useAnonSaltStore } from '../stores/anonSaltStore';
import { SearchInput, type SearchInputHandle } from './SearchInput';
import { ProgressBar } from './ProgressBar';
import { useKeyboardShortcutContextOptional } from './KeyboardShortcutContext';
import styles from './LogExportDialog.module.css';

interface AnonMappingDialogProps {
  /** The applied mapping, or null when nothing is anonymised yet (a preview is
   *  built instead). */
  readonly dict: AnonymizationDictionary | null;
  /** Optional preview builder used when `dict` is null. Defaults to previewing
   *  the currently loaded log; the archive/listing screens pass one that builds
   *  the mapping from their files. Receives a progress reporter it may call. */
  readonly buildPreview?: (
    onProgress: (phase: string, current: number, total: number) => void,
  ) => Promise<AnonymizationDictionary>;
  /** Called when the dialog should be closed. */
  readonly onClose: () => void;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Modal listing the anonymisation mapping (original → alias).
 *
 * When `dict` is provided it shows the applied in-session mapping. When it is
 * null (not anonymised yet) it builds and shows a *preview* of what anonymising
 * the current logs with the current salt would produce. The search box matches
 * either column, case-insensitively.
 */
export function AnonMappingDialog({ dict, buildPreview, onClose }: AnonMappingDialogProps) {
  const [query, setQuery] = useState('');

  const panelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<SearchInputHandle>(null);

  // When no mapping is applied yet, preview what anonymising now would produce.
  const isPreview = dict === null;
  const rawLogLines = useLogStore((s) => s.rawLogLines);
  const salt = useAnonSaltStore((s) => s.salt);
  const [preview, setPreview] = useState<AnonymizationDictionary | null>(null);
  const [building, setBuilding] = useState(isPreview);
  const [buildError, setBuildError] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; current: number; total: number } | null>(null);

  useEffect(() => {
    if (!isPreview) return;
    let cancelled = false;
    // Reset per-run so a re-build (salt/logs change) never shows a stale error or
    // stale rows from a previous attempt.
    setBuilding(true);
    setBuildError(false);
    setPreview(null);
    const report = (phase: string, current: number, total: number) => {
      if (!cancelled) setProgress({ phase, current, total });
    };
    const build = buildPreview
      ? buildPreview(report)
      : buildAnonymizationDictionary(rawLogLines, salt);
    build
      .then((d) => { if (!cancelled) setPreview(d); })
      .catch(() => { if (!cancelled) setBuildError(true); })
      .finally(() => { if (!cancelled) setBuilding(false); });
    return () => { cancelled = true; };
    // buildPreview is a fresh closure each render; the dialog is mounted per-open
    // so capturing the mount-time value is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreview, rawLogLines, salt]);

  const effectiveDict = dict ?? preview;

  // ponytail: a plain overflow list handles the realistic tens–hundreds (even
  // low-thousands) of entries fine. If a dict ever grows large enough to lag,
  // swap this list for @tanstack/react-virtual following RequestTable.tsx.
  const entries = useMemo(
    () => Object.entries(effectiveDict?.forward ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    [effectiveDict],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      ([orig, alias]) => orig.toLowerCase().includes(q) || alias.toLowerCase().includes(q),
    );
  }, [entries, query]);

  const shortcutCtx = useKeyboardShortcutContextOptional();
  useEffect(() => {
    if (!shortcutCtx) return;
    return shortcutCtx.registerDismiss(onClose);
  }, [shortcutCtx, onClose]);

  // Focus the search box on open; restore focus on close.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    searchRef.current?.focus();
    return () => prev?.focus();
  }, []);

  // Focus trap + local Escape fallback (Escape also clears the search box first
  // via SearchInput, so only close when the box is already empty).
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

  const total = entries.length;
  const countLabel = query.trim()
    ? `Showing ${filtered.length} of ${total}`
    : `${total} ${total === 1 ? 'entry' : 'entries'}`;

  return createPortal(
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div
        ref={panelRef}
        className={styles.panel}
        style={{ width: 'min(640px, calc(100vw - 32px))' }}
        role="dialog"
        aria-modal="true"
        aria-label="Anonymisation mapping"
      >
        <div className={styles.header}>
          <h2 className={styles.title}>Anonymisation mapping</h2>
          <button
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Close anonymisation mapping dialog"
            title="Close"
          >
            ×
          </button>
        </div>

        {isPreview && (
          <p className={styles.mappingCount}>
            Preview — what anonymising these logs would produce (not yet applied).
          </p>
        )}

        {building ? (
          <ProgressBar
            phase={progress?.phase ?? 'Building preview'}
            current={progress?.current ?? 0}
            total={progress?.total ?? 0}
          />
        ) : buildError ? (
          <div className={styles.mappingEmpty} role="alert">Could not build the mapping.</div>
        ) : total === 0 ? (
          <div className={styles.mappingEmpty}>No Matrix identifiers found in these logs.</div>
        ) : (
          <>
            <SearchInput
              ref={searchRef}
              value={query}
              onChange={setQuery}
              placeholder="Filter by identifier or alias…"
              expandOnFocus={false}
              aria-label="Filter mapping"
            />

            <p className={styles.mappingCount}>{countLabel}</p>

            <div className={styles.mappingList}>
              {filtered.length === 0 ? (
                <div className={styles.mappingEmpty}>No matching entries</div>
              ) : (
                filtered.map(([orig, alias]) => (
                  <div key={orig} className={styles.mappingRow}>
                    <span className={styles.mappingCell}>{orig}</span>
                    <span className={styles.mappingArrow} aria-hidden="true">→</span>
                    <span className={`${styles.mappingCell} ${styles.mappingAlias}`}>{alias}</span>
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
