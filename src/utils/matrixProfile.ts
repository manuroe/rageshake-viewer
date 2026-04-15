/**
 * Utilities shared by archive-like views that enrich `details.json` with Matrix profile data.
 *
 * @example
 * const url = mxcToThumbnailUrl('matrix.org', 'mxc://example.com/media');
 * console.log(url?.includes('/_matrix/media/')); // true
 */

const PUBLIC_HOMESERVER_PATTERN = /^[a-zA-Z][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}(?::\d{1,5})?$/;

/**
 * Converts an `mxc://` URI to a homeserver thumbnail URL.
 */
export function mxcToThumbnailUrl(homeserver: string, mxcUrl: string): string | null {
  if (!mxcUrl.startsWith('mxc://')) return null;
  const path = mxcUrl.slice('mxc://'.length);
  const slash = path.indexOf('/');
  if (slash < 0) return null;
  const mediaServer = path.slice(0, slash);
  const mediaId = path.slice(slash + 1);
  return `https://${homeserver}/_matrix/media/v3/thumbnail/${encodeURIComponent(mediaServer)}/${encodeURIComponent(mediaId)}?width=96&height=96&method=crop`;
}

/**
 * Returns the first visible letter of a Matrix user ID.
 */
export function userInitial(userId: string): string {
  const atIndex = userId.indexOf('@');
  const colonIndex = userId.indexOf(':', atIndex);
  if (atIndex < 0 || colonIndex < 0) return userId[0]?.toUpperCase() ?? '?';
  return userId[atIndex + 1]?.toUpperCase() ?? '?';
}

/**
 * Checks that a homeserver looks like a public domain name before fetching from it.
 */
export function isValidPublicHomeserver(homeserver: string): boolean {
  return PUBLIC_HOMESERVER_PATTERN.test(homeserver);
}