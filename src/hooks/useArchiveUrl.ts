import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useArchiveStore } from '../stores/archiveStore';
import { parseTarGzArchive } from '../utils/tarGzArchive';
import { isAnalyzableEntry } from '../utils/archiveSummary';
import { openMergedEntries } from '../utils/openMergedLogs';

/** URL search-param key carrying the URL of a `.tar.gz` rageshake archive to open. */
export const ARCHIVE_URL_PARAM = 'archive';

/** Display name for the archive store: the URL's last path segment. */
function archiveNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.pathname.split('/').filter(Boolean).pop() ?? url;
  } catch {
    return url.split('/').pop() ?? url;
  }
}

/**
 * Opens a rageshake archive fetched from a URL, with every analyzable log inside
 * it merged into one timeline — the same thing the archive listing's "open all"
 * action does, reachable from a plain link.
 *
 * This is what makes deep links verifiable: a link can carry `line=`, `filter=`
 * and `start=`/`end=` alongside `archive=`, and the recipient lands on the exact
 * log line without dropping the file in by hand. Merging *all* analyzable
 * entries (rather than one file) is deliberate — it reproduces the line
 * numbering the `rageshake` CLI prints, so a number quoted in a report resolves
 * to the same line here.
 *
 * The URL must be same-origin or CORS-readable; a local static server pointed at
 * a case folder is the intended source.
 *
 * The hook is a no-op when the `archive` param is absent.
 */
export function useArchiveUrl(): void {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // The archive being fetched right now, and the last one fetched successfully.
  // Two refs, not one: an in-flight URL must be left alone, while an already
  // loaded one still needs its param dropped (see below). A failed load records
  // nothing, so following the same link again retries it.
  const inFlightUrl = useRef<string | null>(null);
  const loadedUrl = useRef<string | null>(null);

  useEffect(() => {
    const archiveUrl = searchParams.get(ARCHIVE_URL_PARAM);
    if (!archiveUrl) return;

    // Drop the param so a refresh doesn't re-fetch, keeping line/filter/start/end.
    const stripParam = (route: string) => {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete(ARCHIVE_URL_PARAM);
      void navigate({ pathname: route, search: nextParams.toString() }, { replace: true });
    };

    // StrictMode's mount → cleanup → mount, or any unrelated param change while
    // the fetch runs: let the in-flight run finish and navigate.
    if (inFlightUrl.current === archiveUrl) return;

    // A second link into the archive already open — a report cites many lines in
    // one rageshake. Nothing to fetch, but the param still has to go, or
    // `archivePending` in App.tsx keeps the loading screen up forever.
    if (loadedUrl.current === archiveUrl) {
      stripParam('/logs');
      return;
    }

    inFlightUrl.current = archiveUrl;

    // No unmount cancellation on purpose: StrictMode's cleanup would cancel the
    // only in-flight fetch, and the second run returns on the guard above. The
    // async path only writes a store and navigates, so a late finish is harmless.
    void (async () => {
      // Failure lands on the landing page so the user gets the normal upload UI
      // rather than an empty log view with no explanation.
      let route = '/';
      try {
        const response = await fetch(archiveUrl);
        if (!response.ok) throw new Error(`fetch failed with HTTP ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        const entries = parseTarGzArchive(bytes);
        useArchiveStore.getState().loadArchive(archiveNameFromUrl(archiveUrl), entries);

        const names = entries.filter((e) => isAnalyzableEntry(e.name)).map((e) => e.name);
        // Ignore the route openMergedEntries returns: a link carrying `archive=`
        // is pointing at log lines, so /logs is where it has to land.
        if (await openMergedEntries(names) === null) throw new Error('no analyzable logs in archive');
        loadedUrl.current = archiveUrl;
        route = '/logs';
      } catch (err) {
        console.error('[useArchiveUrl] failed to open archive from URL:', archiveUrl, err);
      }
      inFlightUrl.current = null;
      stripParam(route);
    })();
  }, [searchParams, navigate]);
}
