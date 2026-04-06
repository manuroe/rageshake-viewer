import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { SHORTCUTS, SHORTCUT_CATEGORIES, metaKey, optionKey, type ShortcutCategory } from '../utils/shortcuts';
import { useKeyboardShortcutContext } from './KeyboardShortcutContext';
import styles from './ShortcutHelpOverlay.module.css';

// ---------------------------------------------------------------------------
// Key label rendering helpers
// ---------------------------------------------------------------------------

interface KeyToken {
  type: 'key' | 'separator';
  value: string;
}

interface ColorLegendItem {
  label: string;
  color: string;
}

/**
 * Parse a shortcut label string into renderable tokens.
 *
 * Examples:
 *   "g → s"         → [{key,"g"}, {separator,"→"}, {key,"s"}]
 *   "Cmd+/"         → [{key,"⌘"}, {key,"/"}]
 *   "Cmd+Shift+N"   → [{key,"⌘"}, {key,"⇧"}, {key,"N"}]
 *   "Escape"        → [{key,"Esc"}]
 */
function parseLabel(label: string): KeyToken[] {
  // Replace Meta modifier with platform symbol
  const normalized = label
    .replace('Cmd', metaKey)
    .replace('Option', optionKey)
    .replace('Shift', '⇧')
    .replace('Escape', 'Esc');

  // Chord sequences separated by " → "
  if (normalized.includes(' → ')) {
    const [first, second] = normalized.split(' → ');
    return [
      { type: 'key', value: first },
      { type: 'separator', value: '→' },
      { type: 'key', value: second },
    ];
  }

  // Modifier combos separated by "+"
  const parts = normalized.split('+').filter(Boolean);
  return parts.map((p) => ({ type: 'key' as const, value: p }));
}

function ShortcutKeys({ label }: { label: string }) {
  const tokens = parseLabel(label);
  return (
    <span className={styles.keys}>
      {tokens.map((token, i) => {
        if (token.type === 'separator') {
          return (
            <span key={i} className={styles.keySeparator}>
              {token.value}
            </span>
          );
        }
        return (
          <kbd key={i} className={styles.key}>
            {token.value}
          </kbd>
        );
      })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Help overlay
// ---------------------------------------------------------------------------

const CATEGORY_ORDER: ShortcutCategory[] = [
  'navigation',
  'search',
  'filter',
  'session',
  'theme',
  'ui',
];

const LOG_COLOR_LEGEND: readonly ColorLegendItem[] = [
  { label: 'Trace', color: 'var(--log-level-trace)' },
  { label: 'Debug', color: 'var(--log-level-debug)' },
  { label: 'Info', color: 'var(--log-level-info)' },
  { label: 'Warn', color: 'var(--log-level-warn)' },
  { label: 'Error', color: 'var(--log-level-error)' },
  { label: 'Unknown', color: 'var(--log-level-unknown)' },
  { label: 'Sentry', color: 'var(--color-sentry)' },
];

const HTTP_COLOR_LEGEND: readonly ColorLegendItem[] = [
  { label: '2xx success', color: 'var(--http-2xx)' },
  { label: '3xx redirect', color: 'var(--http-3xx)' },
  { label: '4xx client error', color: 'var(--http-4xx)' },
  { label: '5xx server error', color: 'var(--http-5xx)' },
  { label: 'Client-side failure', color: 'var(--http-client-error)' },
  { label: 'Incomplete', color: 'var(--http-incomplete)' },
];

const SYNC_COLOR_LEGEND: readonly ColorLegendItem[] = [
  { label: '/sync catchup success', color: 'var(--sync-catchup-success)' },
  { label: '/sync long-poll success', color: 'var(--sync-longpoll-success)' },
];

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function ColorLegendSection({ title, items }: { title: string; items: readonly ColorLegendItem[] }) {
  return (
    <section className={styles.section}>
      <div className={styles.categoryTitle}>{title}</div>
      {items.map((item) => (
        <div key={item.label} className={styles.legendRow}>
          <span
            aria-hidden="true"
            className={styles.legendSwatch}
            style={{ backgroundColor: item.color }}
          />
          <div className={styles.legendLabel}>{item.label}</div>
        </div>
      ))}
    </section>
  );
}

export function ShortcutHelpOverlay() {
  const { showHelp, toggleHelp } = useKeyboardShortcutContext();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Focus close button when overlay opens; restore previous focus when it closes
  useEffect(() => {
    if (!showHelp) return;
    const prev = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      prev?.focus();
    };
  }, [showHelp]);

  // Focus trap: cycle Tab/Shift+Tab within the panel
  useEffect(() => {
    if (!showHelp) return;
    const panel = panelRef.current;
    if (!panel) return;
    const handleKey = (e: KeyboardEvent) => {
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
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    panel.addEventListener('keydown', handleKey);
    return () => panel.removeEventListener('keydown', handleKey);
  }, [showHelp]);

  const handleBackdropClick = useCallback(
    (e: MouseEvent) => {
      if (e.target === e.currentTarget) toggleHelp();
    },
    [toggleHelp],
  );

  if (!showHelp) return null;

  // Group shortcuts by category
  const grouped = CATEGORY_ORDER.reduce<Record<ShortcutCategory, typeof SHORTCUTS[keyof typeof SHORTCUTS][]>>(
    (acc, cat) => {
      acc[cat] = Object.values(SHORTCUTS).filter((s) => s.category === cat);
      return acc;
    },
    {} as Record<ShortcutCategory, typeof SHORTCUTS[keyof typeof SHORTCUTS][]>,
  );

  return createPortal(
    <div
      className={styles.backdrop}
      onClick={handleBackdropClick}
    >
      <div
        ref={panelRef}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Help"
      >
        <div className={styles.header}>
          <h2 className={styles.title}>Help</h2>
          <button ref={closeButtonRef} className={styles.closeButton} onClick={toggleHelp} aria-label="Close">
            ✕
          </button>
        </div>

        <div className={styles.columns}>
          <div className={`${styles.column} ${styles.shortcutsPane}`}>
            <div className={styles.paneTitle}>Keyboard shortcuts</div>
            {CATEGORY_ORDER.filter((cat) => grouped[cat].length > 0).map((cat) => (
              <section key={cat} className={styles.section}>
                <div className={styles.categoryTitle}>{SHORTCUT_CATEGORIES[cat]}</div>
                {grouped[cat].map((shortcut) => (
                  <div key={shortcut.label} className={styles.shortcutRow}>
                    <span className={styles.shortcutDescription}>{shortcut.description}</span>
                    <ShortcutKeys label={shortcut.label} />
                  </div>
                ))}
              </section>
            ))}
          </div>

          <div className={`${styles.column} ${styles.colorsPane}`}>
            <div className={styles.paneTitle}>Colors</div>
            <ColorLegendSection title="Log Colors" items={LOG_COLOR_LEGEND} />
            <ColorLegendSection title="HTTP Colors" items={HTTP_COLOR_LEGEND} />
            <ColorLegendSection title="Sync Colors" items={SYNC_COLOR_LEGEND} />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Chord toast indicator
// ---------------------------------------------------------------------------

export function ChordToast() {
  const { pendingChord } = useKeyboardShortcutContext();
  if (!pendingChord) return null;

  return createPortal(
    <div className={styles.chordToast} role="status" aria-live="polite">
      <kbd className={styles.chordKey}>{pendingChord}</kbd>
      <span className={styles.chordHint}>waiting for next key…</span>
    </div>,
    document.body,
  );
}
