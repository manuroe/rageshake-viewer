/**
 * Extension background service worker.
 *
 * Handles two message types:
 *
 * - `fetchAndSummarize` (from content script): Fetches a `.log.gz` URL,
 *   decompresses it via the native `DecompressionStream` API, runs
 *   `summarizeLog`, and replies with the resulting `LogSummary`.
 *
 * - `fetchForViewer` (from the viewer extension page): Fetches the raw
 *   (compressed) gz bytes for a given URL, encodes them as base64, and
 *   returns them directly in the message response — no session storage is
 *   used. This avoids `chrome.storage.session`'s 10 MB quota entirely, which
 *   was the cause of large files (e.g. ≥ 1 MB compressed) silently failing.
 *   The viewer page decodes the base64, decompresses inline, parses the log,
 *   and calls `loadLogParserResult`.
 *
 * Both fetch calls use `credentials: 'include'` so that the user's existing
 * rageshakes session cookies are forwarded — allowing authenticated access to
 * private listing pages without requiring the user to re-authenticate.
 *
 * URL validation: every incoming URL is validated before it is fetched.
 * - `fetchAndSummarize` uses `validateAndNormalizeUrl` (strict same-origin check).
 * - `fetchForViewer` uses `validateViewerFileUrl` (HTTPS + rageshake path check)
 *   and additionally requires the sender to be an extension page (not a
 *   content script), preventing a compromised listing page from coercing the
 *   service worker into fetching arbitrary URLs.
 */

import { summarizeLog } from './summarize';
import type { LogSummary } from './summarize';

// ── Message types ──────────────────────────────────────────────────────────

/** Request the background to fetch, decompress, parse, and summarise a log. */
interface FetchAndSummarizeMessage {
  readonly type: 'fetchAndSummarize';
  readonly url: string;
}

/**
 * Request the background to fetch the file at `url`, encode it as base64,
 * and return it in the message response. Only accepted from extension pages
 * (not content scripts). Used by the viewer's `useExtensionFile` hook.
 */
interface FetchForViewerMessage {
  readonly type: 'fetchForViewer';
  /** Absolute HTTPS URL of the `.log.gz` file to fetch. */
  readonly url: string;
  /** Plain filename extracted from the URL (e.g. `console.log.gz`). */
  readonly fileName: string;
}

type BackgroundMessage = FetchAndSummarizeMessage | FetchForViewerMessage;

/** Successful response for `fetchAndSummarize`. */
interface SummarizeResponse {
  readonly ok: true;
  readonly summary: LogSummary;
}

/** Successful response for `fetchForViewer`. */
interface ViewerFileResponse {
  readonly ok: true;
  readonly base64: string;
  readonly fileName: string;
}

/** Error response for any message type. */
interface ErrorResponse {
  readonly ok: false;
  readonly error: string;
}

type BackgroundResponse = SummarizeResponse | ViewerFileResponse | ErrorResponse;

// ── Helpers ────────────────────────────────────────────────────────────────

const GZIP_MAGIC_BYTE_1 = 0x1f;
const GZIP_MAGIC_BYTE_2 = 0x8b;

function isGzipBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 2 &&
    bytes[0] === GZIP_MAGIC_BYTE_1 &&
    bytes[1] === GZIP_MAGIC_BYTE_2
  );
}

/**
 * Decompress gzip bytes and return plain-text content.
 * Uses the native `DecompressionStream` — no external dependencies needed.
 */
async function decompressGzipBytes(bytes: Uint8Array): Promise<string> {
  const ds = new DecompressionStream('gzip');
  // TypeScript infers `Uint8Array<ArrayBufferLike>` but Blob only accepts
  // `ArrayBufferView<ArrayBuffer>`; the cast is safe in all browser runtimes.
  const decompressedStream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(ds);
  const reader = decompressedStream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8').decode(merged);
}

async function decodeLogTextFromBuffer(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  if (isGzipBytes(bytes)) {
    return decompressGzipBytes(bytes);
  }
  return new TextDecoder('utf-8').decode(bytes);
}

/** Chunk size for `arrayBufferToBase64` — 32 KiB is safely below the
 * ~65 535 argument-count limit that most JS engines impose on `Function.apply`. */
const BASE64_CHUNK_SIZE = 0x8000;

/**
 * Encode an `ArrayBuffer` as a base64 string.
 *
 * Builds a binary string where every code unit is a single byte (0–255)
 * and then passes it to `btoa`. Processing in 32 KiB chunks avoids hitting
 * JS engine argument-count limits for large files.
 *
 * Note: `TextDecoder('latin1')` is intentionally avoided here because browsers
 * treat 'latin1' as Windows-1252, which maps bytes 0x80–0x9F to code points
 * above 255 — causing `btoa` to throw `InvalidCharacterError`.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + BASE64_CHUNK_SIZE) as unknown as number[]);
  }
  return btoa(binary);
}

// ── URL validation ─────────────────────────────────────────────────────────

/**
 * Derive the origin of the sender tab so we can validate that the requested
 * URL is same-origin.  `sender.origin` is preferred (always set for content
 * scripts in MV3); we fall back to parsing `sender.tab.url` for older hosts.
 */
