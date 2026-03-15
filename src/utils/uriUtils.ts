/**
 * Regex matching the Matrix client-server API path prefix.
 * Captures everything after `/_matrix/client/<version>/`.
 * Handles any API version segment (v3, r0, unstable, stable, etc.).
 */
const MATRIX_CLIENT_PATH_RE = /\/_matrix\/client\/[^/]+\/(.*)/;

/**
 * Extract the relative path from a full URL.
 * e.g., https://example.com/path?query -> /path?query
 */
function extractRelativeUri(uri: string): string {
  try {
    const url = new URL(uri);
    return url.pathname + url.search + url.hash;
  } catch {
    // If not a valid URL, check if it starts with http:// or https://
    const match = uri.match(/^https?:\/\/[^/]+(.*)$/);
    return match ? match[1] || '/' : uri;
  }
}

/**
 * Strip the Matrix homeserver and client-server API path prefix from a URI,
 * returning only the meaningful endpoint path.
 *
 * For non-Matrix URLs falls back to the relative path (scheme+host stripped).
 *
 * @param uri - The full URL string (e.g. from an HTTP request log entry)
 * @returns The endpoint path (e.g. `/keys/query`). Begins with `/` for valid
 *   absolute URLs; returns the input string unchanged when it is not a
 *   recognisable URL (e.g. a raw path or placeholder value).
 *
 * @example
 * stripMatrixClientPath('https://matrix-client.matrix.org/_matrix/client/v3/keys/query')
 * // => '/keys/query'
 *
 * @example
 * stripMatrixClientPath('https://example.org/_matrix/client/unstable/org.matrix.simplified_msc3575/sync')
 * // => '/org.matrix.simplified_msc3575/sync'
 *
 * @example
 * // Non-Matrix URL: strips scheme + host only
 * stripMatrixClientPath('https://example.org/api/v1/resource?foo=bar')
 * // => '/api/v1/resource?foo=bar'
 */
export function stripMatrixClientPath(uri: string): string {
  const match = uri.match(MATRIX_CLIENT_PATH_RE);
  if (match) {
    return '/' + match[1];
  }
  return extractRelativeUri(uri);
}
