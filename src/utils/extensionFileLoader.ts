import { gunzipSync } from 'fflate';
import { useLogStore } from '../stores/logStore';
import { decodeTextBytes, isValidGzipHeader } from './fileValidator';
import { parseLogFile } from './logParser';
import { getEntryKind } from './listingEntries';

interface ViewerFetchResponse {
  readonly ok: boolean;
  readonly base64?: string;
  readonly fileName?: string;
  readonly error?: string;
}

interface ExtensionFileLoaderOptions {
  /**
   * Allows callers to suppress store writes when the surrounding effect has
   * been cancelled or unmounted.
   */
  readonly isCancelled?: () => boolean;
}

/**
 * Fetches raw bytes for a listing entry through the extension background worker.
 */
export async function fetchExtensionFileBytes(url: string, fileName: string): Promise<Uint8Array | null> {
  const chromeGlobal = typeof chrome !== 'undefined' ? chrome : undefined;
  if (!chromeGlobal?.runtime?.sendMessage) return null;

  const response = (await chrome.runtime.sendMessage({
    type: 'fetchForViewer',
    url,
    fileName,
  })) as ViewerFetchResponse | undefined;

  if (!response?.ok || !response.base64) {
    return null;
  }

  const binaryString = atob(response.base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let index = 0; index < binaryString.length; index++) {
    bytes[index] = binaryString.charCodeAt(index);
  }
  return bytes;
}

/**
 * Loads a log entry from a remote listing page into `logStore` and returns the target route.
 *
 * Sets `logStore.logFileName` so the viewer header displays the correct filename.
 * This is done here (rather than in each caller) so all callers behave consistently.
 *
 * @example
 * const route = await loadFromExtensionUrl(url, 'console.2026-04-14-09.log.gz');
 * console.log(route); // '/summary'
 */
export async function loadFromExtensionUrl(
  url: string,
  fileName: string,
  options: ExtensionFileLoaderOptions = {}
): Promise<'/summary' | '/logs' | null> {
  const kind = getEntryKind(fileName);
  if (kind === 'other') return null;

  const bytes = await fetchExtensionFileBytes(url, fileName);
  if (!bytes) return null;
  if (options.isCancelled?.()) return null;

  const decoded = isValidGzipHeader(bytes) ? gunzipSync(bytes) : bytes;
  const text = decodeTextBytes(decoded);
  const result = parseLogFile(text);
  if (options.isCancelled?.()) return null;
  const store = useLogStore.getState();
  store.loadLogParserResult(result);
  store.setLogFileName(fileName);
  return kind === 'dated-log' ? '/summary' : '/logs';
}