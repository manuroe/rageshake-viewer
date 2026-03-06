import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DEFAULT_MS_PER_PIXEL } from '../utils/timelineUtils';

/**
 * Parse status param from URL to Set.
 * Returns null if empty/absent (meaning "show all").
 */
export function parseStatusParam(param: string | null): Set<string> | null {
  if (!param) return null;
  const codes = param.split(',').map(s => s.trim()).filter(s => s);
  return codes.length > 0 ? new Set(codes) : null;
}

/**
 * Format status Set to URL param string.
 * Returns null if should be omitted from URL.
 */
function formatStatusParam(status: Set<string> | null): string | null {
  if (status === null || status.size === 0) return null;
  return Array.from(status).join(',');
}

/**
 * Hook for reading and writing URL parameters.
 * This is the single interface for URL parameter manipulation.
 * Components use this to write to URL; App.tsx syncs URL to store.
 */
export function useURLParams() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Read params (with parsing)
  const start = searchParams.get('start');
  const end = searchParams.get('end');
  const scaleParam = searchParams.get('scale');
  let scale: number = DEFAULT_MS_PER_PIXEL;
  if (scaleParam !== null) {
    const parsedScale = parseInt(scaleParam, 10);
    scale = Number.isNaN(parsedScale) || parsedScale <= 0 ? DEFAULT_MS_PER_PIXEL : parsedScale;
  }
  const status = parseStatusParam(searchParams.get('status'));
  const filter = searchParams.get('filter');
  const requestId = searchParams.get('request_id');
  const timeoutParam = searchParams.get('timeout');
  let timeout: number | null = null;
  if (timeoutParam !== null) {
    const parsedTimeout = parseInt(timeoutParam, 10);
    timeout = Number.isNaN(parsedTimeout) ? null : parsedTimeout;
  }

  // Helper to update params while preserving others
  const updateParams = useCallback((updates: Record<string, string | null>) => {
    const newParams = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
    }
    setSearchParams(newParams);
  }, [searchParams, setSearchParams]);

  // Set time filter (start and/or end)
  const setTimeFilter = useCallback((newStart: string | null, newEnd: string | null) => {
    updateParams({
      start: newStart,
      end: newEnd,
    });
  }, [updateParams]);

  // Set timeline scale
  const setScale = useCallback((newScale: number) => {
    updateParams({
      // Omit from URL if default
      scale: newScale === DEFAULT_MS_PER_PIXEL ? null : newScale.toString(),
    });
  }, [updateParams]);

  // Set status filter
  const setStatusFilter = useCallback((newStatus: Set<string> | null) => {
    updateParams({
      status: formatStatusParam(newStatus),
    });
  }, [updateParams]);

  // Set URI filter
  const setUriFilter = useCallback((newFilter: string | null) => {
    updateParams({
      // Omit from URL if empty
      filter: newFilter && newFilter.length > 0 ? newFilter : null,
    });
  }, [updateParams]);

  // Set timeout filter
  const setTimeoutFilter = useCallback((newTimeout: number | null) => {
    updateParams({
      timeout: newTimeout !== null ? newTimeout.toString() : null,
    });
  }, [updateParams]);

  // Set request ID (for auto-select)
  const setRequestId = useCallback((newRequestId: string | null) => {
    updateParams({
      ['request_id']: newRequestId,
    });
  }, [updateParams]);

  return {
    // Read values
    start,
    end,
    scale,
    status,
    filter,
    requestId,
    timeout,
    // Write functions
    setTimeFilter,
    setScale,
    setStatusFilter,
    setUriFilter,
    setRequestId,
    setTimeoutFilter,
  };
}
