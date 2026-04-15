/**
 * Content script injected on rageshake server listing pages
 * (https://github.com/matrix-org/rageshake — any deployment, not just a specific host).
 *
 * Replaces the entire listing page with the bundled viewer running the
 * `/listing` route, which mirrors the `/archive` view in the main web app —
 * same table, same details panel, same file-navigation flow.
 *
 * The redirect uses `window.location.assign` so that pressing the browser's
 * Back button returns to the native rageshake listing page (the listing stays
 * in history). A `back_forward` navigation-type guard suppresses the redirect
 * when the user arrives on this page via Back or Forward, preventing an
 * infinite redirect loop: the native listing renders, and the extension does
 * not kick in again.
 */

// Guard: skip the redirect when the user navigated here via Back/Forward.
// This prevents an infinite loop: viewer → back → listing → redirect → viewer -> …
const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
const navType = navEntries[0]?.type ?? '';
if (navType !== 'back_forward') {
  const listingUrl = window.location.href;
  const viewerUrl =
    chrome.runtime.getURL('viewer.html') +
    '#/listing?listingUrl=' +
    encodeURIComponent(listingUrl);
  window.location.assign(viewerUrl);
}
