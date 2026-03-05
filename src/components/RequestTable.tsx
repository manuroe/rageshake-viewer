import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLogStore } from '../stores/logStore';
import { useURLParams } from '../hooks/useURLParams';
import { WaterfallTimeline } from './WaterfallTimeline';
import { BurgerMenu } from './BurgerMenu';
import { TimeRangeSelector } from './TimeRangeSelector';
import { TimelineScaleSelector } from './TimelineScaleSelector';
import { StatusFilterDropdown } from './StatusFilterDropdown';
import { SearchInput } from './SearchInput';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { getWaterfallPosition, getWaterfallBarWidth, calculateTimelineWidth } from '../utils/timelineUtils';
import { LogDisplayView } from '../views/LogDisplayView';
import { useScrollSync } from '../hooks/useScrollSync';
import { useUrlRequestAutoScroll } from '../hooks/useUrlRequestAutoScroll';
import { microsToMs } from '../utils/timeUtils';
import { formatBytes } from '../utils/sizeUtils';
import { getHttpStatusColor } from '../utils/httpStatusColors';
import type { HttpRequest } from '../types/log.types';
import styles from './RequestTable.module.css';



/**
 * Column definition for the RequestTable component.
 */
export interface ColumnDef {
  /** Unique column identifier */
  id: string;
  /** Column header label */
  label: string;
  /** Extract the display value from a request */
  getValue: (req: HttpRequest) => string;
  /** Optional CSS class name for the column */
  className?: string;
}

/**
 * Props for the RequestTable component.
 */
export interface RequestTableProps {
  /** Title displayed in the header */
  title: string;
  /** Column definitions for the sticky left panel */
  columns: ColumnDef[];
  /** CSS class applied to the container for view-specific styling */
  containerClassName?: string;
  /** Filtered requests to display */
  filteredRequests: HttpRequest[];
  /** Total count to display (pre-calculated by the view) */
  totalCount: number;
  /** Whether to show incomplete requests */
  showIncomplete: boolean;
  /** Callback when incomplete checkbox changes */
  onShowIncompleteChange: (value: boolean) => void;
  /** Timeline scale (ms per pixel) */
  msPerPixel: number;
  /** Available status codes for filtering (including 'Incomplete' if applicable) */
  availableStatusCodes: string[];
  /** Optional additional header controls before the checkbox (e.g., connection dropdown) */
  headerSlot?: ReactNode;
  /** Message to show when no requests are found */
  emptyMessage?: string;
  /** CSS selector prefix for row measurement (e.g., '.sync-view' or '') */
  rowSelector?: string;
  /** Whether to show the URI filter (default: true) */
  showUriFilter?: boolean;
  /** Whether to show the /sync filter checkbox (default: true). Set to false in SyncView where all requests are already sync. */
  showSyncFilter?: boolean;
  /**
   * Optional override for the bar background color.
   * Receives the request and the default computed color; return a CSS color string.
   * Use this to apply view-specific coloring (e.g., timeout-exceeded state).
   */
  getBarColor?: (req: HttpRequest, defaultColor: string) => string;
  /**
   * Optional renderer for overlay elements inside the waterfall bar.
   * Receives the request plus timeline dimensions so the caller can compute
   * pixel positions (e.g., a vertical tick at the timeout boundary).
   */
  renderBarOverlay?: (
    req: HttpRequest,
    barWidthPx: number,
    msPerPixel: number,
    totalDuration: number,
    timelineWidth: number
  ) => ReactNode;
}

/**
 * Returns a unique numeric key for a request row, derived from line numbers.
 * Using line numbers (rather than requestId) ensures uniqueness even when
 * multiple requests share the same requestId.
 */
function getRowKey(req: HttpRequest): number {
  return (req.sendLineNumber || req.responseLineNumber) as number;
}

/**
 * Reusable request timeline table component.
 * Displays requests in a two-panel layout: sticky columns on the left, waterfall timeline on the right.
 *
 * Used by HttpRequestsView, SyncView, and other future request-type views.
 */
