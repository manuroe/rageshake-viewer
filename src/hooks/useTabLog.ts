import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { parseLogFile } from '../utils/logParser';
import { useLogStore } from '../stores/logStore';
import { loadAndClearTabLog } from '../utils/tabLogUtils';

/** URL search-param key carrying the tab-log UUID stored in localStorage. */
export const TAB_LOG_PARAM = 'tabLog';

/**
 * Detects when the viewer is opened from the "Open in new tab" button on the
 * /logs screen. Reads the UUID from the `tabLog` URL parameter, loads the
 * corresponding log text from localStorage, parses it, feeds it into the
 * store, and removes the `tabLog` param from the URL (preserving all other
 * params such as `filter`, `start`, and `end`).
 *
 * This hook is a no-op when the `tabLog` param is absent.
 */
export function useTabLog(): void {
  const [searchParams, setSearchParams] = useSearchParams();
  const loadLogParserResult = useLogStore((state) => state.loadLogParserResult);

  // Track the last UUID processed so StrictMode double-effects are suppressed
  // while a *different* UUID later in the session is still handled correctly.
  const lastProcessedId = useRef<string | null>(null);

  const tabLogId = searchParams.get(TAB_LOG_PARAM);

  useEffect(() => {
    if (!tabLogId || lastProcessedId.current === tabLogId) return;
    lastProcessedId.current = tabLogId;

    // Always remove the tabLog param — even when the entry is stale/missing —
    // so the URL stays clean and the redirect suppression in App.tsx doesn't linger.
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(TAB_LOG_PARAM);
        return next;
      },
      { replace: true },
    );

    const text = loadAndClearTabLog(tabLogId);
    if (!text) {
      // Stale or missing entry — silently ignore; the empty-state UI will show.
      return;
    }

    const result = parseLogFile(text);
    loadLogParserResult(result);
  }, [tabLogId, loadLogParserResult, setSearchParams]);
}
