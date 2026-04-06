import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useLogStore } from '../stores/logStore';
import type { ParsedLogLine } from '../types/log.types';
import { buildDisplayItems, calculateGapExpansion, type ForcedRange } from '../utils/logGapManager';
import { findMatchingIndices, expandWithContext, highlightText as highlightTextUtil } from '../utils/textMatching';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useMatchNavigation } from '../hooks/useMatchNavigation';
import { SearchInput } from '../components/SearchInput';
import type { SearchInputHandle } from '../components/SearchInput';
import { useKeyboardShortcutContextOptional } from '../components/KeyboardShortcutContext';
import { optionKey } from '../utils/shortcuts';
import { generateGitHubSourceUrl, resolveSwiftFilenameToBlobUrl } from '../utils/githubLinkGenerator';
import { detectCollapseGroups, type CollapseGroupInfo } from '../utils/logCollapsingUtils';
import { getHttpStatusColor } from '../utils/httpStatusColors';
import { stripLogPrefix } from '../utils/logMessageUtils';
import { LogExportDialog } from '../components/LogExportDialog';
import type { ExportContext } from '../utils/logExportUtils';
import { storeTabLog } from '../utils/tabLogUtils';
import { TAB_LOG_PARAM } from '../hooks/useTabLog';
import { RowTimeAction } from '../components/RowTimeAction';
import styles from './LogDisplayView.module.css';

