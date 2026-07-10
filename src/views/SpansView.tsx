import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogStore } from '../stores/logStore';
import { BurgerMenu } from '../components/BurgerMenu';
import { TimeRangeSelector } from '../components/TimeRangeSelector';
import { SearchInput } from '../components/SearchInput';
import { LogDisplayView } from './LogDisplayView';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { calculateTimeRangeMicros, getMinMaxTimestamps } from '../utils/timeUtils';
import { buildSpanOverview, type SpanNode, type SpanLeaf, type SpanFieldSummary } from '../utils/spanOverview';
import type { ParsedLogLine, LogLevel } from '../types/log.types';
import styles from './SpansView.module.css';

// Toggleable levels. UNKNOWN is intentionally omitted so lines that failed
// level detection are never hidden by the level filter.
const TOGGLEABLE_LEVELS: LogLevel[] = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR'];

// Raw lines shown around a drilled-into occurrence.
const DRILLDOWN_CONTEXT = 30;

// Drilldown panel sizing (px): initial height, drag clamps, keyboard step.
const DEFAULT_PANEL_HEIGHT = 350;
const MIN_PANEL_HEIGHT = 120;
const MIN_TREE_HEIGHT = 160;
const PANEL_RESIZE_STEP = 24;

/**
 * Max drilldown-panel height that still leaves MIN_TREE_HEIGHT for the tree.
 * The tree and panel share one flex area, so `treeHeight + currentPanelHeight`
 * is that area's height regardless of the current split — basing the max on it
 * (rather than the full viewport) means the header/toolbar are already
 * accounted for and the panel can't shrink the tree below its floor. Falls
 * back to the viewport before the tree is laid out (first paint / jsdom).
 */
function maxPanelHeight(treeEl: HTMLElement | null, currentPanelHeight: number): number {
  const treeHeight = treeEl?.clientHeight ?? 0;
  const flexArea = treeHeight > 0 ? treeHeight + currentPanelHeight : window.innerHeight;
  // Never below MIN_PANEL_HEIGHT: on a very short viewport a smaller (or negative)
  // ceiling would make the separator's aria-valuemax drop under aria-valuemin.
  return Math.max(MIN_PANEL_HEIGHT, flexArea - MIN_TREE_HEIGHT);
}

/** Clamp a proposed panel height to the draggable/resizable range. */
function clampPanelHeight(height: number, maxHeight: number): number {
  // maxHeight wins on a very short viewport (maxHeight < MIN_PANEL_HEIGHT), so
  // the panel never grows past the space the tree can spare.
  return Math.min(maxHeight, Math.max(MIN_PANEL_HEIGHT, height));
}

function levelClass(level: LogLevel): string {
  const map: Partial<Record<LogLevel, string>> = {
    TRACE: styles.levelTrace,
    DEBUG: styles.levelDebug,
    INFO: styles.levelInfo,
    WARN: styles.levelWarn,
    ERROR: styles.levelError,
  };
  return map[level] ?? styles.levelUnknown;
}

function CountBadges({ errorCount, warnCount }: { errorCount: number; warnCount: number }) {
  return (
    <>
      {errorCount > 0 && <span className={styles.errorBadge}>{errorCount}</span>}
      {warnCount > 0 && <span className={styles.warnBadge}>{warnCount}</span>}
    </>
  );
}

/** Compact `{k=v|v… …}` summary of the field values recorded at a span node. */
function FieldSummary({ fields }: { fields: readonly SpanFieldSummary[] }) {
  if (fields.length === 0) return null;
  const text = fields
    .map((f) => `${f.key}=${f.values.join('|')}${f.truncated ? '|…' : ''}`)
    .join(' ');
  return <span className={styles.fields}>{`{${text}}`}</span>;
}

function Occurrence({ line, onSelect }: { line: ParsedLogLine; onSelect: (l: ParsedLogLine) => void }) {
  return (
    <button
      type="button"
      className={`${styles.occurrence} ${levelClass(line.level)}`}
      onClick={() => onSelect(line)}
    >
      <span className={styles.occLineNumber}>{line.lineNumber}</span>
      <span className={styles.occTime}>{line.displayTime}</span>
      <span className={styles.occLevel}>{line.level}</span>
      {/* strippedMessage (not message) — message is the full raw line, so it
          would repeat the timestamp/level already shown in the columns. */}
      <span className={styles.rowText}>{line.strippedMessage}</span>
    </button>
  );
}

