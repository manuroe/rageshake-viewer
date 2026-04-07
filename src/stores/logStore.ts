/**
 * Central Zustand store for all parsed log data, filters, and UI state.
 *
 * ## Dual `setRequests` / `setHttpRequests` pattern
 *
 * The log parser produces two independent datasets from the same file:
 * sync requests (`SyncRequest[]`) and HTTP requests (`HttpRequest[]`). Each
 * setter receives the **full** `rawLogLines` array because:
 *
 * 1. Parsing and loading can happen through either setter path depending on
 *    caller flow, and `rawLogLines` must be available as soon as request data
 *    is loaded.
 * 2. Both sync and HTTP views need the complete line array for timestamp
 *    lookups and gap navigation — not a subset scoped to their own requests.
 *
 * `loadLogParserResult` populates all parsed datasets atomically: it runs one
 * `set()` for the main data then triggers `filterRequests`/`filterHttpRequests`
 * which each run their own `set()`. Zustand notifies listeners after every
 * `set()`, so intermediate states are briefly visible to store subscribers;
 * React batches the resulting re-renders in the browser, so no temporary UI
 * flicker is expected in practice.
 *
 * ## `statusCodeFilter` semantics
 *
 * `null` means **all status codes are enabled** (no filter applied, show
 * everything). A non-null `Set<string>` means only the listed codes are
 * shown. This "null = all" convention avoids enumerating every possible
 * code upfront; the filter only materialises when the user explicitly
 * restricts to a subset.
 */
import { create } from 'zustand';
import type { HttpRequest, SyncRequest, ParsedLogLine, SentryEvent, LogParserResult, AnonymizationDictionary } from '../types/log.types';
import { wrapError, type AppError } from '../utils/errorHandling';
import { DEFAULT_MS_PER_PIXEL } from '../utils/timelineUtils';
import { filterSyncRequests, filterHttpRequests } from '../utils/requestFilters';
import { buildAnonymizationDictionary, anonymizeLogLine, buildCompiledAnonymizer, buildCompiledUnanonymizer } from '../utils/anonymizeUtils';

/**
 * Mutable token shared between `anonymizeLogs` and `cancelAnonymization` so
 * the async chunked loop can detect a mid-flight cancellation without storing
 * the flag in Zustand (which would trigger spurious re-renders on every write).
 */
let currentCancelToken: { cancelled: boolean } | null = null;

interface LogStore {
  // Sync-specific state
  allRequests: SyncRequest[];
  filteredRequests: SyncRequest[];
  connectionIds: string[];
  selectedConnId: string;
  showIncomplete: boolean;
  /** null = show all timeout values; number = show only requests with that timeout */
  selectedTimeout: number | null;
  
  // HTTP requests state (all requests, not just sync)
  allHttpRequests: HttpRequest[];
  filteredHttpRequests: HttpRequest[];
  showIncompleteHttp: boolean;
  
  /**
   * Controls which status-code buckets are visible in request lists.
   *
   * - `null` — all codes are shown (default; no filtering applied).
   * - `Set<string>` — only requests whose status matches a value in the set
   *   are shown. The set may contain numeric status strings (e.g. `"200"`,
   *   `"404"`) as well as the synthetic keys `INCOMPLETE_STATUS_KEY` and
   *   `CLIENT_ERROR_STATUS_KEY` defined in `statusCodeUtils.ts`.
   *
   * This filter is consumed by both sync-request and HTTP-request filtering.
   *
   * The "null = all enabled" convention avoids enumerating every possible
   * code at store initialisation time.
   */
  statusCodeFilter: Set<string> | null;
  
  // Log content filter for HTTP requests (null = no filter, string = case-insensitive substring match against send/response line rawText)
  logFilter: string | null;
  
  // Global filters (shared across all views)
  startTime: string | null;
  endTime: string | null;
  
  // Timeline scale (shared across waterfall views)
  timelineScale: number;
  
  // UI state
  expandedRows: Set<number>;
  
  // Log display state
  rawLogLines: ParsedLogLine[];
  /** Precomputed index for O(1) line-number → ParsedLogLine lookups. Built once in setRequests/setHttpRequests. */
  lineNumberIndex: Map<number, ParsedLogLine>;
  openLogViewerIds: Set<number>;
  lastRoute: string | null;

