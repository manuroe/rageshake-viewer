import { useEffect, useRef } from 'react';
import { useLogStore } from '../stores/logStore';
import type { HttpRequest } from '../types/log.types';

/**
 * Milliseconds to wait after opening a log viewer before the first scroll attempt.
 * The virtual-scroll renderer needs one render cycle to stabilise layout.
 */
const SCROLL_INITIAL_DELAY_MS = 1000;
/** Milliseconds between retries when the scroll panel is not yet mounted in the DOM. */
const SCROLL_MOUNT_RETRY_DELAY_MS = 100;
/**
 * Milliseconds between successive scroll-position verification retries.
 * Chosen to be shorter than the initial delay so the total retry window stays small.
 */
const SCROLL_VERIFY_RETRY_DELAY_MS = 120;
/** Maximum number of scroll-position verification attempts before giving up. */
const SCROLL_MAX_ATTEMPTS = 6;
/** Scroll-position delta (px) below which the target is considered reached. */
const SCROLL_DELTA_THRESHOLD_PX = 4;

/**
 * Hook to handle URL hash `request_id=` parameter for auto-opening and scrolling to a request.
 * Opens the log viewer for the specified request ID and scrolls both panels to center it.
 *
 * @param filteredRequests - The list of filtered requests to search within
 * @param leftPanelRef - Ref to the scrollable left panel for auto-scroll
 * @param onScrollToRequest - Optional callback to scroll the waterfall panel to the request
 */
export function useUrlRequestAutoScroll(
  filteredRequests: HttpRequest[],
  leftPanelRef: React.RefObject<HTMLDivElement | null>,
  onScrollToRequest?: (req: HttpRequest) => void
): void {
  const {
    expandedRows,
    openLogViewerIds,
    openLogViewer,
    toggleRowExpansion,
    clearUIState,
  } = useLogStore();

  const scrolledIdRef = useRef<string | null>(null);
  /**
   * Tracks all pending `setTimeout` IDs so they can be cancelled when the
   * component unmounts or the effect re-runs, preventing state updates on an
   * already-unmounted component.
   */
  const pendingTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const hash = window.location.hash;
    const match = hash.match(/request_id=([^&]+)/);
    if (match) {
      const reqId = decodeURIComponent(match[1]);
      
      // Only auto-open once per reqId - don't re-open if user manually closed it
      if (scrolledIdRef.current === reqId) {
        return;
      }
      
      const requestIndex = filteredRequests.findIndex(r => r.requestId === reqId);

      if (requestIndex !== -1) {
        scrolledIdRef.current = reqId;

        const matchedReq = filteredRequests[requestIndex];
        const rowKey = (matchedReq.sendLineNumber || matchedReq.responseLineNumber) as number;

        if (!openLogViewerIds.has(rowKey)) {
          openLogViewer(rowKey);
        }
        if (!expandedRows.has(rowKey)) {
          toggleRowExpansion(rowKey);
        }

        const checkAndScroll = () => {
          const leftPanel = leftPanelRef.current;

          if (!leftPanel) {
            // Panel not yet mounted; retry after a short delay.
            const id = setTimeout(checkAndScroll, SCROLL_MOUNT_RETRY_DELAY_MS);
            pendingTimersRef.current.push(id);
            return;
          }

          const measuredRow = leftPanel.querySelector('.request-row') as HTMLElement | null;
          const rowHeight = measuredRow?.offsetHeight ?? 28;
          const panelHeight = leftPanel.clientHeight;
          const maxScroll = Math.max(0, leftPanel.scrollHeight - panelHeight);
          const rowLogicalTop = requestIndex * rowHeight;
          const scrollTarget = rowLogicalTop - (panelHeight / 2) + (rowHeight / 2);
          const clampedTarget = Math.max(0, Math.min(scrollTarget, maxScroll));

          const attemptScroll = (attempt: number) => {
            leftPanel.scrollTo({ top: clampedTarget, behavior: 'auto' });
            const delta = Math.abs(leftPanel.scrollTop - clampedTarget);

            if (delta > SCROLL_DELTA_THRESHOLD_PX && attempt < SCROLL_MAX_ATTEMPTS) {
              const id = setTimeout(() => attemptScroll(attempt + 1), SCROLL_VERIFY_RETRY_DELAY_MS);
              pendingTimersRef.current.push(id);
            }
          };

          attemptScroll(0);
          
          // Also scroll the waterfall panel horizontally to show the request bar
          if (onScrollToRequest && matchedReq) {
            onScrollToRequest(matchedReq);
          }
        };

        // Wait for virtual scrolling to settle before the first scroll attempt.
        const id = setTimeout(checkAndScroll, SCROLL_INITIAL_DELAY_MS);
        pendingTimersRef.current.push(id);
      }
    }
    // Note: No cleanup return here. The scroll-once guard (scrolledIdRef) prevents
    // the timer from being rescheduled on re-runs caused by state changes triggered
    // inside the effect (e.g. openLogViewer updating openLogViewerIds). Cancellation
    // of pending timers on unmount is handled by the dedicated effect below.
  }, [filteredRequests, openLogViewerIds, expandedRows, openLogViewer, toggleRowExpansion, leftPanelRef, onScrollToRequest]);

  // Cancel all pending scroll timers on unmount to prevent state updates after
  // the component has been removed from the tree.
  useEffect(() => {
    return () => {
      pendingTimersRef.current.forEach(clearTimeout);
      pendingTimersRef.current = [];
    };
  }, []);

  // Clear expanded state on unmount (unless there's a request_id parameter to preserve)
  useEffect(() => {
    return () => {
      const hash = window.location.hash;
      const match = hash.match(/request_id=([^&]+)/);
      if (!match) {
        clearUIState();
      }
    };
  }, [clearUIState]);
}
