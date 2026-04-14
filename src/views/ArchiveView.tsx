/**
 * Lists all files in a loaded rageshake `.tar.gz` archive and allows the user
 * to pick one for analysis by clicking its filename.
 *
 * Columns match what the browser extension shows on rageshake listing pages:
 * File, Lines, Sentry, Errors, Warnings, Requests, Upload, Download, Status codes.
 *
 * Summaries are computed lazily in the background: the table renders immediately
 * with "…" placeholders, then each row fills in as its file is parsed. A
 * `setTimeout(0)` yield between files keeps the main thread responsive during
 * large archives.
 *
 * Entries are sorted most-recent-first by the date embedded in their filename
 * (e.g. `logs.2026-04-12-09.log.gz`). Files without a recognisable date
 * (e.g. `details.json`, `logcat.log.gz`) appear after the dated entries.
 *
 * The archive store is left intact after the user navigates to `/summary`, so
 * pressing Back returns here with all summaries already computed.
 */

import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { decompressSync } from 'fflate';
import { useArchiveStore } from '../stores/archiveStore';
import { useLogStore } from '../stores/logStore';
import { isAnalyzableEntry, computeArchiveSummary, type ArchiveSummary } from '../utils/archiveSummary';
import { decodeTextBytes } from '../utils/fileValidator';
import { parseLogFile } from '../utils/logParser';
import { formatBytes } from '../utils/sizeUtils';
import { BurgerMenu } from '../components/BurgerMenu';
import tableStyles from '../components/Table.module.css';
import styles from './ArchiveView.module.css';

const NUMERIC_CODE_RE = /^\d+$/;

/**
 * Strips the leading directory component from a tar entry path.
 * e.g. `"2026-04-14_ID/logs.log.gz"` → `"logs.log.gz"`
 */
function stripArchivePrefix(name: string): string {
  const slash = name.indexOf('/');
  return slash >= 0 ? name.slice(slash + 1) : name;
}

/**
 * Extracts the date-hour string from a rageshake log filename so that entries
 * can be sorted most-recent-first.
 *
 * Matches patterns like `logs.2026-04-12-09.log.gz` or `console.2026-04-12-09.log`.
 * Only the base filename is examined — the leading directory component
 * (e.g. `2026-04-14_ID/`) is explicitly excluded so that archives whose
 * top-level folder contains a date do not cause every entry to share the same
 * key and produce a random ordering.
 *
 * Returns `null` for entries without a recognisable date; they sort after all
 * dated entries.
 */
function extractDateKey(name: string): string | null {
  // Strip any leading directory prefix before matching so that the archive's
  // top-level folder date (e.g. 2026-04-14_ID/) doesn't pollute all entries.
  const basename = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
  const m = basename.match(/(\d{4}-\d{2}-\d{2}(?:-\d{2})?)/);
  return m ? m[1] : null;
}

/**
 * Extracts the category prefix of a rageshake log filename — the part before
 * the first date segment or extension. Used as the primary sort key so that
 * files of the same type are grouped together.
 *
 * e.g. `"console.2026-04-12-16.log.gz"` → `"console"`
 *      `"logs.2026-04-12-16.log.gz"`    → `"logs"`
 *      `"details.json"`                → `"details"`
 */
function extractCategory(name: string): string {
  const basename = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name;
  // Take everything before the first date-like segment or the first dot
  const m = basename.match(/^([^.]+)/);
  return m ? m[1] : basename;
}

/**
 * Sorts archive entries by category (alphabetically) then most-recent-first by
 * the date embedded in the filename. Entries without a readable date appear at
 * the very bottom (after all dated entries), preserving their original relative
 * order.
 */
function sortEntries<T extends { readonly name: string }>(entries: readonly T[]): readonly T[] {
  return [...entries].sort((a, b) => {
    const da = extractDateKey(a.name);
    const db = extractDateKey(b.name);

    // Undated files always go below all dated files
    if (da && !db) return -1;
    if (!da && db) return 1;

    // Both undated: preserve original order
    if (!da && !db) return 0;

    // Both dated: group by category first, then most-recent-first within group
    const ca = extractCategory(a.name);
    const cb = extractCategory(b.name);
    const catCmp = ca.localeCompare(cb);
    if (catCmp !== 0) return catCmp;

    return db!.localeCompare(da!);
  });
}

