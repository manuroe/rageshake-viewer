/**
 * Content script injected on rageshake server listing pages
 * (https://github.com/matrix-org/rageshake — any deployment, not just a specific host).
 *
 * Replaces the `.log.gz` anchors in the `<pre>` listing block with a single
 * aligned summary table. Each row shows the filename, log-level counts,
 * HTTP statistics, and a status-code breakdown — columns stay aligned across
 * all rows. Summaries are fetched in reverse order (newest files first) with a
 * concurrency limit of 3 to avoid overloading the server.
 *
 * An "Open in Visualizer" button in the File column (`rs-name-btn`) triggers
 * `fetchAndStore` in the background worker, then opens the bundled viewer page
 * with the file key as a query parameter so `useExtensionFile` can load it
 * automatically.
 */

import type { LogSummary } from './summarize';
import { formatBytes } from '../../src/utils/sizeUtils';

// ── Theme detection ──────────────────────────────────────────────────────────

/**
 * Sets `data-rs-theme="dark"` on `<html>` when dark mode should be active so
 * `content.css` can apply dark styles via attribute selector.
 *
 * Two-phase approach for reliability across browsers:
 * 1. Synchronous — read OS preference via `matchMedia`. Instant and works even
 *    if storage is unavailable (e.g. Firefox content-script sandbox edge cases).
 * 2. Async — refine with the explicit user preference stored in
 *    `chrome.storage.local` by the viewer (`themeStore`). This overrides the
 *    OS default when the user has explicitly chosen light or dark.
 */
async function applyTheme(): Promise<void> {
  // Phase 1: immediate, synchronous — covers system preference and all cases
  // where storage is unavailable (Firefox strict sandbox, first-ever run, etc.)
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (systemDark) {
    document.documentElement.setAttribute('data-rs-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-rs-theme');
  }

  // Phase 2: override with explicit user preference from extension storage
  try {
    const result = await chrome.storage.local.get('rs-theme');
    const storedTheme = result['rs-theme'];
    if (storedTheme === 'dark') {
      document.documentElement.setAttribute('data-rs-theme', 'dark');
    } else if (storedTheme === 'light') {
      document.documentElement.removeAttribute('data-rs-theme');
    }
    // 'system' or missing key: phase 1 result stands
  } catch {
    // storage API unavailable — phase 1 (OS preference) remains in effect
  }
}

// ── Storage key helpers ────────────────────────────────────────────────────

const KEY_PREFIX = 'rs_log_';
const NUMERIC_STATUS_CODE_PATTERN = /^\d+$/;
let keyCounter = 0;

/** Generate a unique storage key for a log file hand-off. */
function nextStorageKey(): string {
  return `${KEY_PREFIX}${Date.now()}_${keyCounter++}`;
}

// ── DOM helpers ────────────────────────────────────────────────────────────

/** Create an element with class names and optional inner text. */
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  classNames: string[],
  text?: string
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = classNames.join(' ');
  if (text !== undefined) e.textContent = text;
  return e;
}

// ── Column definitions ──────────────────────────────────────────────────────

/** Static column metadata used to build the table header and loading colspan. */
const COLUMNS: ReadonlyArray<{ readonly label: string; readonly className: string }> = [
  { label: 'File',     className: 'rs-col--name'   },
  { label: 'Lines',    className: 'rs-col--num'    },
  { label: 'Sentry',   className: 'rs-col--num'    },
  { label: 'Errors',   className: 'rs-col--num'    },
  { label: 'Warnings', className: 'rs-col--num'    },
  { label: 'Requests', className: 'rs-col--num'    },
  { label: 'Upload',   className: 'rs-col--num'    },
  { label: 'Download', className: 'rs-col--num'    },
  { label: 'Status',   className: 'rs-col--status' },
];

/** Number of data columns after the File column. */
const DATA_COL_COUNT = COLUMNS.length - 1;

// ── Table / row building ───────────────────────────────────────────────

/**
 * Build the `<table>` skeleton with a typed header row.
 * Returns `{ table, tbody }` so the caller can append rows to `tbody`.
 */
function buildTable(): { table: HTMLTableElement; tbody: HTMLTableSectionElement } {
  const table = el('table', ['rs-table']);
  const thead = el('thead', []);
  const headerRow = el('tr', []);
  for (const col of COLUMNS) {
    headerRow.appendChild(el('th', [col.className], col.label));
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);
  const tbody = el('tbody', []);
  table.appendChild(tbody);
  return { table, tbody };
}

