import { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { gunzipSync } from 'fflate';
import { parseLogFile } from '../utils/logParser';
import { decodeTextBytes, isValidGzipHeader } from '../utils/fileValidator';
import { useLogStore } from '../stores/logStore';

/** URL search-param key used by the extension to pass the storage key. */
const EXTENSION_FILE_PARAM = 'extensionFile';

/**
 * Detects when the viewer page is opened by the browser extension's
 * "Open in Visualizer" button and automatically loads the corresponding log.
 *
 * ## How it works
 * 1. The extension background service worker fetches the raw `.log.gz` bytes
 *    and stores them in `chrome.storage.session` under a generated key.
 * 2. The extension opens `viewer.html#/?extensionFile=<key>`.
 * 3. This hook reads that key from the URL, retrieves the base64-encoded gz
 *    bytes from session storage, decompresses them with fflate (same library
 *    used by FileUpload), parses the log, and calls `loadLogParserResult`
 *    before navigating to `/summary`.
 *
 * The hook is a no-op in all non-extension contexts (deployed app, local dev)
 * because it guards on both the presence of the `extensionFile` param and the
 * availability of `chrome.storage.session`.
 */
export function useExtensionFile(): void {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const loadLogParserResult = useLogStore((state) => state.loadLogParserResult);

  const key = searchParams.get(EXTENSION_FILE_PARAM);

  useEffect(() => {
    if (!key) return;

    // Guard: chrome.storage.session is only available in extension contexts.
    const chromeGlobal = typeof chrome !== 'undefined' ? chrome : undefined;
    const session = chromeGlobal?.storage?.session;
    if (!session) {
      console.warn('[useExtensionFile] chrome.storage.session not available — bailing out');
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const stored = (await session.get(key)) as Record<
          string,
          { base64: string; fileName: string } | undefined
        >;
        const entry = stored[key];
        if (cancelled || !entry) {
          console.warn('[useExtensionFile] entry missing or cancelled');
          return;
        }

        // Fire-and-forget cleanup — free session quota regardless of whether
        // decode/parse succeeds. A rejection here must never block the happy
        // path or surface as an unhandled rejection.
        void session.remove(key).catch(() => {});

        // Decode base64 → raw bytes. If the bytes are gzip-compressed (magic
        // bytes 0x1f 0x8b), decompress with gunzipSync. Otherwise the browser's
        // fetch already transparently decompressed them (Content-Encoding: gzip)
        // and we can decode directly.
        const binaryStr = atob(entry.base64);
        const rawBytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          rawBytes[i] = binaryStr.charCodeAt(i);
        }
        const decoded = isValidGzipHeader(rawBytes) ? gunzipSync(rawBytes) : rawBytes;
        const text = decodeTextBytes(decoded);

        if (cancelled) return;

        const result = parseLogFile(text);
        loadLogParserResult(result);

        // Remove the extensionFile param from the URL so the user sees a clean
        // address and a refresh does not attempt to re-load a gone session entry.
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete(EXTENSION_FILE_PARAM);
        void navigate(
          { pathname: '/summary', search: nextParams.toString() },
          { replace: true }
        );
      } catch (err) {
        console.error('[useExtensionFile] error loading log from extension storage:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
    // key is derived from searchParams; listing it directly avoids stale closure.
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}
