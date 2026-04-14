/**
 * Zustand store for a currently-loaded rageshake log archive.
 *
 * Separating archive state from `logStore` keeps concerns distinct: this store
 * holds the file listing and per-file summaries, while `logStore` holds the
 * parsed content of whichever individual file the user has chosen to analyse.
 *
 * Typical flow:
 * 1. User drops a `.tar.gz` file → `FileUpload` calls `loadArchive`.
 * 2. `ArchiveView` renders the listing and calls `setArchiveSummary` for each
 *    entry as background parsing completes.
 * 3. User picks a file → `ArchiveView` calls `logStore.loadLogParserResult` and
 *    navigates to `/summary`. The archive store is left intact so the user can
 *    press Back and pick a different file.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ArchiveSummary } from '../utils/archiveSummary';

/** A single file entry carried from the tar archive into the store. */
export interface ArchiveEntry {
  /** Full path as stored in the archive (may include a top-level directory prefix). */
  readonly name: string;
  /**
   * Raw bytes from the tar entry (may be gzip-compressed for `.log.gz` files).
   * Kept in memory so the user can re-analyse any entry without re-reading the
   * archive from disk.
   */
  readonly data: Uint8Array;
}

interface ArchiveStore {
  /** Base filename of the loaded `.tar.gz` (shown in the listing header). */
  archiveName: string;
  /** All file entries extracted from the archive. */
  archiveEntries: readonly ArchiveEntry[];
  /**
   * Per-entry summaries keyed by `ArchiveEntry.name`.
   * Entries appear progressively as background parsing completes.
   * Missing key = not yet computed; `ArchiveSummary` present = ready to render.
   */
  archiveSummaries: ReadonlyMap<string, ArchiveSummary>;
  /**
   * Entry names that the user has opened for analysis, persisted across
   * navigation so the visited style survives Back navigation from `/summary`.
   * This is a fast `Set` derived from `allVisited[archiveName]`; it is NOT
   * persisted directly because `Set` is not JSON-serializable.
   */
  visitedEntries: ReadonlySet<string>;
  /**
   * Persisted backing store for visited entries, keyed by archive filename so
   * that each archive keeps independent history across page reloads.
   * Stored in localStorage via Zustand's `persist` middleware.
   *
   * @example `{ "rageshake-2026-04-14.tar.gz": ["logs.2026-04-14-08.log.gz"] }`
   */
  allVisited: Readonly<Record<string, readonly string[]>>;

  /**
   * Replaces the currently loaded archive with a new one and clears all
   * previously computed summaries.
   */
  loadArchive: (archiveName: string, entries: readonly ArchiveEntry[]) => void;

  /**
   * Stores the computed summary for a single entry.
   * Called by `ArchiveView`'s background effect after parsing each file.
   */
  setArchiveSummary: (name: string, summary: ArchiveSummary) => void;

  /** Records that the user opened an entry so it can be styled as visited. */
  markVisited: (name: string) => void;

  /** Resets the store to its empty state (e.g. when the user navigates away). */
  clearArchive: () => void;
}

export const useArchiveStore = create<ArchiveStore>()(
  persist(
    (set) => ({
      archiveName: '',
      archiveEntries: [],
      archiveSummaries: new Map(),
      visitedEntries: new Set(),
      allVisited: {},

      loadArchive: (archiveName, entries) => {
        set((state) => ({
          archiveName,
          archiveEntries: entries,
          archiveSummaries: new Map(),
          // Restore visited set for this specific archive from persisted history
          visitedEntries: new Set(state.allVisited[archiveName] ?? []),
        }));
      },

      setArchiveSummary: (name, summary) => {
        set((state) => ({
          // Replace the map instance so Zustand detects the change
          archiveSummaries: new Map(state.archiveSummaries).set(name, summary),
        }));
      },

      markVisited: (name) => {
        set((state) => {
          const current = state.allVisited[state.archiveName] ?? [];
          if (current.includes(name)) return {};
          const updated = [...current, name];
          return {
            visitedEntries: new Set([...state.visitedEntries, name]),
            allVisited: { ...state.allVisited, [state.archiveName]: updated },
          };
        });
      },

      clearArchive: () => {
        // allVisited is intentionally kept — visited history survives clearing the active archive
        set({ archiveName: '', archiveEntries: [], archiveSummaries: new Map(), visitedEntries: new Set() });
      },
    }),
    {
      name: 'archive-visited-storage',
      // Only persist the serializable visited history; binary entry data and Map/Set are excluded
      partialize: (state) => ({ allVisited: state.allVisited }),
    }
  )
);
