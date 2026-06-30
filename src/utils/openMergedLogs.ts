/**
 * Opens one or more log entries — from a loaded archive or a remote extension
 * listing — merged into a single continuous timeline.
 *
 * Resolves each name from whichever source currently holds it: the in-memory
 * archive bytes (`archiveStore`) or, failing that, a remote listing URL fetched
 * through the extension (`listingStore`). Used by `ArchiveView`/`ListingView`
 * multi-select and by the burger-menu "Select logs" action.
 */
import { decompressSync } from 'fflate';
import { useArchiveStore } from '../stores/archiveStore';
import { useListingStore } from '../stores/listingStore';
import { useLogStore } from '../stores/logStore';
import { decodeTextBytes, isValidGzipHeader } from './fileValidator';
import { parseLogFile } from './logParser';
import { fetchExtensionFileBytes } from './extensionFileLoader';
import { extractDateKey, getEntryKind } from './listingEntries';
import type { NamedLogParserResult } from './mergeLogParserResults';

/** Order entries oldest → newest so the merged timeline reads chronologically. */
export function orderChronologically(names: readonly string[]): string[] {
  return [...names].sort((a, b) => (extractDateKey(a) ?? a).localeCompare(extractDateKey(b) ?? b));
}

/** Parse a single entry from whichever source holds it, marking it visited. */
async function parseNamedEntry(name: string): Promise<NamedLogParserResult | null> {
  const archiveStore = useArchiveStore.getState();
  const archiveEntry = archiveStore.archiveEntries.find((e) => e.name === name);
  if (archiveEntry) {
    const bytes = name.toLowerCase().endsWith('.gz') ? decompressSync(archiveEntry.data) : archiveEntry.data;
    archiveStore.markVisited(name);
    return { name, result: parseLogFile(decodeTextBytes(bytes)) };
  }

  // ponytail: re-fetches even already-loaded listing files on each "add"; fine
  // for a handful of hourly files, cache by name if it ever gets heavy.
  const listingStore = useListingStore.getState();
  const listingEntry = listingStore.listingEntries.find((e) => e.name === name);
  if (listingEntry) {
    const bytes = await fetchExtensionFileBytes(listingEntry.url, name);
    if (!bytes) return null;
    const decoded = isValidGzipHeader(bytes) ? decompressSync(bytes) : bytes;
    listingStore.markVisited(name);
    return { name, result: parseLogFile(decodeTextBytes(decoded)) };
  }
  return null;
}

/**
 * Parse the given entries, merge them into one timeline, load them into the
 * log store, and return the target route (or null if nothing loadable).
 */
export async function openMergedEntries(names: readonly string[]): Promise<'/summary' | '/logs' | null> {
  const ordered = orderChronologically(names);
  const settled = await Promise.allSettled(ordered.map((name) => parseNamedEntry(name)));
  const files: NamedLogParserResult[] = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === 'fulfilled') {
      if (r.value) files.push(r.value);
    } else {
      console.error('Failed to open log entry:', ordered[i], r.reason);
    }
  }
  if (files.length === 0) return null;
  useLogStore.getState().loadMergedLogParserResults(files);
  // Choose the route from the first file that actually loaded (files preserves
  // chronological order), not ordered[0] — the earliest requested name may have
  // failed to resolve/parse, leaving a later file as the first loaded one.
  return getEntryKind(files[0].name) === 'dated-log' ? '/summary' : '/logs';
}
