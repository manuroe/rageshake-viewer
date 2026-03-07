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
 * e.g.:
 *   https://matrix-client.matrix.org/_matrix/client/v3/keys/query  -> /keys/query
 *   https://example.org/_matrix/client/unstable/org.matrix.simplified_msc3575/sync -> /org.matrix.simplified_msc3575/sync
 *
 * For non-Matrix URLs falls back to the relative path (scheme+host stripped).
 */
export function stripMatrixClientPath(uri: string): string {
  const match = uri.match(MATRIX_CLIENT_PATH_RE);
  if (match) {
    return '/' + match[1];
  }
  return extractRelativeUri(uri);
}