const HTTP_ERROR_RE = /\bstatus=(\d{3})\b/;
const HTTP_CLIENT_ERROR_LOG_RE = /Error while sending request.*send\{request_id=/;
function getHttpErrorStatus(rawText: string): string | null {
  if (HTTP_CLIENT_ERROR_LOG_RE.test(rawText)) return 'client-error';
  const m = rawText.match(HTTP_ERROR_RE);
  if (!m) return null;
  const code = parseInt(m[1], 10);
  return code >= 400 ? m[1] : null;
}

/**
 * Props for LogDisplayView.
 *
 * ### `logLines` vs store lines
 *
 * When `logLines` is provided it is used as the source of truth instead of
 * `rawLogLines` from the global store. This is the mechanism used by
 * request-detail panels to show only the lines that belong to a specific
 * request, without touching global state.
 *
 * When `logLines` is omitted the view reads from the store and shows the
 * full log, subject to any active filters.
 *
 * ### `lineRange` — secondary scoping within the line array
 *
 * `lineRange` is an **inclusive** `{ start, end }` filter on `lineNumber`
 * that is applied *after* selecting the line source:
 *
 * - If `logLines` is also set, `lineRange` further restricts that slice
 *   (e.g. a sub-range of lines within the request's own log segment).
 * - If only `lineRange` is set (no `logLines`), the view searches the
 *   full store log and initially renders lines whose `lineNumber` falls
 *   within the range — typically used to open a focused view on a single
 *   request from the waterfall without constructing a bespoke line array.
 *
 * Gap expansion controls are still computed against the selected source
 * line array. Expanding a gap may therefore reveal lines outside `lineRange`.
 *
 * ### Precedence summary
 *
 * | `logLines` | `lineRange` | Result |
 * |---|---|---|
 * | provided | omitted | shows `logLines` (all) |
 * | provided | provided | initially shows `logLines` filtered to `lineRange`; gap expansion can reveal surrounding lines |
 * | omitted | provided | initially shows store lines filtered to `lineRange`; gap expansion can reveal surrounding lines |
 * | omitted | omitted | shows all store lines |
 */
interface LogDisplayViewProps {
  requestFilter?: string;
  defaultShowOnlyMatching?: boolean;
  defaultLineWrap?: boolean;
  onClose?: () => void;
  onExpand?: () => void;
  onFilterChange?: (filter: string) => void;
  prevRequestLineRange?: { start: number; end: number };
  nextRequestLineRange?: { start: number; end: number };
  /** Override the line source; when absent, falls back to `rawLogLines` from the store. */
  logLines?: ParsedLogLine[];
  /**
   * Inclusive line-number range `{ start, end }`. When set, the initial
   * rendered set is restricted to lines whose `lineNumber` falls within
   * this range. Gap expansion may reveal lines outside the range. Applied
   * after the `logLines` / store selection — see interface-level JSDoc for
   * the full precedence table.
   */
  lineRange?: { start: number; end: number };
}

export function LogDisplayView({ requestFilter = '', defaultShowOnlyMatching: _defaultShowOnlyMatching = false, defaultLineWrap = false, onClose, onExpand, onFilterChange, prevRequestLineRange, nextRequestLineRange, logLines, lineRange }: LogDisplayViewProps) {
  const { rawLogLines, sentryEvents, startTime, endTime } = useLogStore();
  const shortcutCtx = useKeyboardShortcutContextOptional();
  const registerFocusSearch = shortcutCtx?.registerFocusSearch;
  const registerFocusFilter = shortcutCtx?.registerFocusFilter;
  
  // Use passed logLines if provided, otherwise use all raw log lines from store
  const displayLogLines = logLines || rawLogLines;

  const sentryLineNumbers = useMemo(() => new Set(sentryEvents.map((e) => e.lineNumber)), [sentryEvents]);
  const sentryEventByLineNumber = useMemo(
    () => new Map(sentryEvents.map((event) => [event.lineNumber, event])),
    [sentryEvents]
  );

  const [searchQueryInput, setSearchQueryInput] = useState('');
  const [filterQueryInput, setFilterQueryInput] = useState(requestFilter);

  // Ref for programmatic focus ("/" shortcut)
  const searchInputRef = useRef<SearchInputHandle>(null);
  const filterInputRef = useRef<SearchInputHandle>(null);

  // Register "/" → focus search when this view is mounted
  useEffect(() => {
    if (!registerFocusSearch) return;
    const unregister = registerFocusSearch(() => {
      searchInputRef.current?.focus();
    });
    return unregister;
  }, [registerFocusSearch]);

  // Register "Option+/" (and "Cmd+F") → focus filter when this view is mounted
  useEffect(() => {
    if (!registerFocusFilter) return;
    const unregister = registerFocusFilter(() => {
      filterInputRef.current?.focus();
    });
    return unregister;
  }, [registerFocusFilter]);
  
  // Track when we're syncing from prop to avoid calling onFilterChange
  const isSyncingFromProp = useRef(false);
  
  // Sync filter input when requestFilter prop changes (e.g., URL→Store sync)
  useEffect(() => {
    if (requestFilter !== filterQueryInput) {
      isSyncingFromProp.current = true;
      setFilterQueryInput(requestFilter);
    }
    // filterQueryInput is intentionally excluded: this effect must only react to
    // prop changes from the parent. Including it would cause every local keystroke
    // to re-run the effect and reset the input back to the prop value, clobbering
    // the user's in-progress edits.
  }, [requestFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  
  // Debounce inputs to avoid recalculating on every keystroke
  const searchQuery = useDebouncedValue(searchQueryInput, 300);
  const filterQuery = useDebouncedValue(filterQueryInput, 300);

  // Notify parent when debounced filter value changes (only for user-initiated changes)
  useEffect(() => {
    // If we just synced from prop, clear the flag when debounced value catches up
    if (isSyncingFromProp.current) {
      if (filterQuery === requestFilter) {
        isSyncingFromProp.current = false;
      }
      // Don't call onFilterChange while syncing
      return;
    }
    
    if (onFilterChange && filterQuery !== requestFilter) {
      onFilterChange(filterQuery);
    }
  }, [filterQuery, onFilterChange, requestFilter]);

  const [contextLines, setContextLines] = useState(0);
  const [lineWrap, setLineWrap] = useState(defaultLineWrap);
  const [stripPrefix, setStripPrefix] = useState(true);
  const [forcedRanges, setForcedRanges] = useState<ForcedRange[]>([]);
  const [hoveredLineIndex, setHoveredLineIndex] = useState<number | null>(null);
  /** Index of the row whose RowTimeAction menu is currently open, or null. */
  const [menuOpenForIndex, setMenuOpenForIndex] = useState<number | null>(null);
  const [collapseEnabled, setCollapseEnabled] = useState(true);
  const [showExport, setShowExport] = useState(false);

  // Option+w → toggle line wrap; Option+p → toggle strip prefix; Option+s → open export dialog
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
      if (e.code === 'KeyW') {
        e.preventDefault();
        setLineWrap((v) => !v);
      } else if (e.code === 'KeyP') {
        e.preventDefault();
        setStripPrefix((v) => !v);
      } else if (e.code === 'KeyS') {
        e.preventDefault();
        setShowExport(true);
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, []);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    gapId: string;
    direction: 'up' | 'down';
    isFirst: boolean;
    isLast: boolean;
  } | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  // Filter determines which lines to show/hide (like old showOnlyMatching behavior)
  const filterMatchingLineIndices = useMemo(() => {
    return findMatchingIndices(displayLogLines, filterQuery, false, (line) => line.rawText);
  }, [displayLogLines, filterQuery]);

  // Build the filtered lines based on filter query and context
  const filteredLines = useMemo(() => {
    let allLines = displayLogLines.map((line, index) => ({ line, index }));

    // Pre-scope to line range when specified (e.g., a single request's lines)
    if (lineRange) {
      allLines = allLines.filter(({ line }) => {
        const ln = line.lineNumber ?? 0;
        return ln >= lineRange.start && ln <= lineRange.end;
      });
    }

    // If no filter, show all (range-scoped) lines
    if (!filterQuery.trim()) return allLines;

    // If filter is set but no matches, show empty
    if (filterMatchingLineIndices.size === 0) return [];

    // Expand matches with context lines using utility
    const linesToShow = expandWithContext(filterMatchingLineIndices, displayLogLines.length, contextLines);

    return allLines.filter(({ index }) => linesToShow.has(index));
  }, [displayLogLines, lineRange, filterQuery, contextLines, filterMatchingLineIndices]);

  // Collapse consecutive duplicate/similar lines
  const { visibleLines, collapseGroupsMap } = useMemo(() => {
    if (!collapseEnabled) {
      return { visibleLines: filteredLines, collapseGroupsMap: new Map<string, CollapseGroupInfo>() };
    }
    const { collapsedIndices, collapseGroups } = detectCollapseGroups(filteredLines);
    if (collapsedIndices.size === 0) {
      return { visibleLines: filteredLines, collapseGroupsMap: collapseGroups };
    }
    return {
      visibleLines: filteredLines.filter(({ index }) => !collapsedIndices.has(index)),
      collapseGroupsMap: collapseGroups,
    };
  }, [filteredLines, collapseEnabled]);

  // Build display items with gap indicators
  const displayItems = useMemo(() => {
    return buildDisplayItems(visibleLines, displayLogLines, forcedRanges);
  }, [visibleLines, displayLogLines, forcedRanges]);

  const displayIndices = useMemo(() => {
    return displayItems.map((item) => item.data.index);
  }, [displayItems]);

  // Snapshot of current view settings passed to the export dialog
  const exportContext = useMemo<ExportContext>(() => ({
    filterQuery,
    contextLines,
    lineRange,
    startTime,
    endTime,
  }), [filterQuery, contextLines, lineRange, startTime, endTime]);

  /**
   * Opens a new tab loaded with the full contiguous slice of the log from the
   * first to the last currently-visible line number. The current text filter
   * and time range are carried over via URL params so the new tab starts with
   * the same view settings.
   */
  const handleOpenInNewTab = useCallback(() => {
    if (displayItems.length === 0) return;

    const firstLineNumber = displayItems[0].data.line.lineNumber;
    const lastLineNumber = displayItems[displayItems.length - 1].data.line.lineNumber;

    // Collect all parsed lines in the contiguous range (includes lines hidden
    // by the text filter so the new tab has the full surrounding context).
    const croppedText = displayLogLines
      .filter((l) => {
        const ln = l.lineNumber ?? 0;
        return ln >= firstLineNumber && ln <= lastLineNumber;
      })
      .map((l) => l.rawText)
      .join('\n');

    const tabLogId = storeTabLog(croppedText);
    if (!tabLogId) {
      alert('The log is too large to open in a new tab.');
      return;
    }

    const params = new URLSearchParams();
    params.set(TAB_LOG_PARAM, tabLogId);
    if (filterQuery.trim()) params.set('filter', filterQuery);
    if (startTime) params.set('start', startTime);
    if (endTime) params.set('end', endTime);

    const url = new URL(window.location.href);
    url.hash = `/logs?${params.toString()}`;

    // Mirror the existing source-link pattern: open a blank window first so
    // popup blockers treat it as user-initiated, then navigate it safely.
    const newWindow = window.open('', '_blank');
    if (newWindow) {
      newWindow.opener = null;
      newWindow.location.href = url.toString();
    }
  }, [displayItems, displayLogLines, filterQuery, startTime, endTime]);

  // Search determines highlighting within all currently rendered lines (including
  // lines expanded from collapsed groups via forcedRanges).
  const searchMatchingLineIndices = useMemo(() => {
    if (!searchQuery.trim()) return new Set<number>();
    const matchingOriginalIndices = new Set<number>();
    const normalizedQuery = searchQuery.toLowerCase();
    displayItems.forEach(({ data: { line, index } }) => {
      if (line.rawText.toLowerCase().includes(normalizedQuery)) {
        matchingOriginalIndices.add(index);
      }
    });
    return matchingOriginalIndices;
  }, [displayItems, searchQuery]);

  // Convert search matches to sorted array for navigation
  const searchMatchesArray = useMemo(() => {
    return Array.from(searchMatchingLineIndices).sort((a, b) => a - b);
  }, [searchMatchingLineIndices]);

  // Use navigation hook for next/prev match functionality
  const {
    currentIndex: currentSearchMatchIndex,
    goToNext: goToNextMatch,
    goToPrevious: goToPreviousMatch,
  } = useMatchNavigation(searchMatchesArray);

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: displayItems.length,
    getItemKey: (index) => `line-${displayItems[index]?.data.index ?? index}`,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (lineWrap ? 76 : 24),
    measureElement: (el) => el.getBoundingClientRect().height,
    overscan: 20,
  });

  useEffect(() => {
    // Reset all measurements and force remeasure when wrap state or filters change
    rowVirtualizer.measurementsCache = [];
    rowVirtualizer.measure();
  }, [rowVirtualizer, lineWrap, contextLines, searchQuery, displayItems.length, forcedRanges, filterQuery]);

  // Auto-scroll to current search match
  useEffect(() => {
    if (searchMatchesArray.length === 0) return;
    
    const currentMatchLineNumber = searchMatchesArray[currentSearchMatchIndex];
    const displayItemIndex = displayItems.findIndex(item => item.data.index === currentMatchLineNumber);
    
    if (displayItemIndex !== -1) {
      // Find the actual DOM element and scroll it into view
      setTimeout(() => {
        const matchElement = document.querySelector(`.log-line[data-index="${displayItemIndex}"]`);
        if (matchElement) {
          matchElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50); // Small delay to ensure element is rendered
    }
  }, [currentSearchMatchIndex, searchMatchesArray, displayItems]);

  const highlightText = (line: ParsedLogLine, originalIndex: number): React.ReactNode => {
    const isMatch = searchMatchingLineIndices.has(originalIndex);
    const displayText = getDisplayText(line);
    const isHovered = hoveredLineIndex === originalIndex;
    const highlightOpts = searchQuery && isMatch
      ? { query: searchQuery, caseSensitive: false, highlightClassName: styles.searchHighlight }
      : null;

    const renderWithSearchHighlights = (text: string, keySuffix: string): React.ReactNode => {
      if (!highlightOpts) {
        return text;
      }
      return highlightTextUtil(text, { ...highlightOpts, keyPrefix: `line-${originalIndex}-${keySuffix}` });
    };

    type LinkSpec = {
      readonly start: number;
      readonly end: number;
      readonly href: string;
      readonly title: string;
      readonly keyPrefix: string;
      readonly onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
    };

    const linkSpecs: LinkSpec[] = [];

    // Always render the anchor so the first click lands on the element.
    // The link only receives visible link styling when the row is hovered/focused;
    // otherwise it inherits the surrounding text appearance (sourceLinkInactive).
    if (line.filePath && line.sourceLineNumber) {
      const githubUrl = generateGitHubSourceUrl(line.filePath, line.sourceLineNumber);
      if (githubUrl) {
        const sourceRef = `${line.filePath}:${line.sourceLineNumber}`;
        const sourceRefIndex = displayText.indexOf(sourceRef);
        if (sourceRefIndex >= 0) {
          linkSpecs.push({
            start: sourceRefIndex,
            end: sourceRefIndex + sourceRef.length,
            href: githubUrl,
            title: 'View on GitHub',
            keyPrefix: 'source',
            onClick: (e) => { void handleSourceLinkClick(e, line.filePath, line.sourceLineNumber); },
          });
        }
      }
    }

    const sentryEvent = sentryEventByLineNumber.get(line.lineNumber);
    if (sentryEvent?.sentryId && sentryEvent.sentryUrl) {
      const sentryIdIndex = displayText.indexOf(sentryEvent.sentryId);
      if (sentryIdIndex >= 0) {
        linkSpecs.push({
          start: sentryIdIndex,
          end: sentryIdIndex + sentryEvent.sentryId.length,
          href: sentryEvent.sentryUrl,
          title: 'View in Sentry',
          keyPrefix: 'sentry',
        });
      }
    }

    if (linkSpecs.length > 0) {
      linkSpecs.sort((a, b) => a.start - b.start);
      const renderedParts: React.ReactNode[] = [];
      let cursor = 0;

      for (let i = 0; i < linkSpecs.length; i++) {
        const spec = linkSpecs[i];
        if (spec.start < cursor) {
          continue;
        }

        const before = displayText.slice(cursor, spec.start);
        if (before.length > 0) {
          renderedParts.push(renderWithSearchHighlights(before, `${spec.keyPrefix}-before-${i}`));
        }

        const linkedText = displayText.slice(spec.start, spec.end);
        renderedParts.push(
          <a
            key={`line-${originalIndex}-${spec.keyPrefix}-link-${i}`}
            href={spec.href}
            target="_blank"
            rel="noopener noreferrer"
            className={isHovered ? styles.sourceLink : styles.sourceLinkInactive}
            title={isHovered ? spec.title : undefined}
            onClick={spec.onClick}
          >
            {renderWithSearchHighlights(linkedText, `${spec.keyPrefix}-text-${i}`)}
          </a>
        );

        cursor = spec.end;
      }

      const after = displayText.slice(cursor);
      if (after.length > 0) {
        renderedParts.push(renderWithSearchHighlights(after, 'tail'));
      }

      return <>{renderedParts}</>;
    }
    
    if (!searchQuery || !isMatch) {
      return displayText;
    }

    const parts = highlightTextUtil(displayText, {
      query: searchQuery,
      caseSensitive: false,
      keyPrefix: `line-${originalIndex}`,
      highlightClassName: styles.searchHighlight,
    });

    return <>{parts}</>;
  };

  const getLogLevelClass = (level: string) => {
    const levelMap: Record<string, string> = {
      trace: styles.levelTrace,
      debug: styles.levelDebug,
      info: styles.levelInfo,
      warn: styles.levelWarn,
      error: styles.levelError,
    };
    return levelMap[level.toLowerCase()] || styles.levelUnknown;
  };

  const getDisplayText = (line: ParsedLogLine): string => {
    // Always use line.message (first physical line only) — continuation lines are
    // rendered separately in the logLineContinuation block and must not be included
    // here. line.rawText now spans multiple physical lines for multi-line entries,
    // which is correct for search matching but wrong for single-line display.
    if (!stripPrefix) {
      return line.message;
    }
    // Strip ISO timestamp and log level from display (they're already shown in columns)
    return stripLogPrefix(line.message);
  };

  const handleSourceLinkClick = async (
    e: React.MouseEvent<HTMLAnchorElement>,
    filePath?: string,
    sourceLineNumber?: number
  ) => {
    if (!filePath || !sourceLineNumber) return;
    if (!filePath.endsWith('.swift') || filePath.includes('/')) return;

    e.preventDefault();

    // Open without 'noopener' in the features string so the browser returns a
    // usable window reference; then immediately nullify opener to block
    // reverse-tabnabbing (the opened page cannot access window.opener).
    const pendingWindow = window.open('', '_blank');
    if (!pendingWindow) return;
    pendingWindow.opener = null;

    try {
      const resolvedUrl = await resolveSwiftFilenameToBlobUrl(filePath, sourceLineNumber);
      const fallbackUrl = generateGitHubSourceUrl(filePath, sourceLineNumber);
      const targetUrl = resolvedUrl || fallbackUrl;

      if (!targetUrl) {
        pendingWindow.close();
        return;
      }

      pendingWindow.location.href = targetUrl;
    } catch {
      pendingWindow.close();
    }
  };

  // Expand a gap by including the missing lines
  const expandGap = (gapId: string, count: number | 'all' | 'next-match' | 'prev-match') => {
    const newForcedRanges = calculateGapExpansion(
      gapId,
      count,
      displayIndices,
      displayLogLines.length,
      forcedRanges,
      filterMatchingLineIndices,
      prevRequestLineRange,
      nextRequestLineRange
    );
    setForcedRanges(newForcedRanges);
  };

  // Handle gap expansion with click detection
  const handleGapClick = (gapId: string) => {
    // Single click: load 10 more
    expandGap(gapId, 10);
  };

  // Handle right-click to show context menu
  const handleGapContextMenu = (
    e: React.MouseEvent,
    gapId: string,
    direction: 'up' | 'down',
    isFirst: boolean,
    isLast: boolean
  ) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      gapId,
      direction,
      isFirst,
      isLast,
    });
  };

  // Close context menu when clicking elsewhere
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu]);

  return (
    <div className={styles.logDisplayView}>
      <div className={styles.logToolbar}>
        <div className={styles.logToolbarLeft}>
          <SearchInput
            ref={searchInputRef}
            value={searchQueryInput}
            onChange={setSearchQueryInput}
            placeholder="Search logs..."
            title="Search and highlight in filtered results (/)"
            expandOnFocus={false}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (e.shiftKey) {
                  goToPreviousMatch();
                } else {
                  goToNextMatch();
                }
              }
            }}
          />
          {searchMatchesArray.length > 0 && (
            <>
              <div className={styles.searchNavigation}>
                <button
                  className={`${styles.btnToolbar} ${styles.btnIcon}`}
                  onClick={goToPreviousMatch}
                  title="Previous match (Shift+Enter)"
                  aria-label="Previous match"
                  disabled={searchMatchesArray.length === 0}
                >
                  ↑
                </button>
                <span
                  className={styles.searchResultsCount}
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {currentSearchMatchIndex + 1} / {searchMatchesArray.length}
                </span>
                <button
                  className={`${styles.btnToolbar} ${styles.btnIcon}`}
                  onClick={goToNextMatch}
                  title="Next match (Enter)"
                  aria-label="Next match"
                  disabled={searchMatchesArray.length === 0}
                >
                  ↓
                </button>
              </div>
            </>
          )}
        </div>
        <div className={styles.logToolbarRight}>
          <label className={styles.logToolbarOption} title={`Toggle line wrap (${optionKey}+w)`}>
            <input
              type="checkbox"
              checked={lineWrap}
              onChange={(e) => setLineWrap(e.target.checked)}
            />
            Line wrap
          </label>
          <label className={styles.logToolbarOption} title={`Toggle strip prefix (${optionKey}+p)`}>
            <input
              type="checkbox"
              checked={stripPrefix}
              onChange={(e) => setStripPrefix(e.target.checked)}
            />
            Strip prefix
          </label>
          <label className={styles.logToolbarOption} title="Collapse consecutive duplicate/similar log lines">
            <input
              type="checkbox"
              checked={collapseEnabled}
              onChange={(e) => setCollapseEnabled(e.target.checked)}
            />
            Collapse duplicates
          </label>
          <SearchInput
            ref={filterInputRef}
            value={filterQueryInput}
            onChange={setFilterQueryInput}
            placeholder="Filter logs..."
            title="Filter to show only matching lines"
            expandOnFocus={false}
          />
          <div className={styles.logToolbarContextGroup}>
            <button
              className={`${styles.btnToolbar} ${styles.btnContextToggle} ${contextLines > 0 ? 'active' : ''}`}
              onClick={() => {
                if (contextLines > 0) {
                  setContextLines(0);
                } else {
                  setContextLines(5);
                }
              }}
              title="Context lines before/after matches"
              aria-label="Toggle context lines"
              disabled={!filterQuery.trim()}
            >
              ≡
            </button>
            <input
              type="number"
              min="0"
              max="100"
              value={contextLines}
              onChange={(e) => {
                const val = parseInt(e.target.value) || 0;
                setContextLines(val);
              }}
              className={styles.logContextInput}
              title="Context lines (0 = disabled)"
              disabled={!filterQuery.trim()}
            />
          </div>
          <div className={styles.logToolbarActions}>
            {!onClose && !onExpand && (
              <button
                className={`${styles.btnToolbar} ${styles.btnIcon}`}
                onClick={handleOpenInNewTab}
                aria-label="Open in new tab"
                title="Open cropped logs in new tab"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path d="M7 3H3a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M10 2h4v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M14 2L8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
            <button
              className={`${styles.btnToolbar} ${styles.btnIcon}`}
              onClick={() => setShowExport(true)}
              aria-label="Export logs"
              title="Export visible logs"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 12h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </button>
            {onExpand && (
              <button
                className={`${styles.btnToolbar} ${styles.btnIcon}`}
                onClick={() => onExpand()}
                aria-label="Open in Logs view"
                title="Open in Logs view"
              >
                ⤢
              </button>
            )}
            {onClose && (
              <button
                className={`${styles.btnToolbar} ${styles.btnIcon} ${styles.closeIcon}`}
                onClick={onClose}
                aria-label="Close log viewer"
                title="Close"
              >
                ×
              </button>
            )}
          </div>
        </div>
      </div>

      <div ref={parentRef} className={styles.logContentWrapper}>
        <div
          className={styles.logContent}
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const item = displayItems[virtualRow.index];
            if (!item) {
              return null;
            }
            const { line, index } = item.data;
            const isMatch = searchMatchingLineIndices.has(index);
            const isCurrentSearchMatch = searchMatchesArray.length > 0 && index === searchMatchesArray[currentSearchMatchIndex];
            const gapAbove = item.gapAbove;
            const gapBelow = item.gapBelow;
            const collapseInfo = gapBelow ? collapseGroupsMap.get(gapBelow.gapId) : undefined;
            const collapsedCount = collapseInfo && gapBelow ? Math.min(collapseInfo.count, gapBelow.remainingGap) : 0;
            const isSentryLine = sentryLineNumbers.has(line.lineNumber);
            const httpErrorStatus = isSentryLine ? null : getHttpErrorStatus(line.rawText);

            return (
              <div
                key={`${virtualRow.key}-${lineWrap ? 'wrap' : 'nowrap'}`}
                data-index={virtualRow.index}
                ref={(el) => {
                  if (el) rowVirtualizer.measureElement(el);
                }}
                className={`${styles.logLine} ${getLogLevelClass(line.level)} ${isMatch ? styles.matchLine : ''} ${isCurrentSearchMatch ? styles.currentMatch : ''} ${lineWrap ? styles.wrap : styles.nowrap} ${hoveredLineIndex === index ? 'log-row-hovered' : ''}`}
                onMouseEnter={() => setHoveredLineIndex(index)}
                onMouseLeave={() => setHoveredLineIndex(null)}
                onFocus={() => setHoveredLineIndex(index)}
                onBlur={(e: React.FocusEvent<HTMLDivElement>) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setHoveredLineIndex(null);
                  }
                }}
                tabIndex={-1}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: lineWrap ? '100%' : 'fit-content',
                  minWidth: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                  // Elevate the row above subsequent siblings when its menu is open so
                  // DOM-order paint (later rows cover earlier rows) cannot clip the menu.
                  zIndex: menuOpenForIndex === index ? 10 : undefined,
                }}
              >
                <RowTimeAction
                  timestampUs={line.timestampUs}
                  onOpenChange={(open) =>
                    setMenuOpenForIndex((prev) => (open ? index : prev === index ? null : prev))
                  }
                />
                {(gapAbove || (gapBelow && !collapseInfo)) && (
                  <div className={styles.logGapControls}>
                    {gapAbove && (
                      <button
                        className={styles.logGapArrow}
                        onClick={() => handleGapClick(gapAbove.gapId)}
                        onContextMenu={(e) => handleGapContextMenu(e, gapAbove.gapId, 'up', gapAbove.isFirst ?? false, false)}
                        title={`${gapAbove.remainingGap} hidden lines above\nClick: +10 | Right-click: More options`}
                        aria-label={`Load hidden lines above`}
                      >
                        <svg viewBox="0 0 12 12" width="12" height="12">
                          <path d="M6 2 L10 7 L2 7 Z" fill="currentColor" />
                        </svg>
                      </button>
                    )}
                    {gapBelow && !collapseInfo && (
                      <button
                        className={styles.logGapArrow}
                        onClick={() => handleGapClick(gapBelow.gapId)}
                        onContextMenu={(e) => handleGapContextMenu(e, gapBelow.gapId, 'down', false, gapBelow.isLast ?? false)}
                        title={`${gapBelow.remainingGap} hidden lines below\nClick: +10 | Right-click: More options`}
                        aria-label={`Load hidden lines below`}
                      >
                        <svg viewBox="0 0 12 12" width="12" height="12">
                          <path d="M6 10 L10 5 L2 5 Z" fill="currentColor" />
                        </svg>
                      </button>
                    )}
                  </div>
                )}
                {gapBelow && !gapBelow.isLast && !collapseInfo && <div className={`${styles.logGapDivider} ${styles.logGapDividerBelow}`} />}
                <span className={styles.logLineNumber}>{line.lineNumber}</span>
                <span className={styles.logLineTimestamp}>{line.displayTime}</span>
                <span className={styles.logLineLevel}>{line.level}</span>
                <span
                  className={styles.logLineText}
                  style={isSentryLine ? { color: 'var(--color-sentry)' } : httpErrorStatus === 'client-error' ? { color: 'var(--http-client-error)' } : httpErrorStatus ? { color: getHttpStatusColor(httpErrorStatus) } : undefined}
                >
                  {highlightText(line, index)}
                </span>
                {(line.continuationLines?.length ?? 0) > 0 && (
                  <div className={styles.logLineContinuation}>
                    {line.continuationLines!.join('\n')}
                  </div>
                )}
                {collapseInfo && gapBelow && (
                  <div className={styles.collapseSummaryBar} data-testid="collapse-bar">
                    <span className={styles.logLineNumber} aria-hidden="true" />
                    <span className={styles.logLineTimestamp} aria-hidden="true" />
                    <span className={styles.logLineLevel}>
                      {collapseInfo.type === 'exact' ? '=' : '≈'}
                    </span>
                    <span className={styles.collapseSummaryText}>
                      {collapsedCount.toLocaleString()} {collapseInfo.type === 'exact' ? 'identical' : 'similar'} {collapsedCount === 1 ? 'line' : 'lines'} collapsed
                      <span className={styles.collapseSummaryActions}>
                        {collapsedCount > 10 && (
                          <>
                            {' - '}
                            <button
                              className={styles.collapseSummaryBtn}
                              onClick={() => expandGap(gapBelow.gapId, 10)}
                              aria-label="Load 10 collapsed lines"
                            >
                              +10
                            </button>
                          </>
                        )}
                        {' - '}
                        <button
                          className={styles.collapseSummaryBtn}
                          onClick={() => expandGap(gapBelow.gapId, 'all')}
                          aria-label={`Expand all ${collapsedCount} collapsed lines`}
                        >
                          show all
                        </button>
                      </span>
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {displayItems.length === 0 && visibleLines.length > 0 && (
        <div className={styles.logEmptyState}>
          No matching lines found for "{searchQuery}"
        </div>
      )}

      {filteredLines.length === 0 && filterQuery && (
        <div className={styles.logEmptyState}>
          No lines match filter "{filterQuery}"
        </div>
      )}

      {displayLogLines.length === 0 && (
        <div className={styles.logEmptyState}>
          No log data available. Please upload a log file.
        </div>
      )}

      {showExport && (
        <LogExportDialog
          displayItems={displayItems}
          context={exportContext}
          onClose={() => setShowExport(false)}
        />
      )}

      {contextMenu && (
        <div
          className={styles.logGapContextMenu}
          style={{
            position: 'fixed',
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`,
            zIndex: 1000,
          }}
        >
          <button
            className={styles.contextMenuItem}
            onClick={() => {
              expandGap(contextMenu.gapId, 10);
              setContextMenu(null);
            }}
          >
            Load 10 more lines
          </button>
          {contextMenu.direction === 'down' && nextRequestLineRange && (
            <button
              className={styles.contextMenuItem}
              onClick={() => {
                expandGap(contextMenu.gapId, 'next-match');
                setContextMenu(null);
              }}
            >
              Load to next log
            </button>
          )}
          {contextMenu.direction === 'up' && prevRequestLineRange && (
            <button
              className={styles.contextMenuItem}
              onClick={() => {
                expandGap(contextMenu.gapId, 'prev-match');
                setContextMenu(null);
              }}
            >
              Load to previous log
            </button>
          )}
          {((contextMenu.direction === 'up' && contextMenu.isFirst) ||
            (contextMenu.direction === 'down' && contextMenu.isLast)) && (
            <button
              className={styles.contextMenuItem}
              onClick={() => {
                expandGap(contextMenu.gapId, 'all');
                setContextMenu(null);
              }}
            >
              Load all to {contextMenu.direction === 'up' ? 'top' : 'bottom'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

