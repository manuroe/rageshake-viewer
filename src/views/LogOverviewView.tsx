import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogStore } from '../stores/logStore';
import { BurgerMenu } from '../components/BurgerMenu';
import { TimeRangeSelector } from '../components/TimeRangeSelector';
import { SearchInput } from '../components/SearchInput';
import { LogDisplayView } from './LogDisplayView';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { calculateTimeRangeMicros, getMinMaxTimestamps } from '../utils/timeUtils';
import { buildLogOverview, type OverviewNode, type OverviewLeaf } from '../utils/logOverview';
import type { ParsedLogLine, LogLevel } from '../types/log.types';
import styles from './LogOverviewView.module.css';

// Toggleable levels. UNKNOWN is intentionally omitted so lines that failed
// level detection are never hidden by the level filter.
const TOGGLEABLE_LEVELS: LogLevel[] = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR'];

// Raw lines shown around a drilled-into occurrence.
const DRILLDOWN_CONTEXT = 30;

// Drilldown panel sizing (px): initial height and drag clamps.
const DEFAULT_PANEL_HEIGHT = 350;
const MIN_PANEL_HEIGHT = 120;
const MIN_TREE_HEIGHT = 160;

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

function Leaf({ leaf, onSelect }: { leaf: OverviewLeaf; onSelect: (l: ParsedLogLine) => void }) {
  // Collapsed <details> still render their children into the DOM, so eagerly
  // rendering every occurrence would build the whole log's worth of nodes up
  // front. Only render occurrences once the leaf is actually opened.
  const [open, setOpen] = useState(false);
  return (
    <details className={styles.leaf} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className={styles.leafSummary}>
        <span className={styles.location}>{leaf.location}</span>
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

function TreeNode({ node, onSelect }: { node: OverviewNode; onSelect: (l: ParsedLogLine) => void }) {
  // Lazily mount the subtree so a collapsed node costs one <summary>, not its
  // whole descendant tree (see the note in Leaf).
  const [open, setOpen] = useState(false);
  return (
    <details className={styles.node} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className={styles.nodeSummary}>
        <span className={styles.segment}>{node.segment}</span>
        <CountBadges errorCount={node.errorCount} warnCount={node.warnCount} />
      </summary>
      {open && (
        <div className={styles.nodeChildren}>
          {node.children.map((child) => (
            <TreeNode key={child.fullTarget} node={child} onSelect={onSelect} />
          ))}
          {node.leaves.map((leaf) => (
            <Leaf key={leaf.location} leaf={leaf} onSelect={onSelect} />
          ))}
        </div>
      )}
    </details>
  );
}

export function LogOverviewView() {
  const { rawLogLines, startTime, endTime } = useLogStore();
  const navigate = useNavigate();
  // Triage-first: start with only the actionable levels; the reader re-adds
  // TRACE/DEBUG/INFO from the toolbar when they want the full picture.
  const [enabledLevels, setEnabledLevels] = useState<Set<LogLevel>>(() => new Set<LogLevel>(['WARN', 'ERROR']));
  const [textFilter, setTextFilter] = useState('');
  const debouncedText = useDebouncedValue(textFilter, 300);
  const [selected, setSelected] = useState<ParsedLogLine | null>(null);
  const [panelHeight, setPanelHeight] = useState(DEFAULT_PANEL_HEIGHT);

  // Drag the divider between the tree and the drilldown panel to resize.
  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = panelHeight;
    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY; // drag up → taller panel
      const max = window.innerHeight - MIN_TREE_HEIGHT;
      setPanelHeight(Math.max(MIN_PANEL_HEIGHT, Math.min(max, startHeight + delta)));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [panelHeight]);

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

  const overview = useMemo(() => buildLogOverview(filteredLines), [filteredLines]);

  const toggleLevel = (level: LogLevel) => {
    setEnabledLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  // The root only holds children (every target has >=1 segment, so lines
  // always attach to a child node, never directly to the root).
  const hasContent = overview.children.length > 0;

  return (
    <div className="app">
      <div className="header-compact">
        <div className="header-left">
          <BurgerMenu />
          <h1 className="header-title">Triaged Logs</h1>
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
              placeholder="Filter by target or text..."
              aria-label="Filter overview by target or text"
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

        <div className={styles.tree}>
          {hasContent ? (
            overview.children.map((child) => (
              <TreeNode key={child.fullTarget} node={child} onSelect={setSelected} />
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
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize log panel"
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
