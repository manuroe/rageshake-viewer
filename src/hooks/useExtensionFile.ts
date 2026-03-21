import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { gunzipSync } from 'fflate';
import { parseLogFile } from '../utils/logParser';
import { decodeTextBytes, isValidGzipHeader } from '../utils/fileValidator';
import { useLogStore } from '../stores/logStore';

/** URL search-param key carrying the `.log.gz` file URL set by the extension content script. */
export const EXTENSION_FILE_URL_PARAM = 'extensionFileUrl';
/** URL search-param key carrying the plain filename set by the extension content script. */
export const EXTENSION_FILE_NAME_PARAM = 'extensionFileName';

/**
 * Detects when the viewer page is opened by the browser extension's
 * "Open in Visualizer" button and automatically loads the corresponding log.
 *
 * ## How it works
 * 1. The extension content script opens `viewer.html#/?extensionFileUrl=<url>&extensionFileName=<name>`.
 * 2. This hook reads the URL from the query params and sends a `fetchForViewer`
 *    message to the background service worker.
 * 3. The background fetches the raw `.log.gz` bytes with `credentials: 'include'`,
 *    encodes them as base64, and returns them via the message response — no
 *    `chrome.storage.session` is used, avoiding the 10 MB quota limit that
 *    caused large files to silently fail.
 * 4. The hook decodes the base64, decompresses with fflate, parses the log,
 *    calls `loadLogParserResult`, and navigates to `/summary`.
 *
 * The hook is a no-op in all non-extension contexts (deployed app, local dev)
 * because it guards on both the presence of `extensionFileUrl` param and the
 * availability of `chrome.runtime.sendMessage`.
 */
export function useExtensionFile(): void {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const loadLogParserResult = useLogStore((state) => state.loadLogParserResult);

  const fileUrl = searchParams.get(EXTENSION_FILE_URL_PARAM);
  let fileNameFromUrl: string | undefined;
  if (fileUrl) {
    try {
      const parsedFileUrl = new URL(fileUrl, window.location.href);
      const lastSegment = parsedFileUrl.pathname.split('/').filter(Boolean).pop();
      fileNameFromUrl = lastSegment ?? undefined;
    } catch {
      // Fallback to the original split-based behaviour if URL parsing fails.
      fileNameFromUrl = fileUrl.split('/').pop() ?? undefined;
    }
  }
  const fileName = searchParams.get(EXTENSION_FILE_NAME_PARAM) ?? fileNameFromUrl ?? 'log.gz';

  useEffect(() => {
    if (!fileUrl) return;

    // Guard: chrome.runtime.sendMessage is only available in extension contexts.
    const chromeGlobal = typeof chrome !== 'undefined' ? chrome : undefined;
    if (!chromeGlobal?.runtime?.sendMessage) {
      console.warn('[useExtensionFile] chrome.runtime.sendMessage not available — bailing out');
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const fetchResponse = (await chrome.runtime.sendMessage({
          type: 'fetchForViewer',
          url: fileUrl,
          fileName,
        })) as { ok: boolean; base64?: string; fileName?: string; error?: string } | undefined;

        if (cancelled) return;

        if (!fetchResponse?.ok) {
          console.error('[useExtensionFile] fetchForViewer failed:', fetchResponse?.error ?? 'no response');
          // Clear the extension params so the landing page falls back to the
          // normal upload UI rather than staying stuck on "Loading…".
          if (!cancelled) {
            const fallbackParams = new URLSearchParams(searchParams);
            fallbackParams.delete(EXTENSION_FILE_URL_PARAM);
            fallbackParams.delete(EXTENSION_FILE_NAME_PARAM);
            void navigate({ pathname: '/', search: fallbackParams.toString() }, { replace: true });
          }
          return;
        }

        const base64 = fetchResponse.base64;
        if (!base64) {
          console.error('[useExtensionFile] fetchForViewer returned ok but without base64 content — bailing out');
          // Mirror the !fetchResponse?.ok path: clear extension params so the
          // landing page falls back to the normal upload UI instead of
          // remaining stuck on "Loading…".
          // Note: no cancelled check needed — we already returned at the
          // `if (cancelled) return;` guard above, so cancelled is false here.
          const fallbackParams = new URLSearchParams(searchParams);
          fallbackParams.delete(EXTENSION_FILE_URL_PARAM);
          fallbackParams.delete(EXTENSION_FILE_NAME_PARAM);
          void navigate({ pathname: '/', search: fallbackParams.toString() }, { replace: true });
          return;
        }

        // Decode base64 → raw bytes. If gzip-compressed, decompress with gunzipSync.
        const binaryStr = atob(base64);
        const rawBytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          rawBytes[i] = binaryStr.charCodeAt(i);
        }
        const decoded = isValidGzipHeader(rawBytes) ? gunzipSync(rawBytes) : rawBytes;
        const text = decodeTextBytes(decoded);

        if (cancelled) return;

        const result = parseLogFile(text);
        loadLogParserResult(result);

        // Remove the extension params from the URL so a refresh doesn't re-trigger.
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete(EXTENSION_FILE_URL_PARAM);
        nextParams.delete(EXTENSION_FILE_NAME_PARAM);
        void navigate(
          { pathname: '/summary', search: nextParams.toString() },
          { replace: true }
        );
      } catch (err) {
        console.error('[useExtensionFile] error loading log from extension:', err);
        // Mirror the fetchForViewer failure behavior: clear extension params and
        // navigate back to the landing page so the user sees the normal upload UI.
        if (!cancelled) {
          const fallbackParams = new URLSearchParams(searchParams);
          fallbackParams.delete(EXTENSION_FILE_URL_PARAM);
          fallbackParams.delete(EXTENSION_FILE_NAME_PARAM);
          void navigate(
            { pathname: '/', search: fallbackParams.toString() },
            { replace: true }
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // fileUrl/fileName are derived from searchParams; listing them directly avoids stale closure.
  }, [fileUrl, fileName]); // eslint-disable-line react-hooks/exhaustive-deps
}
