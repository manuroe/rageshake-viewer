import { create } from 'zustand';
import type { HttpRequest, SyncRequest, ParsedLogLine } from '../types/log.types';
import { wrapError, type AppError } from '../utils/errorHandling';
import { DEFAULT_MS_PER_PIXEL } from '../utils/timelineUtils';
import { filterSyncRequests, filterHttpRequests } from '../utils/requestFilters';

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
  
  // Status code filter (null = all enabled, Set = specific codes enabled)
  // Special value 'Incomplete' represents requests without a status
  statusCodeFilter: Set<string> | null;
  
  // URI filter for HTTP requests (null = no filter, string = substring match)
  uriFilter: string | null;
  
  // Global filters (shared across all views)
  startTime: string | null;
  endTime: string | null;
  
  // Timeline scale (shared across waterfall views)
  timelineScale: number;
  
  // UI state
  expandedRows: Set<number>;
  
  // Log display state
  rawLogLines: ParsedLogLine[];
  openLogViewerIds: Set<number>;
  lastRoute: string | null;
  
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
  setUriFilter: (filter: string | null) => void;
  filterHttpRequests: () => void;
  
  // Global actions
  setTimeFilter: (startTime: string | null, endTime: string | null) => void;
  setTimelineScale: (scale: number) => void;
  toggleRowExpansion: (rowKey: number) => void;
  setActiveRequest: (rowKey: number | null) => void; // Opens one request, closes all others; null clears selection
  clearData: () => void;
  
  // Log viewer actions
  openLogViewer: (rowKey: number) => void;
  closeLogViewer: (rowKey: number) => void;

  // Navigation memory
  setLastRoute: (route: string) => void;
  clearLastRoute: () => void;
  
  // Error handling
  setError: (error: AppError | null) => void;
  clearError: () => void;
  
  // Helper to get displayTime by line number
  getDisplayTime: (lineNumber: number) => string;
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
  
  // URI filter (null = no filter)
  uriFilter: null,
  
  // Global filters
  startTime: null,
  endTime: null,
  
  // Timeline scale
  timelineScale: DEFAULT_MS_PER_PIXEL,
  
  // UI state
  expandedRows: new Set(),
  
  rawLogLines: [],
  openLogViewerIds: new Set(),
  lastRoute: null,
  error: null,

  setRequests: (requests, connIds, rawLines) => {
    try {
      const defaultConn = connIds.includes('room-list') ? 'room-list' : connIds[0] || '';
      set({ 
        allRequests: requests, 
        connectionIds: connIds,
        selectedConnId: defaultConn,
        rawLogLines: rawLines,
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
      rawLogLines: rawLines
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

  setUriFilter: (filter) => {
    set({ uriFilter: filter });
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

  toggleRowExpansion: (requestId) => {
    const expandedRows = new Set(get().expandedRows);
    if (expandedRows.has(requestId)) {
      expandedRows.delete(requestId);
    } else {
      expandedRows.add(requestId);
    }
    set({ expandedRows });
  },

  setActiveRequest: (requestId) => {
    if (requestId === null) {
      // Clear all selections
      set({ expandedRows: new Set(), openLogViewerIds: new Set() });
    } else {
      // Atomically close all rows and open the new one
      const expandedRows = new Set([requestId]);
      const openLogViewerIds = new Set([requestId]);
      set({ expandedRows, openLogViewerIds });
    }
  },

  filterRequests: () => {
    const { allRequests, rawLogLines, selectedConnId, showIncomplete, selectedTimeout, statusCodeFilter, startTime, endTime } = get();
    const filtered = filterSyncRequests(allRequests, rawLogLines, {
      selectedConnId,
      showIncomplete,
      selectedTimeout,
      statusCodeFilter,
      startTime,
      endTime,
    });
    set({ filteredRequests: filtered });
  },

  filterHttpRequests: () => {
    const { allHttpRequests, rawLogLines, showIncompleteHttp, statusCodeFilter, uriFilter, startTime, endTime } = get();
    const filtered = filterHttpRequests(allHttpRequests, rawLogLines, {
      showIncompleteHttp,
      statusCodeFilter,
      uriFilter,
      startTime,
      endTime,
    });
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
      uriFilter: null,
      startTime: null,
      endTime: null,
      expandedRows: new Set(),
      rawLogLines: [],
      openLogViewerIds: new Set(),
    });
  },
  
  openLogViewer: (requestId) => {
    const current = new Set(get().openLogViewerIds);
    current.add(requestId);
    set({ openLogViewerIds: current });
  },
  
  closeLogViewer: (requestId) => {
    const current = new Set(get().openLogViewerIds);
    current.delete(requestId);
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
    const { rawLogLines } = get();
    const line = rawLogLines.find(l => l.lineNumber === lineNumber);
    return line?.displayTime || '';
  },
}));