  // Detected platform from log content
  detectedPlatform: 'android' | 'ios' | null;

  // Sentry events detected during parsing
  sentryEvents: SentryEvent[];

  // Anonymization state
  /** Whether the currently loaded log is in anonymized form. */
  isAnonymized: boolean;
  /** True while the async anonymization pass is running (large logs only). */
  isAnonymizing: boolean;
  /** Fraction of lines processed so far during an async anonymization (0–1). */
  anonymizingProgress: number;
  /** Bidirectional mapping built when the user anonymizes the log. */
  anonymizationDictionary: AnonymizationDictionary | null;
  /**
   * Backup of the original parsed lines saved before anonymization, so that
   * unanonymizing restores the exact original text without needing a dictionary
   * file upload. `null` when the log was loaded already-anonymized (no backup
   * available).
   */
  originalLogLines: readonly ParsedLogLine[] | null;
  /**
   * Backups of derived request and event arrays saved alongside `originalLogLines`
   * so that unanonymizing restores the exact original URI text on other screens
   * (e.g. `/http_requests`, `/summary`). `null` when no backup is available.
   */
  originalAllRequests: readonly SyncRequest[] | null;
  originalAllHttpRequests: readonly HttpRequest[] | null;
  originalSentryEvents: readonly SentryEvent[] | null;

  // Error state
  error: AppError | null;
  
  // Sync-specific actions
  setRequests: (requests: SyncRequest[], connIds: string[], rawLines: ParsedLogLine[]) => void;
  setSelectedConnId: (connId: string) => void;
  setShowIncomplete: (show: boolean) => void;
  setSelectedTimeout: (timeout: number | null) => void;
  filterRequests: () => void;
  
  // HTTP requests actions
  setHttpRequests: (requests: HttpRequest[], rawLines: ParsedLogLine[]) => void;
  setShowIncompleteHttp: (show: boolean) => void;
  setStatusCodeFilter: (filter: Set<string> | null) => void;
  setLogFilter: (filter: string | null) => void;
  filterHttpRequests: () => void;
  
  // Global actions
  setTimeFilter: (startTime: string | null, endTime: string | null) => void;
  setTimelineScale: (scale: number) => void;
  setSentryEvents: (events: SentryEvent[]) => void;
  toggleRowExpansion: (rowKey: number) => void;
  setActiveRequest: (rowKey: number | null) => void; // Opens one request, closes all others; null clears selection
  clearData: () => void;
  /** Resets ephemeral UI state (expanded rows, open log viewers) without clearing parsed log data. */
  clearUIState: () => void;
  
  // Anonymization actions
  /** Anonymize the currently loaded log in-place, saving a backup. */
  anonymizeLogs: () => void;
  /**
   * Abort an in-progress async anonymization and restore the original state.
   * No-op if no anonymization is running.
   */
  cancelAnonymization: () => void;
  /**
   * Unanonymize the log.
   *
   * When an in-memory backup exists (`originalLogLines` is non-null), the
   * original lines are restored directly. When the log was loaded from an
   * already-anonymized file, `externalDict` (uploaded by the user) is used
   * to reverse-map each line.
   */
  unanonymizeLogs: (externalDict?: AnonymizationDictionary) => void;

  // Log viewer actions
  openLogViewer: (rowKey: number) => void;
  closeLogViewer: (rowKey: number) => void;

  // Navigation memory
  setLastRoute: (route: string) => void;
  clearLastRoute: () => void;
  
  // Error handling
  setError: (error: AppError | null) => void;
  clearError: () => void;

  /**
   * Load all parsed log data. Under the hood this runs three Zustand `set()`
   * calls: (1) main data + derived fields, (2) filteredRequests, (3)
   * filteredHttpRequests. Zustand notifies subscribers after each `set()`;
   * React batches the resulting re-renders so no intermediate UI flicker is
   * expected in a browser context. Use this instead of calling the individual
   * setters manually to avoid setting data without derived filters.
   */
  loadLogParserResult: (result: LogParserResult) => void;
  
