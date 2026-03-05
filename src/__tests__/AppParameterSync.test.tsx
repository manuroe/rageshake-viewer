/**
 * Integration tests for App.tsx URL parameter synchronization.
 * Tests the unidirectional sync from URL hash parameters to Zustand application state.
 * 
 * Architecture (URL as source of truth):
 * - URL → Store: App.tsx parses URL params and updates store
 * - Store → URL: Components write directly to URL via useURLParams hook
 * 
 * Coverage includes:
 * - URL → Store: Parsing filter= and request_id= parameters
 * - Parameter encoding/decoding with special characters
 * - Multi-parameter interactions and precedence
 * - Parameter clearing on navigation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { useLogStore } from '../stores/logStore';
import App from '../App';
import { getHashParam } from '../test/uriTestHelpers';
import { createHttpRequest, createHttpRequests, createParsedLogLines } from '../test/fixtures';

// Mock error boundary to prevent test failures from error display
vi.mock('../components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('App.tsx - URL Parameter Synchronization', () => {
  let originalHash: string;

  beforeEach(() => {
    originalHash = window.location.hash;
    useLogStore.getState().clearData();
  });

  afterEach(() => {
    window.location.hash = originalHash;
    vi.clearAllMocks();
  });

  // ============================================================================
  // URL → Store: Parsing filter= and request_id= parameters
  // ============================================================================

  describe('URL → Store: Parsing filter= parameter', () => {
    it('parses filter= parameter from URL on initial load', async () => {
      const requests = createHttpRequests(5);
      const logLines = createParsedLogLines(10);

      useLogStore.getState().setHttpRequests(requests, logLines);
      window.location.hash = '#/http_requests?filter=sync';

      render(<App />);

      await waitFor(() => {
        expect(useLogStore.getState().uriFilter).toBe('sync');
      });
    });

    it('applies filter= parameter on navigation to /http_requests view', async () => {
      const requests = createHttpRequests(10);
      const logLines = createParsedLogLines(15);
      useLogStore.getState().setHttpRequests(requests, logLines);
      
      window.location.hash = '#/http_requests?filter=keys';

      render(<App />);

      await waitFor(() => {
        const state = useLogStore.getState();
        expect(state.uriFilter).toBe('keys');
      });
    });

    it('decodes URL-encoded filter parameter', async () => {
      const requests = createHttpRequests(5);
      const logLines = createParsedLogLines(10);
      useLogStore.getState().setHttpRequests(requests, logLines);

      // URL-encoded: "_matrix/client/r0/sync" with spaces and special chars
      const encodedUri = encodeURIComponent('_matrix/client/r0/sync');
      window.location.hash = `#/http_requests?filter=${encodedUri}`;

      render(<App />);

      await waitFor(() => {
        expect(useLogStore.getState().uriFilter).toBe('_matrix/client/r0/sync');
      });
    });

    it('clears filter when removing filter= param from URL', async () => {
      const requests = createHttpRequests(5);
      const logLines = createParsedLogLines(10);
      useLogStore.getState().setHttpRequests(requests, logLines);
      
      // Set initial filter
      window.location.hash = '#/http_requests?filter=sync';

      const { rerender } = render(<App />);

      await waitFor(() => {
        expect(useLogStore.getState().uriFilter).toBe('sync');
      });

      // Remove param from URL (same route)
      window.location.hash = '#/http_requests';
      rerender(<App />);

      // In URL-as-source-of-truth architecture, removing the param clears the filter
      await waitFor(() => {
        expect(useLogStore.getState().uriFilter).toBeNull();
      });
    });

    it('clears filter when navigating to a different route', async () => {
      const requests = createHttpRequests(5);
      const logLines = createParsedLogLines(10);
      useLogStore.getState().setHttpRequests(requests, logLines);
      
      // Set initial filter on http_requests route
      window.location.hash = '#/http_requests?filter=sync';

      const { rerender } = render(<App />);

      await waitFor(() => {
        expect(useLogStore.getState().uriFilter).toBe('sync');
      });

      // Navigate to different route
      window.location.hash = '#/summary';
      rerender(<App />);

      await waitFor(() => {
        expect(useLogStore.getState().uriFilter).toBeNull();
      });
    });

    it('stores the raw filter string from the URL without modification', async () => {
      const requests = createHttpRequests(5);
      const logLines = createParsedLogLines(10);
      useLogStore.getState().setHttpRequests(requests, logLines);

      window.location.hash = '#/http_requests?filter=SYNC';

      render(<App />);

      await waitFor(() => {
        // Store should preserve the filter value as-is
        expect(useLogStore.getState().uriFilter).toBe('SYNC');
      });
    });
  });

  describe('URL → Store: Parsing request_id= parameter', () => {
    it('opens log viewer for request matching request_id= parameter', async () => {
      const requests = createHttpRequests(5);
      const logLines = createParsedLogLines(10);
      useLogStore.getState().setHttpRequests(requests, logLines);

      window.location.hash = '#/http_requests?request_id=REQ-2';

      render(<App />);

      await waitFor(() => {
        const state = useLogStore.getState();
        // useUrlRequestAutoScroll opens by rowKey (sendLineNumber): REQ-2 → sendLineNumber = 2*2 = 4
        expect(state.openLogViewerIds.has(4)).toBe(true);
        expect(state.expandedRows.has(4)).toBe(true);
      }, { timeout: 2000 });
    });

    it('decodes URL-encoded request_id parameter', async () => {
      const specialReq = createHttpRequest({ requestId: 'REQ:SPECIAL/ID', sendLineNumber: 100 });
      const requests = [...createHttpRequests(5), specialReq];
      const logLines = createParsedLogLines(10);
      useLogStore.getState().setHttpRequests(requests, logLines);

      // URL-encoded request ID with special characters
      const encodedId = encodeURIComponent('REQ:SPECIAL/ID');
      window.location.hash = `#/http_requests?request_id=${encodedId}`;

      render(<App />);

      await waitFor(() => {
        // REQ:SPECIAL/ID has sendLineNumber=100, so rowKey=100
        expect(useLogStore.getState().openLogViewerIds.has(100)).toBe(true);
      }, { timeout: 2000 });
    });
  });

  // ============================================================================
  // Multi-Parameter Interactions
  // ============================================================================

  describe('Multi-Parameter Interactions', () => {
    it('filter= and request_id= work together', async () => {
      const requests = createHttpRequests(10);
      const logLines = createParsedLogLines(15);
      useLogStore.getState().setHttpRequests(requests, logLines);

      // Both parameters present
      window.location.hash = '#/http_requests?filter=sync&request_id=REQ-5';

      render(<App />);

      await waitFor(() => {
        const state = useLogStore.getState();
        // Both should be applied: uriFilter from App.tsx, and log viewer from useUrlRequestAutoScroll
        expect(state.uriFilter).toBe('sync');
        // REQ-5 → sendLineNumber = 5*2 = 10, so rowKey = 10
        expect(state.openLogViewerIds.has(10)).toBe(true);
      }, { timeout: 2000 });
    });

    it('handles filter=, status=, and time range together', async () => {
      const requests = createHttpRequests(10);
      const logLines = createParsedLogLines(20);
      useLogStore.getState().setHttpRequests(requests, logLines);

      window.location.hash =
        '#/http_requests?filter=sync&status=200,500&start=2025-01-01T00:00:00Z&end=2025-01-02T00:00:00Z';

      render(<App />);

      await waitFor(() => {
        const state = useLogStore.getState();
        expect(state.uriFilter).toBe('sync');
        expect(state.statusCodeFilter).not.toBeNull();
        expect(state.startTime).not.toBeNull();
        expect(state.endTime).not.toBeNull();
      });
    });
  });

  // ============================================================================
  // Parameter Encoding and Special Characters
  // ============================================================================

  describe('Parameter Encoding and Special Characters', () => {
    it('handles Matrix URIs with underscores and slashes', async () => {
      const requests = createHttpRequests(5);
      const logLines = createParsedLogLines(10);
      useLogStore.getState().setHttpRequests(requests, logLines);

      const uri = '_matrix/client/r0/sync';
      window.location.hash = `#/http_requests?filter=${encodeURIComponent(uri)}`;

      render(<App />);

      await waitFor(() => {
        expect(useLogStore.getState().uriFilter).toBe(uri);
      });
    });

    it('handles filter with spaces', async () => {
      const requests = createHttpRequests(5);
      const logLines = createParsedLogLines(10);
      useLogStore.getState().setHttpRequests(requests, logLines);

      const uri = 'room list sync';
      window.location.hash = `#/http_requests?filter=${encodeURIComponent(uri)}`;

      render(<App />);

      await waitFor(() => {
        expect(useLogStore.getState().uriFilter).toBe(uri);
      });
    });

    it('handles empty filter parameter', async () => {
      const requests = createHttpRequests(5);
      const logLines = createParsedLogLines(10);
      useLogStore.getState().setHttpRequests(requests, logLines);

      window.location.hash = '#/http_requests?filter=';

      render(<App />);

      await waitFor(() => {
        // Empty string should be treated as no filter
        expect(useLogStore.getState().uriFilter).toBeNull();
      });
    });
  });
});
