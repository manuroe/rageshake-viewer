import type { ListingEntry } from '../../src/types/listing';

const ANCHOR_PATTERN = /<a\b[^>]*href=(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;

function stripTags(text: string): string {
  return text.replace(/<[^>]*>/g, '').trim();
}

function entryNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.split('/').filter(Boolean).pop() ?? url;
  } catch {
    return url;
  }
}

/**
 * Parses the anchor list emitted by a rageshake `/api/listing/*` HTML page.
 *
 * @example
 * const result = parseListingHtml('<a href="details.json">details.json</a>', 'https://example.com/api/listing/id/');
 * console.log(result.detailsUrl?.endsWith('/details.json')); // true
 */
export function parseListingHtml(
  html: string,
  listingUrl: string,
): { readonly entries: readonly ListingEntry[]; readonly detailsUrl: string | null } {
  const entries: ListingEntry[] = [];
  let detailsUrl: string | null = null;

  let listingOrigin: string;
  try {
    listingOrigin = new URL(listingUrl).origin;
  } catch {
    // listingUrl is unparseable — return empty results
    return { entries, detailsUrl };
  }

  for (const match of html.matchAll(ANCHOR_PATTERN)) {
    const href = match[1] ?? match[2];
    if (!href) continue;

    let resolvedUrl: string;
    try {
      const resolved = new URL(href, listingUrl);
      // Only allow https: URLs that belong to the same origin as the listing page.
      // This drops javascript:, data:, and any cross-origin links that a compromised
      // listing page might inject.
      if (resolved.protocol !== 'https:' || resolved.origin !== listingOrigin) continue;
      resolvedUrl = resolved.toString();
    } catch {
      continue;
    }

    const label = stripTags(match[3] ?? '');
    const name = label.length > 0 ? label : entryNameFromUrl(resolvedUrl);
    if (!name || name === '../') continue;

    if (name === 'details.json') {
      detailsUrl = resolvedUrl;
    }

    entries.push({ name, url: resolvedUrl });
  }

  return { entries, detailsUrl };
}