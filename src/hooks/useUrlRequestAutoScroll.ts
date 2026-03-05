import { useEffect, useRef } from 'react';
import { useLogStore } from '../stores/logStore';
import type { HttpRequest } from '../types/log.types';

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
  } = useLogStore();

  const scrolledIdRef = useRef<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash;
    const match = hash.match(/request_id=([^&]+)/);
    if (match) {
      const reqId = decodeURIComponent(match[1]);
      
      // Only auto-open once per reqId - don't re-open if user manually closed it
      if (scrolledIdRef.current === reqId) {
        return;
      }
      
      const requestExists = filteredRequests.some(r => r.requestId === reqId);

      if (requestExists) {
        scrolledIdRef.current = reqId;
        
        const matchedReq = filteredRequests.find(r => r.requestId === reqId);
        const rowKey = (matchedReq?.sendLineNumber || matchedReq?.responseLineNumber) as number;

        if (!openLogViewerIds.has(rowKey)) {
          openLogViewer(rowKey);
        }
        if (!expandedRows.has(rowKey)) {
          toggleRowExpansion(rowKey);
        }

        const requestIndex = filteredRequests.findIndex(r => r.requestId === reqId);

        const checkAndScroll = () => {
          const leftPanel = leftPanelRef.current;

          if (!leftPanel) {
            setTimeout(checkAndScroll, 100);
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

            if (delta > 4 && attempt < 6) {
              setTimeout(() => attemptScroll(attempt + 1), 120);
            }
          };

          attemptScroll(0);
          
          // Also scroll the waterfall panel horizontally to show the request bar
          if (onScrollToRequest && matchedReq) {
            onScrollToRequest(matchedReq);
          }
        };

        // Wait for virtual scrolling to settle
        setTimeout(checkAndScroll, 1000);
      }
    }
  }, [filteredRequests, openLogViewerIds, expandedRows, openLogViewer, toggleRowExpansion, leftPanelRef, onScrollToRequest]);

  // Clear expanded state on unmount (unless there's a request_id parameter to preserve)
  useEffect(() => {
    return () => {
      const hash = window.location.hash;
      const match = hash.match(/request_id=([^&]+)/);
      if (!match) {
        // Clear all at once without iteration to prevent infinite loops
        useLogStore.setState({ expandedRows: new Set(), openLogViewerIds: new Set() });
      }
    };
  }, []);
}