/**
 * Classifies a tar entry by how it should be opened:
 * - `dated-log`  — `.log` / `.log.gz` with a `YYYY-MM-DD-HH` datestamp → `/summary`
 * - `plain-log`  — `.log` / `.log.gz` without a datestamp → `/logs`
 * - `other`      — anything else → open natively in the browser
 */
type EntryKind = 'dated-log' | 'plain-log' | 'other';

function getEntryKind(name: string): EntryKind {
  const lower = name.toLowerCase();
  const isLog = lower.endsWith('.log.gz') || lower.endsWith('.log');
  if (!isLog) return 'other';
  return extractDateKey(name) !== null ? 'dated-log' : 'plain-log';
}

/**
 * Returns a best-effort MIME type for non-log tar entries so the browser can
 * handle them appropriately when opened via an object URL.
 */
function getMimeType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gz')) return 'application/gzip';
  if (lower.endsWith('.log') || lower.endsWith('.txt')) return 'text/plain';
  return 'application/octet-stream';
}

/** Renders a row of status-code chips for a summary. */
function StatusChips({ statusCodes }: { readonly statusCodes: Readonly<Record<string, number>> }) {
  const sorted = Object.entries(statusCodes).sort((a, b) => {
    const an = parseInt(a[0], 10);
    const bn = parseInt(b[0], 10);
    if (!isNaN(an) && !isNaN(bn)) return an - bn;
    if (!isNaN(an)) return -1;
    if (!isNaN(bn)) return 1;
    return a[0].localeCompare(b[0]);
  });

  return (
    <span className={styles.statusChips}>
      {sorted.map(([code, count]) => {
        const n = parseInt(code, 10);
        let colorClass = styles.chipOther;
        if (!isNaN(n)) {
          if (n >= 200 && n < 300) colorClass = styles.chip2xx;
          else if (n >= 300 && n < 400) colorClass = styles.chip3xx;
          else if (n >= 400 && n < 500) colorClass = styles.chip4xx;
          else if (n >= 500) colorClass = styles.chip5xx;
        }
        return (
          <span key={code} className={`${styles.chip} ${colorClass} ${NUMERIC_CODE_RE.test(code) ? styles.chipNumeric : ''}`}>
            <span className={styles.chipCode}>{code}</span>
            <span className={styles.chipCount}>×{count}</span>
          </span>
        );
      })}
    </span>
  );
}

/** A single data cell — shows "…" while loading, "—" for non-analyzable, or the value. */
function DataCell({
  summary,
  analyzable,
  children,
  className,
}: {
  readonly summary: ArchiveSummary | undefined;
  readonly analyzable: boolean;
  readonly children?: (s: ArchiveSummary) => React.ReactNode;
  readonly className?: string;
}) {
  if (!analyzable) return <td className={`${tableStyles.tableCell} ${tableStyles.alignRight} ${className ?? ''}`}>—</td>;
  if (!summary) return <td className={`${tableStyles.tableCell} ${tableStyles.alignRight} ${className ?? ''}`}><span className={styles.loadingCell}>…</span></td>;
  return <td className={`${tableStyles.tableCell} ${tableStyles.alignRight} ${className ?? ''}`}>{children?.(summary)}</td>;
}

/**
 * Converts an `mxc://serverName/mediaId` URL to an HTTP thumbnail URL
 * resolved through the given homeserver.
 */
function mxcToThumbnailUrl(homeserver: string, mxcUrl: string): string | null {
  if (!mxcUrl.startsWith('mxc://')) return null;
  const path = mxcUrl.slice('mxc://'.length);
  const slash = path.indexOf('/');
  if (slash < 0) return null;
  const mediaServer = path.slice(0, slash);
  const mediaId = path.slice(slash + 1);
  return `https://${homeserver}/_matrix/media/v3/thumbnail/${mediaServer}/${mediaId}?width=96&height=96&method=crop`;
}