function Leaf({ leaf, onSelect }: { leaf: SpanLeaf; onSelect: (l: ParsedLogLine) => void }) {
  // Collapsed <details> still render their children into the DOM, so eagerly
  // rendering every occurrence would build the whole log's worth of nodes up
  // front. Only render occurrences once the leaf is actually opened.
  const [open, setOpen] = useState(false);
  return (
    <details className={styles.leaf} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className={styles.leafSummary}>
        {/* location is the full file path (unique key); show only the basename. */}
        <span className={styles.location}>{leaf.location.slice(leaf.location.lastIndexOf('/') + 1)}</span>
        <span className={styles.occCount}>{leaf.occurrences.length}</span>
        <CountBadges errorCount={leaf.errorCount} warnCount={leaf.warnCount} />
      </summary>
      {open && (
        <div className={styles.occurrences}>
          {leaf.occurrences.map((line) => (
            <Occurrence key={line.lineNumber} line={line} onSelect={onSelect} />
          ))}
        </div>
      )}
    </details>
  );
}

function TreeNode({ node, onSelect }: { node: SpanNode; onSelect: (l: ParsedLogLine) => void }) {
  // Lazily mount the subtree so a collapsed node costs one <summary>, not its
  // whole descendant tree (see the note in Leaf).
  const [open, setOpen] = useState(false);
  return (
    <details className={styles.node} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className={styles.nodeSummary}>
        <span className={styles.segment}>{node.name}</span>
        <FieldSummary fields={node.fields} />
        <CountBadges errorCount={node.errorCount} warnCount={node.warnCount} />
      </summary>
      {open && (
        <div className={styles.nodeChildren}>
          {node.children.map((child) => (
            <TreeNode key={child.path} node={child} onSelect={onSelect} />
          ))}
          {node.leaves.map((leaf) => (
            <Leaf key={leaf.location} leaf={leaf} onSelect={onSelect} />
          ))}
        </div>
      )}
    </details>
  );
}

