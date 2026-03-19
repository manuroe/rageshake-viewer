/**
 * Extension background service worker.
 *
 * Handles two message types from the content script:
 *
 * - `fetchAndSummarize`: Fetches a `.log.gz` URL, decompresses it via the
 *   native `DecompressionStream` API, runs `summarizeLog`, and replies with
 *   the resulting `LogSummary`.
 *
 * - `fetchAndStore`: Fetches the raw (compressed) gz bytes for a given URL,
 *   encodes them as base64, stores them in `chrome.storage.session` under the
 *   provided key, and replies with `{ ok: true }`. The viewer page later reads
 *   this key via `useExtensionFile`, decodes the base64 bytes, decompresses
 *   the gzip data inline, parses the resulting log text, and calls
 *   `loadLogParserResult` directly — bypassing the file-upload flow.
 *
 * Both fetch calls use `credentials: 'include'` so that the user's existing
 * rageshakes session cookies are forwarded — allowing authenticated access to
 * private listing pages without requiring the user to re-authenticate.
 *
 * URL validation: every incoming URL is validated with `validateAndNormalizeUrl`
 * before it is fetched. Only same-origin `.log.gz` URLs are permitted, which
 * prevents a malicious page from coercing the service-worker into making
 * credentialed requests to arbitrary third-party origins.
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
 * Request the background to fetch raw gz bytes, encode as base64, and store
 * in `chrome.storage.session` under `key`. Used by the "Open in Visualizer"
 * flow: the viewer page retrieves this key and reconstructs a File object.
 */
interface FetchAndStoreMessage {
  readonly type: 'fetchAndStore';
  readonly url: string;
  /** Storage key under which the base64 gz data is stored. */
  readonly key: string;
}

type BackgroundMessage = FetchAndSummarizeMessage | FetchAndStoreMessage;

/** Successful response for `fetchAndSummarize`. */
interface SummarizeResponse {
  readonly ok: true;
  readonly summary: LogSummary;
}

/** Successful response for `fetchAndStore`. */
interface StoreResponse {
  readonly ok: true;
}

/** Error response for any message type. */
interface ErrorResponse {
  readonly ok: false;
  readonly error: string;
}

type BackgroundResponse = SummarizeResponse | StoreResponse | ErrorResponse;

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

/**
 * Encode an `ArrayBuffer` as a base64 string.
 * Uses `TextDecoder('latin1')` which maps byte values 0–255 to the same
 * Unicode code points, giving a string that `btoa` can encode without
 * iterating over individual bytes — and without the `String.fromCharCode`
 * spread that can hit the ~65\u00a0535 max-arguments limit on large files.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return btoa(new TextDecoder('latin1').decode(new Uint8Array(buffer)));
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
 * Validate that `rawUrl` is a same-origin `.log.gz` URL relative to the
 * sender tab, and return a normalised absolute URL string.
 *
 * Rejects non-http(s) protocols, cross-origin requests, and paths that do not
 * end with `.log.gz`. This prevents a compromised listing page from coercing
 * the service worker into making credentialled requests to arbitrary origins.
 *
 * @example
 * validateAndNormalizeUrl('logs/console.log.gz', sender)
 * // => 'https://rageshakes.example.com/api/listing/2024/abc/logs/console.log.gz'
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

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Unsupported URL protocol');
  }
  if (url.origin !== senderOrigin) {
    throw new Error('Cross-origin URL is not allowed');
  }
  if (!url.pathname.endsWith('.log.gz')) {
    throw new Error('Only .log.gz log URLs are allowed');
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
      handleFetchAndSummarize(validatedUrl).then(sendResponse).catch((err: unknown) => {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      });
      // Return true to keep the message channel open for the async response.
      return true;
    }

    if (message.type === 'fetchAndStore') {
      let validatedUrl: string;
      try {
        validatedUrl = validateAndNormalizeUrl(message.url, sender);
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
        return false;
      }
      handleFetchAndStore(validatedUrl, message.key).then(sendResponse).catch((err: unknown) => {
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

async function handleFetchAndStore(url: string, key: string): Promise<StoreResponse | ErrorResponse> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status} fetching ${url}` };
  }
  const buffer = await response.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);
  // Extract plain filename from URL (e.g. "console.2026-03-04-09.log.gz")
  const fileName = url.split('/').pop() ?? 'log.gz';
  await chrome.storage.session.set({ [key]: { base64, fileName } });
  return { ok: true };
}
