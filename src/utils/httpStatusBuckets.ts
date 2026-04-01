import { getHttpStatusColor } from './httpStatusColors';

/**
 * Synthetic bucket key for Matrix /sync catch-up requests (status 2xx, timeout=0).
 * Separated from plain 2xx so the chart can colour and label them distinctly.
 */
export const SYNC_CATCHUP_KEY = 'sync-catchup';

/**
 * Synthetic bucket key for Matrix /sync long-poll requests (status 2xx, timeout≥30 s).
 * Long-polls are a distinct traffic pattern; giving them their own key makes it
 * easy to see at a glance how many are outstanding at any moment.
 */
export const SYNC_LONGPOLL_KEY = 'sync-longpoll';

/**
 * Synthetic bucket key for client-side errors (e.g. fetch failures before a
 * response is received). These never carry a real HTTP status code.
 */
export const CLIENT_ERROR_KEY = 'client-error';

/**
 * Resolve the chart bucket key for an HTTP request.
 *
 * Matrix /sync requests with a 2xx status are sub-classified by their
 * `timeout` value so the chart can colour them distinctly from regular 2xx
 * responses.  All other requests are keyed by their plain numeric status code
 * (or `'incomplete'` when no response has been received yet).
 *
 * @example
 * getBucketKey({ status: '200', timeout: 0 });     // → 'sync-catchup'
 * getBucketKey({ status: '200', timeout: 30000 });  // → 'sync-longpoll'
 * getBucketKey({ status: '404' });                  // → '404'
 * getBucketKey({ status: '' });                     // → 'incomplete'
 */
export function getBucketKey(req: { readonly status: string; readonly timeout?: number }): string {
  if (req.status === CLIENT_ERROR_KEY) return CLIENT_ERROR_KEY;
  const statusCode = req.status ? req.status.split(' ')[0] : 'incomplete';
  const is2xx = statusCode.startsWith('2');
  if (is2xx && req.timeout !== undefined) {
    if (req.timeout === 0) return SYNC_CATCHUP_KEY;
    if (req.timeout >= 30_000) return SYNC_LONGPOLL_KEY;
  }
  return statusCode;
}

/**
 * Map a chart bucket key to its CSS fill colour.
 *
 * Synthetic sync keys get dedicated CSS variables; all other keys delegate
 * to the standard HTTP-status colour helper.
 *
 * @example
 * getBucketColor('sync-catchup'); // → 'var(--sync-catchup-success)'
 * getBucketColor('200');          // → 'var(--http-200)'
 */
export function getBucketColor(code: string): string {
  if (code === CLIENT_ERROR_KEY) return 'var(--http-client-error)';
  if (code === SYNC_CATCHUP_KEY) return 'var(--sync-catchup-success)';
  if (code === SYNC_LONGPOLL_KEY) return 'var(--sync-longpoll-success)';
  return getHttpStatusColor(code);
}

/**
 * Human-readable label for a chart bucket key, used in tooltips and legends.
 *
 * @example
 * getBucketLabel('sync-catchup'); // → 'sync catchup'
 * getBucketLabel('404');          // → '404'
 */
export function getBucketLabel(code: string): string {
  if (code === CLIENT_ERROR_KEY) return 'Client Error';
  if (code === SYNC_CATCHUP_KEY) return 'sync catchup';
  if (code === SYNC_LONGPOLL_KEY) return 'sync long-poll';
  return code;
}

/**
 * Sort status-code bucket keys into a deterministic stacking order.
 *
 * The order (bottom to top) is designed to put baseline background traffic
 * at the bottom and the most actionable statuses (errors) closer to the top:
 *
 *   sync-catchup → sync-longpoll → 5xx → client-error → 4xx → 3xx → 2xx → incomplete
 *
 * @example
 * sortStatusCodes(['404', '200', 'sync-catchup']);
 * // → ['sync-catchup', '200', '404']
 */
export function sortStatusCodes(codes: string[]): string[] {
  const sortKey = (c: string): number => {
    if (c === SYNC_CATCHUP_KEY) return 0;
    if (c === SYNC_LONGPOLL_KEY) return 1;
    if (c === CLIENT_ERROR_KEY) return 3; // between 5xx (2.x) and 4xx (4.x)
    const n = parseInt(c, 10);
    if (isNaN(n)) return 9999; // incomplete/unknown at top
    if (n >= 500) return 2 + n / 10000; // 5xx: above sync, below client-error
    if (n >= 400) return 4 + n / 10000; // 4xx: above client-error
    if (n >= 300) return 5 + n / 10000; // 3xx
    if (n >= 200) return 6 + n / 10000; // 2xx
    return 7 + n / 10000;               // other
  };
  return [...codes].sort((a, b) => sortKey(a) - sortKey(b));
}