export function SpansView() {
  const { rawLogLines, startTime, endTime } = useLogStore();
  const navigate = useNavigate();
  // Triage-first: start with only the actionable levels; the reader re-adds
  // TRACE/DEBUG/INFO from the toolbar when they want the full picture.
  const [enabledLevels, setEnabledLevels] = useState<Set<LogLevel>>(() => new Set<LogLevel>(['WARN', 'ERROR']));
  const [textFilter, setTextFilter] = useState('');
  const debouncedText = useDebouncedValue(textFilter, 300);
  const [selected, setSelected] = useState<ParsedLogLine | null>(null);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT);
  const treeRef = useRef<HTMLDivElement>(null);
  // Teardown for an in-progress drag, so an unmount mid-drag can stop it.
  const dragStopRef = useRef<(() => void) | null>(null);
  useEffect(() => () => dragStopRef.current?.(), []);

  // Layout-derived resize ceiling, mirrored into state for the separator's
  // aria-valuemax (refs can't be read during render). The handlers read the
  // ref directly for the live clamp.
  const [ariaMaxHeight, setAriaMaxHeight] = useState(() => Math.max(MIN_PANEL_HEIGHT, window.innerHeight - MIN_TREE_HEIGHT));
  useEffect(() => {
    if (selected) setAriaMaxHeight(maxPanelHeight(treeRef.current, panelHeight));
  }, [selected, panelHeight]);

  // A shorter window can push the fixed panel height past its ceiling (tree
  // squeezed below its floor); re-clamp on resize while the panel is open.
  useEffect(() => {
    if (!selected) return;
    const onResize = () =>
      setPanelHeight((h) => clampPanelHeight(h, maxPanelHeight(treeRef.current, h)));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [selected]);

  // Drag the divider between the tree and the drilldown panel to resize.
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = panelHeight;
    const maxHeight = maxPanelHeight(treeRef.current, startHeight);
    const prevUserSelect = document.body.style.userSelect;
    const onMove = (ev: MouseEvent) => {
      setPanelHeight(clampPanelHeight(startHeight + (startY - ev.clientY), maxHeight)); // drag up → taller
    };
    // Listen on window and also stop on blur, so a mouseup outside the page
    // (or the window losing focus mid-drag) still tears the drag down.
    const stop = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('blur', stop);
      document.body.style.userSelect = prevUserSelect; // restore prior value, not ''
      dragStopRef.current = null;
    };
    dragStopRef.current = stop;
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stop);
    window.addEventListener('blur', stop);
  }, [panelHeight]);

  // Keyboard resize for the separator (Arrow Up/Down grow/shrink the panel).
  const onResizeKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    setPanelHeight((h) => {
      const step = e.key === 'ArrowUp' ? PANEL_RESIZE_STEP : -PANEL_RESIZE_STEP;
      return clampPanelHeight(h + step, maxPanelHeight(treeRef.current, h));
    });
  }, []);

  const openInLogsView = useCallback((line: ParsedLogLine) => {
    const params = new URLSearchParams();
    params.set('line', String(line.lineNumber));
    if (startTime) params.set('start', startTime);
    if (endTime) params.set('end', endTime);
    void navigate(`/logs?${params.toString()}`);
  }, [navigate, startTime, endTime]);

  const filteredLines = useMemo(() => {
    if (rawLogLines.length === 0) return [];

    const { min, max } = getMinMaxTimestamps(rawLogLines);
    const { startUs, endUs } = calculateTimeRangeMicros(startTime, endTime, min, max);
    const needle = debouncedText.trim().toLowerCase();

    return rawLogLines.filter((line) => {
      // timestampUs <= 0 marks un-timestamped lines (e.g. orphan continuation
      // UNKNOWN entries); don't let the time window hide them — the level
      // filter deliberately always keeps UNKNOWN.
      if (line.timestampUs > 0 && (line.timestampUs < startUs || line.timestampUs > endUs)) return false;
      if (TOGGLEABLE_LEVELS.includes(line.level) && !enabledLevels.has(line.level)) return false;
      if (needle && !line.rawText.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rawLogLines, startTime, endTime, enabledLevels, debouncedText]);

  const overview = useMemo(() => buildSpanOverview(filteredLines), [filteredLines]);

  const toggleLevel = (level: LogLevel) => {
    setEnabledLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  // The root only holds children (every line attaches under >=1 span name,
  // "(no span)" included, so lines never sit directly on the root).
  const hasContent = overview.children.length > 0;

  return (
    <div className="app">
      <div className="header-compact">
        <div className="header-left">
          <BurgerMenu />
          <h1 className="header-title">Logs by span</h1>
        </div>
        <div className="header-center">
          <div className="stats-compact">
            <span id="shown-count">{filteredLines.length}</span> / <span id="total-count">{rawLogLines.length}</span>
          </div>
        </div>
        <div className="header-right">
          <TimeRangeSelector />
        </div>
      </div>

      <div className={styles.overview}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarLeft}>
            <SearchInput
              value={textFilter}
              onChange={setTextFilter}
              onClear={() => setTextFilter('')}
              placeholder="Filter by span or text..."
              aria-label="Filter spans by name or text"
            />
          </div>
          <div className={styles.toolbarRight}>
            {TOGGLEABLE_LEVELS.map((level) => (
              <label key={level} className={styles.levelToggle} title={`Toggle ${level} lines`}>
                <input
                  type="checkbox"
                  checked={enabledLevels.has(level)}
                  onChange={() => toggleLevel(level)}
                />
                {level}
              </label>
            ))}
          </div>
        </div>

        <div className={styles.tree} ref={treeRef}>
          {hasContent ? (
            overview.children.map((child) => (
              <TreeNode key={child.path} node={child} onSelect={setSelected} />
            ))
          ) : (
            <div className={styles.empty}>No log lines match the current filters.</div>
          )}
        </div>

        {selected && (
          <>
            <div
              className={styles.resizer}
              onMouseDown={startResize}
              onKeyDown={onResizeKeyDown}
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize log panel"
              aria-valuenow={Math.round(panelHeight)}
              aria-valuemin={MIN_PANEL_HEIGHT}
              aria-valuemax={Math.round(ariaMaxHeight)}
              tabIndex={0}
            />
            <div className={styles.bottomPanel} style={{ height: panelHeight }}>
              <LogDisplayView
                key={selected.lineNumber}
                logLines={rawLogLines}
                lineRange={{ start: selected.lineNumber - DRILLDOWN_CONTEXT, end: selected.lineNumber + DRILLDOWN_CONTEXT }}
                highlightLineNumber={selected.lineNumber}
                defaultLineWrap
                onExpand={() => openInLogsView(selected)}
                onClose={() => setSelected(null)}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