  // Helper to get displayTime by line number
  getDisplayTime: (lineNumber: number) => string;
}

/** Build a Map from line number to ParsedLogLine for O(1) lookups. */
function buildLineNumberIndex(rawLines: readonly ParsedLogLine[]): Map<number, ParsedLogLine> {
  const index = new Map<number, ParsedLogLine>();
  for (const line of rawLines) {
    index.set(line.lineNumber, line);
  }
  return index;
}

/** Scan parsed log lines to detect the host platform (Android or iOS). */
function detectPlatform(rawLines: readonly ParsedLogLine[]): 'android' | 'ios' | null {
  const limit = Math.min(rawLines.length, 10000);
  let foundAndroid = false;
  let foundIos = false;
  for (let i = 0; i < limit; i++) {
    const msg = rawLines[i].message;
    if (!foundAndroid && msg.includes('MainActivity')) foundAndroid = true;
    if (!foundIos && /swift/i.test(msg)) foundIos = true;
    if (foundAndroid && foundIos) return null;
  }
  if (foundAndroid) return 'android';
  if (foundIos) return 'ios';
  return null;
}

export const useLogStore = create<LogStore>((set, get) => ({
  // Sync-specific state
  allRequests: [],
  filteredRequests: [],
  connectionIds: [],
  selectedConnId: '',
  showIncomplete: false,
  selectedTimeout: null,
  
  // HTTP requests state
  allHttpRequests: [],
  filteredHttpRequests: [],
  showIncompleteHttp: false,
  
  // Status code filter (null = all enabled)
  statusCodeFilter: null,
  
  // Log content filter (null = no filter)
  logFilter: null,
  
  // Global filters
  startTime: null,
  endTime: null,
  
  timelineScale: DEFAULT_MS_PER_PIXEL,
  
  // UI state
  expandedRows: new Set(),
  
  rawLogLines: [],
  lineNumberIndex: new Map(),
  openLogViewerIds: new Set(),
  lastRoute: null,
  detectedPlatform: null,
  sentryEvents: [],
  isAnonymized: false,
  isAnonymizing: false,
  anonymizingProgress: 0,
  anonymizationDictionary: null,
  originalLogLines: null,
  originalAllRequests: null,
  originalAllHttpRequests: null,
  originalSentryEvents: null,
  error: null,

  setRequests: (requests, connIds, rawLines) => {
    try {
      const defaultConn = connIds.includes('room-list') ? 'room-list' : connIds[0] || '';
      set({ 
        allRequests: requests, 
        connectionIds: connIds,
        selectedConnId: defaultConn,
        rawLogLines: rawLines,
        lineNumberIndex: buildLineNumberIndex(rawLines),
        detectedPlatform: detectPlatform(rawLines),
        error: null
      });
      get().filterRequests();
    } catch (error) {
      const appError = wrapError(error, 'Failed to process log data');
      set({ error: appError });
    }
  },

  setSelectedConnId: (connId) => {
    set({ selectedConnId: connId });
    get().filterRequests();
  },

  setShowIncomplete: (show) => {
    set({ showIncomplete: show });
    get().filterRequests();
  },

  setSelectedTimeout: (timeout) => {
    set({ selectedTimeout: timeout });
    get().filterRequests();
  },
  
  setHttpRequests: (requests, rawLines) => {
    set({ 
      allHttpRequests: requests,
      rawLogLines: rawLines,
      lineNumberIndex: buildLineNumberIndex(rawLines),
      detectedPlatform: detectPlatform(rawLines),
    });
    get().filterHttpRequests();
  },
  
  setShowIncompleteHttp: (show) => {
    set({ showIncompleteHttp: show });
    get().filterHttpRequests();
  },
  
  setStatusCodeFilter: (filter) => {
    set({ statusCodeFilter: filter });
    get().filterHttpRequests();
    get().filterRequests();
  },

  setLogFilter: (filter) => {
    set({ logFilter: filter });
    get().filterHttpRequests();
  },

  setTimeFilter: (startTime, endTime) => {
    set({ startTime, endTime });
    // Re-filter both sync and HTTP requests when time filter changes
    get().filterRequests();
    get().filterHttpRequests();
  },

  setTimelineScale: (scale) => {
    set({ timelineScale: scale });
  },

  setSentryEvents: (events) => {
    set({ sentryEvents: events });
  },

  toggleRowExpansion: (rowKey) => {
    const expandedRows = new Set(get().expandedRows);
    if (expandedRows.has(rowKey)) {
      expandedRows.delete(rowKey);
    } else {
      expandedRows.add(rowKey);
    }
    set({ expandedRows });
  },

  setActiveRequest: (rowKey) => {
    if (rowKey === null) {
      // Clear all selections
      set({ expandedRows: new Set(), openLogViewerIds: new Set() });
    } else {
      // Atomically close all rows and open the new one
      const expandedRows = new Set([rowKey]);
      const openLogViewerIds = new Set([rowKey]);
      set({ expandedRows, openLogViewerIds });
    }
  },

  filterRequests: () => {
    const { allRequests, rawLogLines, lineNumberIndex, selectedConnId, showIncomplete, selectedTimeout, statusCodeFilter, startTime, endTime } = get();
    const filtered = filterSyncRequests(allRequests, rawLogLines, {
      selectedConnId,
      showIncomplete,
      selectedTimeout,
      statusCodeFilter,
      startTime,
      endTime,
    }, lineNumberIndex.size > 0 ? lineNumberIndex : undefined);
    set({ filteredRequests: filtered });
  },

  filterHttpRequests: () => {
    const { allHttpRequests, rawLogLines, lineNumberIndex, showIncompleteHttp, statusCodeFilter, logFilter, startTime, endTime } = get();
    const filtered = filterHttpRequests(allHttpRequests, rawLogLines, {
      showIncompleteHttp,
      statusCodeFilter,
      logFilter,
      startTime,
      endTime,
    }, lineNumberIndex.size > 0 ? lineNumberIndex : undefined);
    set({ filteredHttpRequests: filtered });
  },

  clearData: () => {
    set({
      allRequests: [],
      filteredRequests: [],
      connectionIds: [],
      selectedConnId: '',
      selectedTimeout: null,
      allHttpRequests: [],
      filteredHttpRequests: [],
      statusCodeFilter: null,
      logFilter: null,
      startTime: null,
      endTime: null,
      expandedRows: new Set(),
      rawLogLines: [],
      lineNumberIndex: new Map(),
      openLogViewerIds: new Set(),
      detectedPlatform: null,
      sentryEvents: [],
      isAnonymized: false,
      isAnonymizing: false,
      anonymizingProgress: 0,
      anonymizationDictionary: null,
      originalLogLines: null,
      originalAllRequests: null,
      originalAllHttpRequests: null,
      originalSentryEvents: null,
    });
  },

  anonymizeLogs: () => {
    const { rawLogLines, isAnonymized, isAnonymizing } = get();
    if (isAnonymized || isAnonymizing) return;

    // Small logs are processed synchronously so callers (and tests) can read
    // updated state immediately without awaiting.
    const SYNC_THRESHOLD = 500;
    if (rawLogLines.length <= SYNC_THRESHOLD) {
      const dict = buildAnonymizationDictionary(rawLogLines);
      const apply = buildCompiledAnonymizer(dict);
      const anonymizedLines = rawLogLines.map((l) => anonymizeLogLine(l, dict));
      const newIndex = buildLineNumberIndex(anonymizedLines);
      const { allRequests, allHttpRequests, sentryEvents } = get();
      // Apply anonymizer to derived data shown on other screens (/http_requests, /summary, etc.)
      const anonAllRequests = allRequests.map((r) => ({ ...r, uri: apply(r.uri) }));
      const anonAllHttpRequests = allHttpRequests.map((r) => ({ ...r, uri: apply(r.uri) }));
      const anonSentryEvents = sentryEvents.map((e) => ({ ...e, message: apply(e.message) }));
      set({
        rawLogLines: anonymizedLines,
        lineNumberIndex: newIndex,
        isAnonymized: true,
        anonymizationDictionary: dict,
        originalLogLines: rawLogLines,
        allRequests: anonAllRequests,
        allHttpRequests: anonAllHttpRequests,
        sentryEvents: anonSentryEvents,
        originalAllRequests: allRequests,
        originalAllHttpRequests: allHttpRequests,
        originalSentryEvents: sentryEvents,
      });
      get().filterRequests();
      get().filterHttpRequests();
      return;
    }

    // Large logs: chunk the work across event-loop turns so the browser stays
    // responsive. Fire-and-forget; isAnonymizing guards against double-clicks.
    set({ isAnonymizing: true, anonymizingProgress: 0 });
    const token = { cancelled: false };
    currentCancelToken = token;
    void (async () => {
      try {
        // Yield first so the loading state renders before any heavy work starts.
        await new Promise<void>((r) => setTimeout(r, 0));
        const dict = buildAnonymizationDictionary(rawLogLines);
        // Compile the regex once — reused across all chunks so the pattern is
        // built only once regardless of how many lines are processed.
        const apply = buildCompiledAnonymizer(dict);
        // Yield after dictionary build so the browser can breathe.
        await new Promise<void>((r) => setTimeout(r, 0));
        // Target ~100 ms per chunk. With MATRIX_IDENTIFIER_RE + Map the per-line
        // cost is much lower than the old alternation-regex approach, so 1 000
        // lines is well within budget even on slow hardware.
        const CHUNK_SIZE = 1_000;
        const anonymizedLines: ParsedLogLine[] = [];
        for (let i = 0; i < rawLogLines.length; i += CHUNK_SIZE) {
          // Check for cancellation before each chunk.
          if (token.cancelled) return;
          const end = Math.min(i + CHUNK_SIZE, rawLogLines.length);
          for (let j = i; j < end; j++) {
            const l = rawLogLines[j];
            anonymizedLines.push({
              ...l,
              rawText: apply(l.rawText),
              message: apply(l.message),
              strippedMessage: apply(l.strippedMessage),
              continuationLines: l.continuationLines?.map(apply),
            });
          }
          set({ anonymizingProgress: end / rawLogLines.length });
          // Yield until the next animation frame so the browser paints the
          // updated progress bar before starting the next chunk. Falls back to
          // setTimeout in non-browser environments (e.g. Node test runners).
          await new Promise<void>((r) =>
            typeof requestAnimationFrame !== 'undefined'
              ? requestAnimationFrame(() => r())
              : setTimeout(r, 0)
          );
        }
        if (token.cancelled) return;
        currentCancelToken = null;
        const newIndex = buildLineNumberIndex(anonymizedLines);
        // Apply anonymizer to derived data shown on other screens.
        // Read from get() since allRequests/allHttpRequests/sentryEvents may have
        // been loaded independently from rawLogLines (e.g. via separate setRequests call).
        const { allRequests, allHttpRequests, sentryEvents } = get();
        const anonAllRequests = allRequests.map((r) => ({ ...r, uri: apply(r.uri) }));
        const anonAllHttpRequests = allHttpRequests.map((r) => ({ ...r, uri: apply(r.uri) }));
        const anonSentryEvents = sentryEvents.map((e) => ({ ...e, message: apply(e.message) }));
        set({
          rawLogLines: anonymizedLines,
          lineNumberIndex: newIndex,
          isAnonymized: true,
          isAnonymizing: false,
          anonymizingProgress: 1,
          anonymizationDictionary: dict,
          originalLogLines: rawLogLines,
          allRequests: anonAllRequests,
          allHttpRequests: anonAllHttpRequests,
          sentryEvents: anonSentryEvents,
          originalAllRequests: allRequests,
          originalAllHttpRequests: allHttpRequests,
          originalSentryEvents: sentryEvents,
        });
        get().filterRequests();
        get().filterHttpRequests();
      } catch {
        // Any unexpected error (e.g. regex too complex for V8) must reset
        // isAnonymizing so the UI does not get permanently stuck.
        currentCancelToken = null;
        set({ isAnonymizing: false, anonymizingProgress: 0 });
      }
    })();
  },

  cancelAnonymization: () => {
    if (currentCancelToken) {
      currentCancelToken.cancelled = true;
      currentCancelToken = null;
    }
    set({ isAnonymizing: false, anonymizingProgress: 0 });
  },

  unanonymizeLogs: (externalDict) => {
    const {
      rawLogLines, isAnonymized, originalLogLines, anonymizationDictionary,
      allRequests, allHttpRequests, sentryEvents,
      originalAllRequests, originalAllHttpRequests, originalSentryEvents,
    } = get();
    if (!isAnonymized) return;
    let restoredLines: ParsedLogLine[];
    let restoredAllRequests: SyncRequest[];
    let restoredAllHttpRequests: HttpRequest[];
    let restoredSentryEvents: SentryEvent[];
    if (originalLogLines !== null) {
      // We have a full in-memory backup — restore all originals directly.
      restoredLines = [...originalLogLines];
      restoredAllRequests = [...(originalAllRequests ?? allRequests)];
      restoredAllHttpRequests = [...(originalAllHttpRequests ?? allHttpRequests)];
      restoredSentryEvents = [...(originalSentryEvents ?? sentryEvents)];
    } else {
      // Log was loaded already-anonymized; use the provided (or stored) dict.
      const dict = externalDict ?? anonymizationDictionary;
      if (!dict) return;
      const restore = buildCompiledUnanonymizer(dict);
      restoredLines = rawLogLines.map((l) => ({
        ...l,
        rawText: restore(l.rawText),
        message: restore(l.message),
        strippedMessage: restore(l.strippedMessage),
        continuationLines: l.continuationLines?.map(restore),
      }));
      restoredAllRequests = allRequests.map((r) => ({ ...r, uri: restore(r.uri) }));
      restoredAllHttpRequests = allHttpRequests.map((r) => ({ ...r, uri: restore(r.uri) }));
      restoredSentryEvents = sentryEvents.map((e) => ({ ...e, message: restore(e.message) }));
    }
    const newIndex = buildLineNumberIndex(restoredLines);
    set({
      rawLogLines: restoredLines,
      lineNumberIndex: newIndex,
      isAnonymized: false,
      anonymizationDictionary: null,
      originalLogLines: null,
      allRequests: restoredAllRequests,
      allHttpRequests: restoredAllHttpRequests,
      sentryEvents: restoredSentryEvents,
      originalAllRequests: null,
      originalAllHttpRequests: null,
      originalSentryEvents: null,
    });
    get().filterRequests();
    get().filterHttpRequests();
  },

  clearUIState: () => {
    set({ expandedRows: new Set(), openLogViewerIds: new Set() });
  },
  
  openLogViewer: (rowKey) => {
    const current = new Set(get().openLogViewerIds);
    current.add(rowKey);
    set({ openLogViewerIds: current });
  },
  
  closeLogViewer: (rowKey) => {
    const current = new Set(get().openLogViewerIds);
    current.delete(rowKey);
    set({ openLogViewerIds: current });
  },

  setLastRoute: (route) => {
    set({ lastRoute: route });
  },

  clearLastRoute: () => {
    set({ lastRoute: null });
  },
  
  setError: (error) => {
    set({ error });
  },
  
  clearError: () => {
    set({ error: null });
  },
  
  getDisplayTime: (lineNumber) => {
    return get().lineNumberIndex.get(lineNumber)?.displayTime ?? '';
  },

  loadLogParserResult: (result) => {
    try {
      const lineNumberIndex = buildLineNumberIndex(result.rawLogLines);
      const detectedPlatform = detectPlatform(result.rawLogLines);
      const defaultConn = result.connectionIds.includes('room-list')
        ? 'room-list'
        : result.connectionIds[0] ?? '';
      set({
        allRequests: [...result.requests],
        connectionIds: [...result.connectionIds],
        selectedConnId: defaultConn,
        allHttpRequests: [...result.httpRequests],
        sentryEvents: [...result.sentryEvents],
        rawLogLines: [...result.rawLogLines],
        lineNumberIndex,
        detectedPlatform,
        isAnonymized: result.isAnonymized ?? false,
        anonymizationDictionary: null,
        originalLogLines: null,
        error: null,
      });
      get().filterRequests();
      get().filterHttpRequests();
    } catch (error) {
      const appError = wrapError(error, 'Failed to process log data');
      set({ error: appError });
    }
  },
}));