/** Returns the first letter of a Matrix username (the part between @ and :). */
function userInitial(userId: string): string {
  const atIdx = userId.indexOf('@');
  const colonIdx = userId.indexOf(':', atIdx);
  if (atIdx < 0 || colonIdx < 0) return userId[0]?.toUpperCase() ?? '?';
  return userId[atIdx + 1]?.toUpperCase() ?? '?';
}

export function ArchiveView() {
  const navigate = useNavigate();
  const { archiveName, archiveEntries, archiveSummaries, setArchiveSummary, visitedEntries, markVisited } = useArchiveStore();
  const loadLogParserResult = useLogStore((state) => state.loadLogParserResult);

  /** Set to true on unmount to stop the background summary loop. */
  const cancelRef = useRef(false);

  // Redirect to landing when there's no archive loaded (e.g. direct navigation).
  useEffect(() => {
    if (archiveEntries.length === 0) {
      void navigate('/', { replace: true });
    }
  }, [archiveEntries.length, navigate]);

  // Sorted view — most recent first, undated entries at the end.
  const sortedEntries = useMemo(() => sortEntries(archiveEntries), [archiveEntries]);

  /**
   * Selected fields parsed from `details.json` inside the archive.
   * All fields are optional — absent when the file is missing or unparseable.
   */
  const parsedDetails = useMemo(() => {
    const entry = archiveEntries.find((e) => {
      const basename = e.name.includes('/') ? e.name.slice(e.name.lastIndexOf('/') + 1) : e.name;
      return basename === 'details.json';
    });
    if (!entry) return null;
    try {
      const json = JSON.parse(decodeTextBytes(entry.data)) as Record<string, unknown>;
      const data = (typeof json['data'] === 'object' && json['data'] !== null
        ? json['data']
        : {}) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
      return {
        userText: str(json['user_text']),
        userId: str(data['user_id']),
        deviceId: str(data['device_id']),
        deviceKeys: str(data['device_keys']),
        appId: str(data['base_bundle_identifier']) ?? str(data['app_id']),
        version: str(data['Version']),
        sdkSha: str(data['sdk_sha']),
      };
    } catch {
      return null;
    }
  }, [archiveEntries]);

  /** PNG entries extracted from the archive for the gallery card. */
  const pngEntries = useMemo(
    () => archiveEntries.filter((e) => e.name.toLowerCase().endsWith('.png')),
    [archiveEntries]
  );

  /**
   * Matrix profile fetched from the user's homeserver.
   * Populated asynchronously after `parsedDetails.userId` is known.
   * `null` while loading or when no userId is present.
   */
  const [matrixProfile, setMatrixProfile] = useState<{
    readonly displayName: string | null;
    readonly avatarHttpUrl: string | null;
  } | null>(null);

  useEffect(() => {
    const userId = parsedDetails?.userId;
    if (!userId) {
      setMatrixProfile(null);
      return;
    }
    // Extract homeserver from @user:homeserver.tld
    const colonIdx = userId.indexOf(':', 1);
    if (colonIdx < 0) return;
    const homeserver = userId.slice(colonIdx + 1);

    let cancelled = false;
    const fetchProfile = async () => {
      try {
        const response = await fetch(
          `https://${homeserver}/_matrix/client/v3/profile/${encodeURIComponent(userId)}`
        );
        if (!response.ok || cancelled) return;
        const json = await response.json() as Record<string, unknown>;
        const displayName = typeof json['displayname'] === 'string' ? json['displayname'] : null;
        const avatarHttpUrl =
          typeof json['avatar_url'] === 'string'
            ? mxcToThumbnailUrl(homeserver, json['avatar_url'])
            : null;
        if (!cancelled) setMatrixProfile({ displayName, avatarHttpUrl });
      } catch {
        // Network error or CORS — silently skip the profile header
      }
    };
    void fetchProfile();
    return () => { cancelled = true; };
  }, [parsedDetails?.userId]);

  /**
   * Object URLs for PNG entries, created once and revoked on unmount.
   * Keyed by entry name.
   */
  const pngUrls = useMemo(() => {
    return new Map(
      pngEntries.map((e) => {
        const ab = e.data.buffer.slice(e.data.byteOffset, e.data.byteOffset + e.data.byteLength) as ArrayBuffer;
        return [e.name, URL.createObjectURL(new Blob([ab], { type: 'image/png' }))];
      })
    );
  }, [pngEntries]);

  useEffect(() => {
    return () => {
      for (const url of pngUrls.values()) {
        URL.revokeObjectURL(url);
      }
    };
  }, [pngUrls]);

  // Background summary computation: parse one entry at a time, yielding between
  // each via setTimeout(0) so the UI stays responsive.
  useEffect(() => {
    cancelRef.current = false;

    const analyzable = sortedEntries.filter((e) => isAnalyzableEntry(e.name));

    let timeoutId: ReturnType<typeof setTimeout>;

    const processNext = (index: number): void => {
      if (cancelRef.current || index >= analyzable.length) return;

      const entry = analyzable[index];
      // Skip if already computed (e.g. user pressed Back)
      if (!archiveSummaries.has(entry.name)) {
        try {
          const isGz = entry.name.toLowerCase().endsWith('.gz');
          const bytes = isGz ? decompressSync(entry.data) : entry.data;
          const text = decodeTextBytes(bytes);
          const summary = computeArchiveSummary(text);
          setArchiveSummary(entry.name, summary);
        } catch {
          // Decompression or parsing failed — record zeros so the row never stays "…"
          setArchiveSummary(entry.name, {
            totalLines: 0,
            errorCount: 0,
            warnCount: 0,
            sentryCount: 0,
            httpCount: 0,
            totalUploadBytes: 0,
            totalDownloadBytes: 0,
            statusCodes: {},
          });
        }
      }

      timeoutId = setTimeout(() => processNext(index + 1), 0);
    };

    timeoutId = setTimeout(() => processNext(0), 0);

    return () => {
      cancelRef.current = true;
      clearTimeout(timeoutId);
    };
    // archiveSummaries intentionally excluded: we check `.has()` inside the loop
    // to skip already-computed entries, but don't want a new effect per summary update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortedEntries, setArchiveSummary]);

  const handleOpen = useCallback(
    (entryName: string) => {
      const entry = archiveEntries.find((e) => e.name === entryName);
      if (!entry) return;

      const kind = getEntryKind(entryName);

      // Non-log files: hand off to the browser as a native object URL
      if (kind === 'other') {
        let blob: Blob;
        if (entryName.toLowerCase().endsWith('.json')) {
          // Decode, pretty-print, and serve as text so all browsers render it
          // inline rather than downloading it. application/json can trigger a
          // download in some browsers/configurations, text/plain never does.
          try {
            const text = decodeTextBytes(entry.data);
            const formatted = JSON.stringify(JSON.parse(text), null, 2);
            blob = new Blob([formatted], { type: 'text/plain;charset=utf-8' });
          } catch {
            // Malformed JSON — fall back to raw bytes
            blob = new Blob([entry.data.buffer.slice(entry.data.byteOffset, entry.data.byteOffset + entry.data.byteLength) as ArrayBuffer], { type: 'text/plain;charset=utf-8' });
          }
        } else {
          blob = new Blob([entry.data.buffer.slice(entry.data.byteOffset, entry.data.byteOffset + entry.data.byteLength) as ArrayBuffer], { type: getMimeType(entryName) });
        }
        const url = URL.createObjectURL(blob);
        window.location.href = url;
        // Revoke after the browser has had time to read the URL
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }

      // Log files: parse and navigate to the appropriate view
      try {
        const isGz = entry.name.toLowerCase().endsWith('.gz');
        const bytes = isGz ? decompressSync(entry.data) : entry.data;
        const text = decodeTextBytes(bytes);
        const result = parseLogFile(text);
        loadLogParserResult(result);
        markVisited(entryName);
        void navigate(kind === 'dated-log' ? '/summary' : '/logs');
      } catch (err) {
        console.error('Failed to open archive entry:', err);
      }
    },
    [archiveEntries, loadLogParserResult, markVisited, navigate]
  );

  const handleOpenRaw = useCallback(
    (entryName: string) => {
      const entry = archiveEntries.find((e) => e.name === entryName);
      if (!entry) return;
      try {
        const isGz = entry.name.toLowerCase().endsWith('.gz');
        const bytes = isGz ? decompressSync(entry.data) : entry.data;
        const text = decodeTextBytes(bytes);
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        window.location.href = url;
        setTimeout(() => URL.revokeObjectURL(url), 3000);
      } catch (err) {
        console.error('Failed to open raw archive entry:', err);
      }
    },
    [archiveEntries]
  );

  // Don't render until redirect effect has had a chance to fire
  if (archiveEntries.length === 0) {
    return null;
  }

  return (
    <div className="app">
      <div className="header-compact">
        <div className="header-left">
          <BurgerMenu />
          <h1 className="header-title">{archiveName}</h1>
        </div>
        <div className="header-right">
          <span className={styles.entryCount}>{archiveEntries.length} files</span>
        </div>
      </div>
      <div className="content">
      <div className={styles.container}>

      <div className={styles.tableWrapper}>
        <table className={tableStyles.table}>
          <thead className={tableStyles.tableHead}>
            <tr>
              <th className={tableStyles.tableHeadCell}>File</th>
              <th className={`${tableStyles.tableHeadCell} ${tableStyles.alignRight}`}>Lines</th>
              <th className={`${tableStyles.tableHeadCell} ${tableStyles.alignRight}`}>Sentry</th>
              <th className={`${tableStyles.tableHeadCell} ${tableStyles.alignRight}`}>Errors</th>
              <th className={`${tableStyles.tableHeadCell} ${tableStyles.alignRight}`}>Warnings</th>
              <th className={`${tableStyles.tableHeadCell} ${tableStyles.alignRight}`}>Requests</th>
              <th className={`${tableStyles.tableHeadCell} ${tableStyles.alignRight}`}>Upload</th>
              <th className={`${tableStyles.tableHeadCell} ${tableStyles.alignRight}`}>Download</th>
              <th className={tableStyles.tableHeadCell}>Status</th>
            </tr>
          </thead>
          <tbody>
            {sortedEntries.map((entry) => {
              const displayName = stripArchivePrefix(entry.name);
              const summary = archiveSummaries.get(entry.name);
              const analyzable = isAnalyzableEntry(entry.name);
              const kind = getEntryKind(entry.name);
              return (
                <tr key={entry.name} className={tableStyles.tableRowHover}>
                  <td className={tableStyles.tableCell}>
                    <button
                      className={`${styles.fileLink} ${(kind !== 'other' && visitedEntries.has(entry.name)) ? styles.fileLinkVisited : ''} ${kind === 'other' ? styles.fileLinkOther : ''}`}
                      onClick={() => handleOpen(entry.name)}
                      aria-label={`Open ${displayName}`}
                    >
                      {displayName}
                    </button>
                    {kind !== 'other' && (
                      <button
                        className={styles.rawLink}
                        onClick={() => handleOpenRaw(entry.name)}
                        aria-label={`Open raw text of ${displayName}`}
                      >
                        raw
                      </button>
                    )}
                  </td>

                  <DataCell summary={summary} analyzable={analyzable}>
                    {(s) => s.totalLines.toLocaleString()}
                  </DataCell>

                  <DataCell summary={summary} analyzable={analyzable}>
                    {(s) => (
                      <span className={s.sentryCount > 0 ? styles.sentryCount : styles.zeroCount}>
                        {s.sentryCount > 0 ? s.sentryCount.toLocaleString() : '—'}
                      </span>
                    )}
                  </DataCell>

                  <DataCell summary={summary} analyzable={analyzable}>
                    {(s) => (
                      <span className={s.errorCount > 0 ? styles.errorCount : styles.zeroCount}>
                        {s.errorCount > 0 ? s.errorCount.toLocaleString() : '—'}
                      </span>
                    )}
                  </DataCell>

                  <DataCell summary={summary} analyzable={analyzable}>
                    {(s) => (
                      <span className={s.warnCount > 0 ? styles.warnCount : styles.zeroCount}>
                        {s.warnCount > 0 ? s.warnCount.toLocaleString() : '—'}
                      </span>
                    )}
                  </DataCell>

                  <DataCell summary={summary} analyzable={analyzable}>
                    {(s) => (
                      <span className={s.httpCount === 0 ? styles.zeroCount : ''}>
                        {s.httpCount > 0 ? s.httpCount.toLocaleString() : '—'}
                      </span>
                    )}
                  </DataCell>

                  <DataCell summary={summary} analyzable={analyzable}>
                    {(s) => (
                      <span className={s.totalUploadBytes === 0 ? styles.zeroCount : ''}>
                        {s.totalUploadBytes > 0 ? formatBytes(s.totalUploadBytes) : '—'}
                      </span>
                    )}
                  </DataCell>

                  <DataCell summary={summary} analyzable={analyzable}>
                    {(s) => (
                      <span className={s.totalDownloadBytes === 0 ? styles.zeroCount : ''}>
                        {s.totalDownloadBytes > 0 ? formatBytes(s.totalDownloadBytes) : '—'}
                      </span>
                    )}
                  </DataCell>

                  {/* Status codes column — full width, not right-aligned */}
                  {!analyzable ? (
                    <td className={tableStyles.tableCell}>—</td>
                  ) : !summary ? (
                    <td className={tableStyles.tableCell}><span className={styles.loadingCell}>…</span></td>
                  ) : (
                    <td className={tableStyles.tableCell}>
                      <StatusChips statusCodes={summary.statusCodes} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>

      {(pngEntries.length > 0 || parsedDetails) && (
        <div className={styles.container}>
          <div className={styles.bottomRow}>
            {pngEntries.length > 0 && (
              <div className={styles.pngGallery}>
                {pngEntries.map((entry) => {
                  const displayName = stripArchivePrefix(entry.name);
                  const url = pngUrls.get(entry.name);
                  return (
                    <button
                      key={entry.name}
                      className={styles.pngCard}
                      onClick={() => handleOpen(entry.name)}
                      aria-label={`Open ${displayName}`}
                    >
                      <img src={url} alt={displayName} className={styles.pngThumb} />
                      <span className={styles.pngName}>{displayName}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {parsedDetails && (
              <div className={styles.detailsCard}>
                {matrixProfile && (
                  <div className={styles.profileHeader}>
                    <div className={styles.avatarCircle}>
                      {matrixProfile.avatarHttpUrl ? (
                        <img
                          src={matrixProfile.avatarHttpUrl}
                          alt=""
                          className={styles.avatarImg}
                        />
                      ) : (
                        <span className={styles.avatarInitial} aria-hidden="true">
                          {parsedDetails.userId ? userInitial(parsedDetails.userId) : '?'}
                        </span>
                      )}
                    </div>
                    <span className={styles.profileDisplayName}>
                      {matrixProfile.displayName ?? parsedDetails.userId}
                    </span>
                  </div>
                )}
                {parsedDetails.userText && (
                  <p className={styles.userText}>{parsedDetails.userText}</p>
                )}
                <dl className={styles.detailsList}>
                  {parsedDetails.userId && (
                    <>
                      <dt>User</dt>
                      <dd>
                        <a
                          href={`https://matrix.to/#/${encodeURIComponent(parsedDetails.userId)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.detailsLink}
                        >
                          <code>{parsedDetails.userId}</code>
                        </a>
                      </dd>
                    </>
                  )}
                  {parsedDetails.deviceId && (
                    <>
                      <dt>Device ID</dt>
                      <dd><code>{parsedDetails.deviceId}</code></dd>
                    </>
                  )}
                  {parsedDetails.deviceKeys && (
                    <>
                      <dt>Device keys</dt>
                      <dd><code className={styles.deviceKeys}>{parsedDetails.deviceKeys}</code></dd>
                    </>
                  )}
                  {parsedDetails.appId && (
                    <>
                      <dt>App</dt>
                      <dd>
                        <code>{parsedDetails.appId}</code>
                        {parsedDetails.version && (
                          <> - <code>{parsedDetails.version}</code></>
                        )}
                      </dd>
                    </>
                  )}
                  {parsedDetails.sdkSha && (
                    <>
                      <dt>SDK commit</dt>
                      <dd>
                        <a
                          href={`https://github.com/matrix-org/matrix-rust-sdk/commit/${parsedDetails.sdkSha}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.detailsLink}
                        >
                          <code>{parsedDetails.sdkSha}</code>
                        </a>
                      </dd>
                    </>
                  )}
                </dl>
              </div>
            )}
          </div>
        </div>
      )}

      </div>
    </div>
  );
}

