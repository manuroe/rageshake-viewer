import { useMemo, useCallback } from 'react';
import { useLogStore } from '../stores/logStore';
import { countRequestsForTimeRange } from '../utils/timeUtils';
import { RequestTable } from '../components/RequestTable';
import type { ColumnDef } from '../components/RequestTable';
import { stripMatrixClientPath } from '../utils/uriUtils';
import { extractAvailableStatusCodes } from '../utils/statusCodeUtils';
import type { HttpRequest } from '../types/log.types';
import { renderTimeoutExceededOverlay } from '../utils/waterfallTimeoutOverlay';
import { getSyncRequestBarColor } from '../utils/syncRequestColors';

/**
 * Column IDs to show when waterfall-focus mode is active.
 * Only the request ID and URI are kept visible; the rest collapse into the URI tooltip.
 */
const WATERFALL_FOCUS_COLUMNS: readonly string[] = ['requestId', 'uri'];

/**
 * HTTP Requests view - displays all HTTP requests in a timeline with waterfall visualization.
 * This is a thin wrapper around RequestTable with HTTP-specific columns and URI prefix stripping.
 */
export function HttpRequestsView() {
  const {
    allHttpRequests,
    allRequests,
    filteredHttpRequests,
    showIncompleteHttp,
    startTime,
    endTime,
    timelineScale,
    rawLogLines,
    getDisplayTime,
    setShowIncompleteHttp,
  } = useLogStore();

  const totalCount = useMemo(
    () => countRequestsForTimeRange(allHttpRequests, rawLogLines, startTime, endTime),
    [allHttpRequests, rawLogLines, startTime, endTime]
  );

  // Compute available status codes from all requests (including Incomplete)
  const availableStatusCodes = useMemo(
    () => extractAvailableStatusCodes(allHttpRequests),
    [allHttpRequests]
  );

  // Define columns for HTTP requests view
  const columns: ColumnDef[] = useMemo(() => [
    {
      id: 'requestId',
      label: 'Request',
      getValue: (req) => req.requestId,
    },
    {
      id: 'uri',
      label: 'URI',
      className: 'uri',
      getValue: (req) => stripMatrixClientPath(req.uri),
    },
    {
      id: 'time',
      label: 'Time',
      className: 'time',
      getValue: (req) => getDisplayTime(req.sendLineNumber),
    },
    {
      id: 'method',
      label: '',
      className: 'method',
      getValue: (req) => req.method,
    },
    {
      id: 'requestSize',
      label: '↑ Size',
      className: 'size',
      getValue: (req) => req.requestSizeString || '-',
    },
    {
      id: 'responseSize',
      label: '↓ Size',
      className: 'size',
      getValue: (req) => req.responseSizeString || '-',
    },
  ], [getDisplayTime]);

  // Timeout lookup by request id (sync metadata is stored in allRequests)
  const timeoutByRequestId = useMemo(() => {
    const map = new Map<string, number>();
    for (const req of allRequests) {
      if (req.timeout !== undefined) {
        map.set(req.requestId, req.timeout);
      }
    }
    return map;
  }, [allRequests]);

  /**
   * Determine the bar color for a request. Returns the sync-specific color for
   * requests that have a timeout entry in the map (catchup vs long-poll hue),
   * otherwise falls back to `defaultColor`.
   */
  const getBarColor = useCallback(
    (req: HttpRequest, defaultColor: string) => {
      const timeout = timeoutByRequestId.get(req.requestId);
      const enriched = timeout !== undefined ? { ...req, timeout } : req;
      return getSyncRequestBarColor(enriched, defaultColor);
    },
    [timeoutByRequestId]
  );

  /**
   * Render timeout-exceeded segment for sync long-poll requests.
   * For requests with timeout metadata, the overflow after timeout is highlighted.
   */
  const renderBarOverlay = useCallback(
    (
      req: HttpRequest,
      barWidthPx: number,
      _msPerPixel: number,
      durationToPixels: (durationMs: number) => number,
    ) => renderTimeoutExceededOverlay(
      req,
      barWidthPx,
      _msPerPixel,
      durationToPixels,
      (request) => timeoutByRequestId.get(request.requestId),
    ),
    [timeoutByRequestId]
  );

  return (
    <RequestTable
      title="HTTP Requests"
      columns={columns}
      filteredRequests={filteredHttpRequests}
      totalCount={totalCount}
      showIncomplete={showIncompleteHttp}
      onShowIncompleteChange={setShowIncompleteHttp}
      msPerPixel={timelineScale}
      availableStatusCodes={availableStatusCodes}
      emptyMessage="No HTTP requests found in log file"
      renderBarOverlay={renderBarOverlay}
      getBarColor={getBarColor}
      focusModeColumnIds={WATERFALL_FOCUS_COLUMNS}
    />
  );
}