/**
 * Build a loading row for a single log file entry.
 *
 * @param anchor - The original `<a>` element from the listing.
 */
function buildRow(anchor: HTMLAnchorElement): HTMLTableRowElement {
  const row = el('tr', ['rs-row']);

  // File name cell — clicking opens the log in the Visualizer
  const nameCell = el('td', ['rs-col--name']);
  const filename = (anchor.textContent ?? anchor.href.split('/').pop() ?? anchor.href).trim();
  const nameBtn = el('button', ['rs-name-btn'], filename);
  nameBtn.setAttribute('aria-label', `Open ${filename} in Visualizer`);
  nameBtn.addEventListener('click', () => {
    void handleOpenInVisualizer(anchor.href, nameBtn);
  });
  nameCell.appendChild(nameBtn);

  const rawLink = el('a', ['rs-raw-link'], '(raw)');
  rawLink.setAttribute('href', anchor.href);
  rawLink.setAttribute('target', '_blank');
  rawLink.setAttribute('rel', 'noopener noreferrer');
  nameCell.appendChild(rawLink);

  row.appendChild(nameCell);

  // Loading placeholder spanning all data columns
  const loadingCell = el('td', ['rs-loading'], 'analysing…');
  loadingCell.colSpan = DATA_COL_COUNT;
  row.appendChild(loadingCell);

  return row;
}

/** Fill in the data cells for a loaded row. */
function renderSummary(row: HTMLTableRowElement, summary: LogSummary): void {
  row.querySelector('.rs-loading')?.remove();

  // Lines — always shown, no color
  row.appendChild(numCell(String(summary.totalLines)));

  // Sentry, Errors, Warnings — colored when non-zero, muted dash when zero
  row.appendChild(
    numCell(
      summary.sentryCount > 0 ? String(summary.sentryCount) : '—',
      summary.sentryCount > 0 ? 'rs-s--sentry' : 'rs-muted'
    )
  );
  row.appendChild(
    numCell(
      summary.errorCount > 0 ? String(summary.errorCount) : '—',
      summary.errorCount > 0 ? 'rs-s--error' : 'rs-muted'
    )
  );
  row.appendChild(
    numCell(
      summary.warnCount > 0 ? String(summary.warnCount) : '—',
      summary.warnCount > 0 ? 'rs-s--warn' : 'rs-muted'
    )
  );
  
  // HTTP columns — muted dash when no requests
  row.appendChild(
    numCell(
      summary.httpCount > 0 ? String(summary.httpCount) : '—',
      summary.httpCount === 0 ? 'rs-muted' : undefined
    )
  );
  row.appendChild(
    numCell(
      summary.totalUploadBytes > 0 ? formatBytes(summary.totalUploadBytes) : '—',
      summary.totalUploadBytes === 0 ? 'rs-muted' : undefined
    )
  );
  row.appendChild(
    numCell(
      summary.totalDownloadBytes > 0 ? formatBytes(summary.totalDownloadBytes) : '—',
      summary.totalDownloadBytes === 0 ? 'rs-muted' : undefined
    )
  );

  // Status codes cell
  const statusCell = el('td', ['rs-col--status']);
  const sortedCodes = Object.entries(summary.statusCodes).sort((a, b) => {
    const aNum = parseInt(a[0], 10);
    const bNum = parseInt(b[0], 10);
    if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
    if (!isNaN(aNum)) return -1;
    if (!isNaN(bNum)) return 1;
    return a[0].localeCompare(b[0]);
  });
  for (const [code, count] of sortedCodes) {
    statusCell.appendChild(statusEntry(code, count));
  }
  row.appendChild(statusCell);
}

/** Render an error message spanning all data columns. */
function renderError(row: HTMLTableRowElement, message: string): void {
  row.querySelector('.rs-loading')?.remove();
  const errorCell = el('td', ['rs-error'], `⚠ ${message}`);
  errorCell.colSpan = DATA_COL_COUNT;
  row.appendChild(errorCell);
}

/** Create a `<td>` for a numeric data column, with optional extra class. */
function numCell(text: string, extraClass?: string): HTMLTableCellElement {
  return el('td', ['rs-col--num', ...(extraClass ? [extraClass] : [])], text);
}

