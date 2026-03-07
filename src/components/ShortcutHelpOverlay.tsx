import { useCallback } from 'react';
import { createPortal } from 'react-dom';
import { SHORTCUTS, SHORTCUT_CATEGORIES, metaKey, type ShortcutCategory } from '../utils/shortcuts';
import { useKeyboardShortcutContext } from './KeyboardShortcutContext';
import styles from './ShortcutHelpOverlay.module.css';

// ---------------------------------------------------------------------------
// Key label rendering helpers
// ---------------------------------------------------------------------------

interface KeyToken {
  type: 'key' | 'separator';
  value: string;
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

export function ShortcutHelpOverlay() {
  const { showHelp, toggleHelp } = useKeyboardShortcutContext();

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
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
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div className={styles.panel}>
        <div className={styles.header}>
          <h2 className={styles.title}>Keyboard Shortcuts</h2>
          <button className={styles.closeButton} onClick={toggleHelp} aria-label="Close">
            ✕
          </button>
        </div>

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
