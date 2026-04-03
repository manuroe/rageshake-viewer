/**
 * Status code utilities for HTTP/sync request filtering.
 */

/** Special key for incomplete requests (no status yet) in the status filter */
export const INCOMPLETE_STATUS_KEY = 'Incomplete';

/** Special key for client-side transport errors (e.g., TimedOut, Connect) in the status filter */
export const CLIENT_ERROR_STATUS_KEY = 'Client Error';

/**
 * Returns `true` when `s` is a numeric HTTP status code string (e.g. `"200"`).
 *
 * Central predicate used across filter, bar-colour, and summary-stat modules to
 * distinguish numeric status codes from synthetic keys such as `'Incomplete'`
 * and transport-error names such as `'TimedOut'`.
 *
 * @param s - String to test.
 * @returns `true` iff `s` consists entirely of ASCII digits.
 *
 * @example
 * isNumericStatus('200')       // => true
 * isNumericStatus('TimedOut')  // => false
 * isNumericStatus(INCOMPLETE_STATUS_KEY) // => false
 */
export function isNumericStatus(s: string): boolean {
  return /^\d+$/.test(s);
}

/**
 * Extract unique status codes from an array of requests.
 *
 * Numeric HTTP status codes are sorted ascending; the two synthetic keys
 * (`CLIENT_ERROR_STATUS_KEY`, `INCOMPLETE_STATUS_KEY`) are always appended
 * at the end when at least one matching request is present. This ordering
 * keeps the filter dropdown predictable for users.
 *
 * Codes from `attemptOutcomes` are included so that intermediate statuses from
 * retried requests (e.g. 503 on attempt 1 before a successful 200 on attempt 2)
 * appear in the filter even when the final `status` field resolved to a different code.
 *
 * @param requests - Array of requests with optional `status` (HTTP status code
 *   string, e.g. `"200"`), `clientError` (transport-level error string), and
 *   `attemptOutcomes` (intermediate attempt statuses for retried requests).
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
  requests: Array<{ status?: string; clientError?: string; attemptOutcomes?: readonly string[] }>
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
    // Include intermediate attempt statuses (e.g. 503 from a retried request)
    req.attemptOutcomes?.forEach((outcome) => {
      if (isNumericStatus(outcome)) {
        // Numeric-looking strings are HTTP status codes
        codes.add(outcome);
      } else if (outcome === INCOMPLETE_STATUS_KEY) {
        // 'Incomplete' is a placeholder for an unknown intermediate outcome — not a transport failure.
        hasIncomplete = true;
      } else {
        // Non-numeric outcome (e.g. 'TimedOut') is a transport failure — expose the
        // 'Client Error' filter even when the request's final status resolved successfully.
        hasClientError = true;
      }
    });
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
