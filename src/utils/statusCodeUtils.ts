/**
 * Status code utilities for HTTP/sync request filtering.
 */

/** Special key for incomplete requests (no status yet) in the status filter */
export const INCOMPLETE_STATUS_KEY = 'Incomplete';

/** Special key for client-side transport errors (e.g., TimedOut, Connect) in the status filter */
export const CLIENT_ERROR_STATUS_KEY = 'Client Error';

/**
 * Extract unique status codes from an array of requests.
 *
 * Numeric HTTP status codes are sorted ascending; the two synthetic keys
 * (`CLIENT_ERROR_STATUS_KEY`, `INCOMPLETE_STATUS_KEY`) are always appended
 * at the end when at least one matching request is present. This ordering
 * keeps the filter dropdown predictable for users.
 *
 * @param requests - Array of requests with optional `status` (HTTP status code
 *   string, e.g. `"200"`) and `clientError` (transport-level error string) fields.
 * @returns Sorted array of unique status code strings, ready for display in the
 *   status-filter dropdown.
 *
 * @example
 * extractAvailableStatusCodes([
 *   { status: '200' },
 *   { status: '404' },
 *   { clientError: 'TimedOut' },
 *   {},
 * ])
 * // => ['200', '404', 'Client Error', 'Incomplete']
 */
export function extractAvailableStatusCodes(
  requests: Array<{ status?: string; clientError?: string }>
): string[] {
  const codes = new Set<string>();
  let hasIncomplete = false;
  let hasClientError = false;

  requests.forEach((req) => {
    if (req.status) {
      codes.add(req.status);
    } else if (req.clientError) {
      hasClientError = true;
    } else {
      hasIncomplete = true;
    }
  });

  // Sort numeric codes, put special keys at the end
  const sortedCodes = Array.from(codes).sort((a, b) => {
    const numA = parseInt(a, 10);
    const numB = parseInt(b, 10);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.localeCompare(b);
  });

  if (hasClientError) {
    sortedCodes.push(CLIENT_ERROR_STATUS_KEY);
  }

  if (hasIncomplete) {
    sortedCodes.push(INCOMPLETE_STATUS_KEY);
  }

  return sortedCodes;
}