function getSenderOrigin(sender: chrome.runtime.MessageSender): string | null {
  if (sender.origin) return sender.origin;
  const tabUrl = sender.tab?.url;
  if (!tabUrl) return null;
  try {
    return new URL(tabUrl).origin;
  } catch {
    return null;
  }
}

/**
 * Validate that `rawUrl` is a same-origin HTTPS `.log.gz` URL relative to the
 * sender origin, and return a normalised absolute URL string.
 *
 * Rejects non-https protocols, cross-origin requests, and paths that do not
 * end with `.log.gz`. This prevents a compromised listing page from coercing
 * the service worker into making credentialled requests to arbitrary origins.
 *
 * @example
 * // Given: sender.tab.url === 'https://rageshakes.example.com/api/listing/2024/abc'
 * validateAndNormalizeUrl('logs/console.log.gz', sender);
 * // => 'https://rageshakes.example.com/logs/console.log.gz'
 */
function validateAndNormalizeUrl(
  rawUrl: string,
  sender: chrome.runtime.MessageSender,
): string {
  const senderOrigin = getSenderOrigin(sender);
  if (!senderOrigin) throw new Error('Unable to determine sender origin');

  let url: URL;
  try {
    // Allow relative URLs by resolving against the sender origin.
    url = new URL(rawUrl, senderOrigin);
  } catch {
    throw new Error('Invalid URL');
  }

  if (url.protocol !== 'https:') {
    throw new Error('Only https: URLs are allowed');
  }
  if (url.origin !== senderOrigin) {
    throw new Error('Cross-origin URL is not allowed');
  }
  if (!url.pathname.endsWith('.log.gz')) {
    throw new Error('Only .log.gz log URLs are allowed');
  }

  return url.toString();
}

/**
 * Validate a URL supplied by the viewer extension page for `fetchForViewer`.
 *
 * Less strict than `validateAndNormalizeUrl` (no same-origin requirement,
 * since the viewer doesn't have a tab origin to compare against), but still
 * constrains the URL to HTTPS rageshake listing paths ending in `.log.gz`.
 * This prevents a compromised listing page from opening the viewer with an
 * arbitrary URL and coercing the service worker into making credentialled
 * requests to third-party origins.
 *
 * @example
 * validateViewerFileUrl('https://rageshakes.example.com/api/listing/2024/abc/console.log.gz');
 * // => 'https://rageshakes.example.com/api/listing/2024/abc/console.log.gz'
 */
function validateViewerFileUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }
  if (url.protocol !== 'https:') {
    throw new Error('Only https: URLs are allowed');
  }
  if (!url.pathname.endsWith('.log.gz')) {
    throw new Error('Only .log.gz log URLs are allowed');
  }
  if (!url.pathname.startsWith('/api/listing/')) {
    throw new Error('URL must be under /api/listing/');
  }
  return url.toString();
}

// ── Message handler ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: BackgroundMessage, sender, sendResponse: (r: BackgroundResponse) => void) => {
    if (message.type === 'fetchAndSummarize') {
      let validatedUrl: string;
      try {
        validatedUrl = validateAndNormalizeUrl(message.url, sender);
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
        return false;
      }
      void handleFetchAndSummarize(validatedUrl).then(sendResponse).catch((err: unknown) => {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
      // Return true to keep the message channel open for the async response.
      return true;
    }

    if (message.type === 'fetchForViewer') {
      // Only extension pages (not content scripts) may request file content.
      // When viewer.html is open in a tab, Chrome/Firefox sets sender.tab — so
      // we cannot use sender.tab === undefined to detect extension pages.
      // Use chrome.runtime.getURL('') to get the correct extension origin:
      //   Chrome/Edge → 'chrome-extension://<id>/'
      //   Firefox     → 'moz-extension://<id>/'
      // Content scripts have the https:// URL of the page they run in.
      const extensionOrigin = chrome.runtime.getURL('');
      if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(extensionOrigin)) {
        sendResponse({ ok: false, error: 'fetchForViewer is only available from extension pages' });
        return false;
      }
      let validatedUrl: string;
      try {
        validatedUrl = validateViewerFileUrl(message.url);
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
        return false;
      }
      void handleFetchForViewer(validatedUrl, message.fileName).then(sendResponse).catch((err: unknown) => {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
      return true;
    }

    return false;
  }
);

async function handleFetchAndSummarize(url: string): Promise<SummarizeResponse | ErrorResponse> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status} fetching ${url}` };
  }
  const buffer = await response.arrayBuffer();
  const text = await decodeLogTextFromBuffer(buffer);
  const summary = summarizeLog(text);
  return { ok: true, summary };
}

/**
 * Fetch the raw gz bytes for `url` and return them as a base64 string.
 *
 * The file content is returned directly in the message response rather than
 * being stored in `chrome.storage.session`, which avoids the 10 MB session
 * quota limit that caused large log files to silently fail.
 */
async function handleFetchForViewer(url: string, fileName: string): Promise<ViewerFileResponse | ErrorResponse> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status} fetching ${url}` };
  }
  const buffer = await response.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  return { ok: true, base64, fileName };
}