export function RequestTable({
  title,
  columns,
  containerClassName = '',
  filteredRequests,
  totalCount,
  showIncomplete,
  onShowIncompleteChange,
  msPerPixel,
  availableStatusCodes,
  headerSlot,
  emptyMessage = 'No requests found',
  showUriFilter = true,
  showSyncFilter = true,
  getBarColor,
  renderBarOverlay,
}: RequestTableProps) {
  const {
    expandedRows,
    openLogViewerIds,
    rawLogLines,
    toggleRowExpansion,
    closeLogViewer,
    setActiveRequest,
    uriFilter,
  } = useLogStore();
  const navigate = useNavigate();
  const { setUriFilter } = useURLParams();

  const waterfallContainerRef = useRef<HTMLDivElement>(null);
  const leftPanelRef = useRef<HTMLDivElement>(null);
  const stickyHeaderRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [showSyncRequests, setShowSyncRequests] = useState(true);

  const isSyncRequest = (req: HttpRequest): boolean => /\/sync(?:[/?]|$)/i.test(req.uri);
  const displayedRequests = showSyncRequests
    ? filteredRequests
    : filteredRequests.filter((req) => !isSyncRequest(req));

  // URI filter state with debouncing
  const [uriFilterInput, setUriFilterInput] = useState(uriFilter ?? '');
  const debouncedUriFilter = useDebouncedValue(uriFilterInput, 300);

  // Sync debounced URI filter to URL
  useEffect(() => {
    const newFilter = debouncedUriFilter.length > 0 ? debouncedUriFilter : null;
    if (newFilter !== uriFilter) {
      setUriFilter(newFilter);
    }
  }, [debouncedUriFilter, uriFilter, setUriFilter]);

  // Sync store changes back to input (e.g., when URL changes externally)
  useEffect(() => {
    const storeValue = uriFilter ?? '';
    if (storeValue !== uriFilterInput && storeValue !== debouncedUriFilter) {
      setUriFilterInput(storeValue);
    }
  }, [uriFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleUriFilterClear = useCallback(() => {
    setUriFilterInput('');
    setUriFilter(null);
  }, [setUriFilter, setUriFilterInput]);

  // Use shared scroll sync hook
  useScrollSync(leftPanelRef, waterfallContainerRef);

  // Calculate timeline scale
  // Find the maximum extent: the latest point where any request bar ends
  const timeData = displayedRequests
    .map((r) => {
      const sendLine = rawLogLines.find(l => l.lineNumber === r.sendLineNumber);
      const startTime = microsToMs(sendLine?.timestampUs ?? 0);
      const endTime = startTime + (r.requestDurationMs || 0);
      return { startTime, endTime };
    })
    .filter((t) => t.startTime > 0);
  
  const minTime = timeData.length > 0 ? Math.min(...timeData.map(t => t.startTime)) : 0;
  // Use maxExtent to ensure the timeline is wide enough for all bars including their widths
  // Add extra time (in ms) to account for the duration label displayed after the last bar (e.g., "12888ms")
  // 80px worth of label space at the current scale
  const labelPaddingMs = 80 * msPerPixel;
  const maxExtent = timeData.length > 0 
    ? Math.max(...timeData.map(t => t.endTime)) + labelPaddingMs 
    : 0;
  // totalDuration uses maxExtent so bar positions are correctly proportioned to timeline width
  const totalDuration = Math.max(1, maxExtent - minTime);

  // Calculate timeline width using shared logic
  const visibleTimes = displayedRequests
    .slice(0, 20)
    .map((r) => {
      const sendLine = rawLogLines.find(l => l.lineNumber === r.sendLineNumber);
      return microsToMs(sendLine?.timestampUs ?? 0);
    })
    .filter((t) => t > 0);

  const { timelineWidth } = calculateTimelineWidth(
    containerWidth,
    visibleTimes,
    minTime,
    maxExtent,
    msPerPixel
  );

  // Handle resize for layout measurements
  useEffect(() => {
    const handleResize = () => {
      if (!waterfallContainerRef.current) return;
      setContainerWidth(waterfallContainerRef.current.clientWidth);
    };

    handleResize();
    const observer = new ResizeObserver(() => handleResize());
    if (waterfallContainerRef.current) {
      observer.observe(waterfallContainerRef.current);
    }

    return () => {
      observer.disconnect();
    };
  }, [timelineWidth]);

  /** Handle click on request ID - toggle expansion or open log viewer */
  const handleRequestClick = useCallback((rowKey: number, requestId: string, req?: HttpRequest) => {
    // Remove request_id parameter from URL if clicking a different request,
    // while preserving all other query params (e.g., scale, timeout, status).
    const hashValue = window.location.hash.startsWith('#')
      ? window.location.hash.slice(1)
      : window.location.hash;
    const [hashPath, hashQuery = ''] = hashValue.split('?');
    const hashParams = new URLSearchParams(hashQuery);
    const urlId = hashParams.get('request_id');

    if (urlId && urlId !== requestId) {
      hashParams.delete('request_id');
      const newQuery = hashParams.toString();
      window.location.hash = newQuery ? `${hashPath}?${newQuery}` : hashPath;
    }

    // If clicking the same request that's already open, close it
    if (openLogViewerIds.has(rowKey) && expandedRows.has(rowKey)) {
      closeLogViewer(rowKey);
      toggleRowExpansion(rowKey);
      return;
    }
    // Open clicked request and close all others atomically
    setActiveRequest(rowKey);
    
    // Scroll waterfall to show the request if we have the request object
    if (req && waterfallContainerRef.current) {
      setTimeout(() => {
        const sendLine = rawLogLines.find(l => l.lineNumber === req.sendLineNumber);
        const reqTime = microsToMs(sendLine?.timestampUs ?? 0);
        const barLeft = getWaterfallPosition(reqTime, minTime, totalDuration, timelineWidth, msPerPixel);
        const container = waterfallContainerRef.current;
        if (container) {
          const containerClientWidth = container.clientWidth;
          const targetScroll = barLeft - containerClientWidth * 0.2;
          container.scrollLeft = Math.max(0, targetScroll);
        }
      }, 0);
    }
  }, [openLogViewerIds, expandedRows, closeLogViewer, toggleRowExpansion, setActiveRequest, rawLogLines, minTime, totalDuration, timelineWidth, msPerPixel]);

  /** Handle mouse enter on a row - highlight both panels */
  const handleRowMouseEnter = (rowKey: number) => {
    const leftRow = document.querySelector(`[data-row-id="sticky-${rowKey}"]`);
    const rightRow = document.querySelector(`[data-row-id="waterfall-${rowKey}"]`);
    leftRow?.classList.add('row-hovered');
    rightRow?.classList.add('row-hovered');
  };

  /** Handle mouse leave on a row - remove highlight */
  const handleRowMouseLeave = (rowKey: number) => {
    const leftRow = document.querySelector(`[data-row-id="sticky-${rowKey}"]`);
    const rightRow = document.querySelector(`[data-row-id="waterfall-${rowKey}"]`);
    leftRow?.classList.remove('row-hovered');
    rightRow?.classList.remove('row-hovered');
  };

  /** Handle click on waterfall row - scroll to show request start time */
  const handleWaterfallRowClick = useCallback((req: HttpRequest) => {
    if (!waterfallContainerRef.current) return;

    const container = waterfallContainerRef.current;
    const sendLine = rawLogLines.find(l => l.lineNumber === req.sendLineNumber);
    const reqTime = microsToMs(sendLine?.timestampUs ?? 0);
    const barLeft = getWaterfallPosition(reqTime, minTime, totalDuration, timelineWidth, msPerPixel);

    // Scroll to show the start of the request bar, with some padding (20% of container width)
    const containerClientWidth = container.clientWidth;
    const targetScroll = barLeft - containerClientWidth * 0.2;

    // Use direct scrollLeft assignment (scrollTo with smooth behavior doesn't work reliably)
    container.scrollLeft = Math.max(0, targetScroll);
  }, [rawLogLines, minTime, totalDuration, timelineWidth, msPerPixel]);

  // Sum upload/download bytes for displayed requests
  const { totalUploadBytes, totalDownloadBytes } = useMemo(() => {
    let up = 0;
    let down = 0;
    for (const req of displayedRequests) {
      up += req.requestSize;
      down += req.responseSize;
    }
    return { totalUploadBytes: up, totalDownloadBytes: down };
  }, [displayedRequests]);

  // Use shared URL auto-scroll hook (placed after handleWaterfallRowClick is defined)
  useUrlRequestAutoScroll(displayedRequests, leftPanelRef, handleWaterfallRowClick);

  /** Map column class names to CSS module class names */
  const getColumnClass = (className?: string): string => {
    if (!className) return '';
    const classMap: Record<string, string> = {
      time: styles.time,
      uri: styles.uri,
      method: styles.method,
      size: styles.size,
      duration: styles.duration,
      status: styles.status,
    };
    return classMap[className] || '';
  };

  /** Render the expanded log viewer for a request */
  const renderExpandedLogViewer = () => {
    const expandedRowKey = Array.from(openLogViewerIds).find(id => expandedRows.has(id));
    if (expandedRowKey === undefined) return null;

    const req = displayedRequests.find(r => getRowKey(r) === expandedRowKey);
    if (!req) return null;

    const reqIndex = displayedRequests.findIndex(r => getRowKey(r) === expandedRowKey);
    const prevRequest = reqIndex > 0 ? displayedRequests[reqIndex - 1] : null;
    const nextRequest = reqIndex < displayedRequests.length - 1 ? displayedRequests[reqIndex + 1] : null;

    const prevRequestLineRange = prevRequest ? {
      start: prevRequest.sendLineNumber,
      end: prevRequest.responseLineNumber || prevRequest.sendLineNumber
    } : undefined;

    const nextRequestLineRange = nextRequest ? {
      start: nextRequest.sendLineNumber,
      end: nextRequest.responseLineNumber || nextRequest.sendLineNumber
    } : undefined;

    return (
      <div className={styles.expandedLogViewer}>
        <LogDisplayView
          key={expandedRowKey}
          requestFilter={`"${req.requestId}"`}
          defaultShowOnlyMatching
          defaultLineWrap
          logLines={rawLogLines.map(line => ({
            ...line,
            timestamp: line.displayTime
          }))}
          prevRequestLineRange={prevRequestLineRange}
          nextRequestLineRange={nextRequestLineRange}
          onExpand={() => {
            const params = new URLSearchParams();
            params.set('filter', `"${req.requestId}"`);
            const { startTime: storeStart, endTime: storeEnd } = useLogStore.getState();
            if (storeStart) params.set('start', storeStart);
            if (storeEnd) params.set('end', storeEnd);
            void navigate(`/logs?${params.toString()}`);
          }}
          onClose={() => {
            closeLogViewer(expandedRowKey);
            if (expandedRows.has(expandedRowKey)) {
              toggleRowExpansion(expandedRowKey);
            }
          }}
        />
      </div>
    );
  };

  return (
    <div className={`app ${containerClassName}`.trim()}>
      <div className="header-compact">
        <div className="header-left">
          <BurgerMenu />
          <h1 className="header-title">{title}</h1>
        </div>

        <div className="header-center">
          {headerSlot}

          {showSyncFilter && (
            <label className="checkbox-compact">
              <input
                type="checkbox"
                checked={showSyncRequests}
                onChange={(e) => setShowSyncRequests(e.target.checked)}
              />
              /sync
            </label>
          )}

          <label className="checkbox-compact">
            <input
              type="checkbox"
              checked={showIncomplete}
              onChange={(e) => onShowIncompleteChange(e.target.checked)}
            />
            Incomplete
          </label>

          <div className="stats-compact">
            <span id="shown-count">{displayedRequests.length}</span> / <span id="total-count">{totalCount}</span>
            {(totalUploadBytes > 0 || totalDownloadBytes > 0) && (
              <span style={{ marginLeft: '8px', opacity: 0.8 }}>
                &mdash; ↑ {formatBytes(totalUploadBytes)} / ↓ {formatBytes(totalDownloadBytes)}
              </span>
            )}
          </div>
        </div>

        <div className="header-right">
          {showUriFilter && (
            <SearchInput
              value={uriFilterInput}
              onChange={setUriFilterInput}
              onClear={handleUriFilterClear}
              placeholder="Filter URI..."
              title="Filter requests by URI (case-insensitive substring match)"
              aria-label="Filter requests by URI"
            />
          )}
          <StatusFilterDropdown availableStatusCodes={availableStatusCodes} />
          <TimelineScaleSelector msPerPixel={msPerPixel} />
          <TimeRangeSelector />
        </div>
      </div>

      <div className={styles.timelineContainer}>
        <div className={styles.timelineHeader}>
          <div className={styles.timelineHeaderSticky} ref={stickyHeaderRef}>
            {columns.map((col) => (
              <div
                key={col.id}
                className={`${styles.stickyCol} ${getColumnClass(col.className)}`}
              >
                {col.label}
              </div>
            ))}
          </div>
          <div className={styles.timelineHeaderWaterfall}>
            <WaterfallTimeline
              width={timelineWidth}
              cursorContainerRef={waterfallContainerRef}
              cursorOffsetLeft={0}
            />
          </div>
        </div>

        <div className={styles.scrollContent}>
          <div className={styles.timelineContent}>
            {displayedRequests.length === 0 ? (
              <div className={styles.noData}>{emptyMessage}</div>
            ) : (
              <div className={styles.timelineContentWrapper}>
                {/* Left panel - sticky columns */}
                <div className={styles.timelineRowsLeft} ref={leftPanelRef}>
                  {displayedRequests.map((req) => {
                    const rowKey = getRowKey(req);
                    return (
                    <div
                      key={`sticky-${rowKey}`}
                      data-row-id={`sticky-${rowKey}`}
                      className={`${styles.requestRow} ${openLogViewerIds.has(rowKey) ? styles.selected : ''} ${(expandedRows.has(rowKey) && openLogViewerIds.has(rowKey)) ? styles.expanded : ''} ${!req.status ? styles.incomplete : ''}`}
                      style={{ minHeight: '28px', cursor: 'pointer' }}
                      onMouseEnter={() => handleRowMouseEnter(rowKey)}
                      onMouseLeave={() => handleRowMouseLeave(rowKey)}
                      onClick={() => handleWaterfallRowClick(req)}
                    >
                      <div className={styles.requestRowSticky}>
                        {columns.map((col, i) => {
                          // First column is clickable request ID
                          if (i === 0) {
                            return (
                              <div
                                key={col.id}
                                className={`${styles.requestId} ${styles.clickable} ${styles.stickyCol} ${getColumnClass(col.className)}`}
                                data-testid={`request-id-${req.requestId}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRequestClick(rowKey, req.requestId, req);
                                }}
                              >
                                {col.getValue(req)}
                              </div>
                            );
                          }
                          return (
                            <div
                              key={col.id}
                              className={`${styles.stickyCol} ${getColumnClass(col.className)}`}
                              title={col.getValue(req)}
                            >
                              {col.getValue(req)}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    );
                  })}
                </div>

                {/* Right panel - waterfall */}
                <div className={styles.timelineRowsRight} ref={waterfallContainerRef}>
                  <div style={{ display: 'flex', flexDirection: 'column', width: `${timelineWidth}px` }}>
                    {displayedRequests.map((req) => {
                      const sendLine = rawLogLines.find(l => l.lineNumber === req.sendLineNumber);
                      const reqTime = microsToMs(sendLine?.timestampUs ?? 0);
                      const barLeft = getWaterfallPosition(reqTime, minTime, totalDuration, timelineWidth, msPerPixel);
                      const barWidth = getWaterfallBarWidth(
                        req.requestDurationMs,
                        totalDuration,
                        timelineWidth,
                        msPerPixel
                      );
                      const status = req.status ? req.status : 'Incomplete';
                      const isIncomplete = !req.status;
                      const statusCode = req.status ? req.status.split(' ')[0] : '';
                      const defaultBarColor = isIncomplete ? 'var(--http-incomplete)' : getHttpStatusColor(statusCode);
                      const barColor = getBarColor ? getBarColor(req, defaultBarColor) : defaultBarColor;

                      const rowKey = getRowKey(req);
                      return (
                        <div
                          key={`waterfall-${rowKey}`}
                          data-row-id={`waterfall-${rowKey}`}
                          className={`${styles.requestRow} ${openLogViewerIds.has(rowKey) ? styles.selected : ''} ${(expandedRows.has(rowKey) && openLogViewerIds.has(rowKey)) ? styles.expanded : ''} ${isIncomplete ? styles.incomplete : ''}`}
                          style={{ minHeight: '28px', cursor: 'pointer' }}
                          onMouseEnter={() => handleRowMouseEnter(rowKey)}
                          onMouseLeave={() => handleRowMouseLeave(rowKey)}
                          onClick={() => handleWaterfallRowClick(req)}
                        >
                          <div style={{ position: 'relative', overflow: 'visible' }}>
                            <div
                              className={styles.waterfallItem}
                              style={{
                                left: `${barLeft}px`,
                                position: 'absolute',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                              }}
                            >
                              <div
                                className={styles.waterfallBar}
                                style={{
                                  width: `${barWidth}px`,
                                  background: barColor,
                                }}
                                title={isIncomplete ? 'Incomplete' : status}
                              >
                                {!isIncomplete && renderBarOverlay && renderBarOverlay(req, barWidth, msPerPixel, totalDuration, timelineWidth)}
                              </div>
                              <span className={styles.waterfallDuration} title={isIncomplete ? 'Incomplete' : status}>
                                {isIncomplete ? '...' : statusCode === '200' ? `${req.requestDurationMs}ms` : `${status} - ${req.requestDurationMs}ms`}
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {renderExpandedLogViewer()}
      </div>
    </div>
  );
}