/** Build a single status entry with separately aligned code and count segments. */
function statusEntry(code: string, count: number): HTMLSpanElement {
  const isNumericStatusCode = NUMERIC_STATUS_CODE_PATTERN.test(code);
  const entry = el('span', ['rs-sc', statusChipClass(code), ...(isNumericStatusCode ? ['rs-sc--numeric'] : [])]);
  const codeSpan = el('span', ['rs-sc__code'], code);
  const countSpan = el('span', ['rs-sc__count'], `x${count}`);
  entry.appendChild(codeSpan);
  entry.appendChild(countSpan);
  return entry;
}

/** Map an HTTP status code string to a CSS modifier class for colouring. */
function statusChipClass(code: string): string {
  const n = parseInt(code, 10);
  if (n >= 200 && n < 300) return 'rs-sc--2xx';
  if (n >= 300 && n < 400) return 'rs-sc--3xx';
  if (n >= 400 && n < 500) return 'rs-sc--4xx';
  if (n >= 500) return 'rs-sc--5xx';
  return 'rs-sc--other';
}

// ── Open in Visualizer ──────────────────────────────────────────────────────

async function handleOpenInVisualizer(url: string, nameBtn: HTMLButtonElement): Promise<void> {
  const originalText = nameBtn.textContent ?? '';
  nameBtn.disabled = true;
  nameBtn.textContent = 'Loading…';
  try {
    const key = nextStorageKey();
    const response = await chrome.runtime.sendMessage({ type: 'fetchAndStore', url, key });
    nameBtn.textContent = originalText;
    nameBtn.disabled = false;
    if (!response.ok) return;
    const viewerUrl = chrome.runtime.getURL(`viewer.html#/?extensionFile=${encodeURIComponent(key)}`);
    window.open(viewerUrl, '_blank');
    nameBtn.classList.add('rs-name-btn--visited');
  } catch {
    nameBtn.textContent = originalText;
    nameBtn.disabled = false;
  }
}

// ── Concurrency limiter ────────────────────────────────────────────────────

/**
 * Simple async semaphore — limits how many fetches run concurrently so that
 * the rageshakes server is not overwhelmed.
 */
class Semaphore {
  private readonly limit: number;
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(limit: number) {
    this.limit = limit;
  }

  async acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.running++;
  }

  release(): void {
    this.running--;
    const next = this.queue.shift();
    if (next) next();
  }
}

// ── Main entry point ───────────────────────────────────────────────────────

/**
 * Find all `.log.gz` anchors in the page, replace them with a single aligned
 * summary table, then fetch and populate summaries from newest to oldest.
 */
function enhanceListing(): void {
  const anchors = Array.from(
    document.querySelectorAll<HTMLAnchorElement>('pre a[href$=".log.gz"]')
  );
  if (anchors.length === 0) return;

  const { table, tbody } = buildTable();
  // Insert the table before the first anchor, then remove all original anchors.
  anchors[0].before(table);

  const tasks: Array<{ url: string; row: HTMLTableRowElement }> = [];
  for (const anchor of anchors) {
    const url = anchor.href;
    const row = buildRow(anchor);
    tbody.appendChild(row);
    anchor.remove();
    tasks.push({ url, row });
  }

  // Process newest files first (reverse order, since listing is chronological).
  tasks.reverse();

  const sem = new Semaphore(3);

  for (const { url, row } of tasks) {
    void (async () => {
      await sem.acquire();
      try {
        const response: { ok: boolean; summary?: LogSummary; error?: string } =
          await chrome.runtime.sendMessage({ type: 'fetchAndSummarize', url });
        if (response.ok && response.summary) {
          renderSummary(row, response.summary);
        } else {
          renderError(row, response.error ?? 'Failed to summarize');
        }
      } catch (err) {
        renderError(row, err instanceof Error ? err.message : 'Unknown error');
      } finally {
        sem.release();
      }
    })();
  }
}

// Run on page load. The listing page is server-rendered static HTML so
// DOMContentLoaded / document_idle is sufficient.
// Theme is read from chrome.storage async; enhanceListing runs immediately and
// the attribute is patched in once the storage read resolves (~1 ms).
void applyTheme();
enhanceListing();
