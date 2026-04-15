/**
 * Zustand store for a remote rageshake listing page loaded through the browser extension.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ArchiveSummary } from '../utils/archiveSummary';
import type { ListingEntry } from '../types/listing';

interface ListingStore {
  /** Absolute URL of the loaded `/api/listing/*` page. */
  listingUrl: string;
  /** All file entries discovered on that page. */
  listingEntries: readonly ListingEntry[];
  /** Per-entry summaries keyed by `ListingEntry.name`. */
  listingSummaries: ReadonlyMap<string, ArchiveSummary>;
  /** Entry names the user has opened in this listing. */
  visitedEntries: ReadonlySet<string>;
  /** Persisted history keyed by listing URL. */
  allVisited: Readonly<Record<string, readonly string[]>>;
  /** Replaces the current listing and clears all computed summaries. */
  loadListing: (listingUrl: string, entries: readonly ListingEntry[]) => void;
  /** Stores the computed summary for a single entry. */
  setListingSummary: (name: string, summary: ArchiveSummary) => void;
  /** Marks an entry as visited for the active listing URL. */
  markVisited: (name: string) => void;
  /** Clears the active listing while preserving persisted visit history. */
  clearListing: () => void;
}

export const useListingStore = create<ListingStore>()(
  persist(
    (set) => ({
      listingUrl: '',
      listingEntries: [],
      listingSummaries: new Map(),
      visitedEntries: new Set(),
      allVisited: {},

      loadListing: (listingUrl, entries) => {
        set((state) => ({
          listingUrl,
          listingEntries: entries,
          listingSummaries: new Map(),
          visitedEntries: new Set(state.allVisited[listingUrl] ?? []),
        }));
      },

      setListingSummary: (name, summary) => {
        set((state) => ({
          listingSummaries: new Map(state.listingSummaries).set(name, summary),
        }));
      },

      markVisited: (name) => {
        set((state) => {
          const current = state.allVisited[state.listingUrl] ?? [];
          if (current.includes(name)) return {};
          const updated = [...current, name];
          return {
            visitedEntries: new Set([...state.visitedEntries, name]),
            allVisited: { ...state.allVisited, [state.listingUrl]: updated },
          };
        });
      },

      clearListing: () => {
        set({
          listingUrl: '',
          listingEntries: [],
          listingSummaries: new Map(),
          visitedEntries: new Set(),
        });
      },
    }),
    {
      name: 'listing-visited-storage',
      partialize: (state) => ({ allVisited: state.allVisited }),
    }
  )
);