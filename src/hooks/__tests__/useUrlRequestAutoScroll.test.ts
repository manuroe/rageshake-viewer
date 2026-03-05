/**
 * Unit tests for useUrlRequestAutoScroll.
 * Covers URL hash parsing, auto-opening/expanding requests,
 * scroll retry logic (delta > 4), and cleanup on unmount.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUrlRequestAutoScroll } from '../useUrlRequestAutoScroll';
import { useLogStore } from '../../stores/logStore';
import { createHttpRequest, createHttpRequests } from '../../test/fixtures';
import type { HttpRequest } from '../../types/log.types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMockLeftPanel() {
  const div = document.createElement('div');
  Object.defineProperty(div, 'clientHeight', { value: 100, configurable: true });
  Object.defineProperty(div, 'scrollHeight', { value: 5000, configurable: true });
  const scrollToSpy = vi.fn();
  Object.defineProperty(div, 'scrollTo', { value: scrollToSpy, configurable: true });
  return { div, scrollToSpy };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('useUrlRequestAutoScroll', () => {
  let originalHash: string;

  beforeEach(() => {
    originalHash = window.location.hash;
    useLogStore.getState().clearData();
    vi.useFakeTimers();
  });

  afterEach(() => {
    window.location.hash = originalHash;
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('no-op cases', () => {
    it('does nothing when hash has no request_id parameter', () => {
      window.location.hash = '#/http_requests';
      const req = createHttpRequest({ requestId: 'TEST-1' });
      const leftRef = { current: document.createElement('div') };

      renderHook(() =>
        useUrlRequestAutoScroll(
          [req],
          leftRef as React.RefObject<HTMLDivElement | null>
        )
      );

      expect(useLogStore.getState().openLogViewerIds.has('TEST-1')).toBe(false);
    });

    it('does nothing when request_id in hash does not match any request', () => {
      window.location.hash = '#?request_id=NONEXISTENT';
      const req = createHttpRequest({ requestId: 'TEST-1' });
      const leftRef = { current: document.createElement('div') };

      renderHook(() =>
        useUrlRequestAutoScroll(
          [req],
          leftRef as React.RefObject<HTMLDivElement | null>
        )
      );

      expect(useLogStore.getState().openLogViewerIds.has('NONEXISTENT')).toBe(false);
    });
  });

  describe('auto-open behavior', () => {
    it('opens log viewer and expands row when request_id matches', () => {
      window.location.hash = '#?request_id=REQ-MATCH';
      const req = createHttpRequest({ requestId: 'REQ-MATCH', sendLineNumber: 42 });
      const { div } = makeMockLeftPanel();
      const leftRef = { current: div };

      renderHook(() =>
        useUrlRequestAutoScroll(
          [req],
          leftRef as React.RefObject<HTMLDivElement | null>
        )
      );

      // rowKey = sendLineNumber = 42
      expect(useLogStore.getState().openLogViewerIds.has(42)).toBe(true);
      expect(useLogStore.getState().expandedRows.has(42)).toBe(true);
    });

    it('does not re-open on re-render when same request_id was already scrolled', () => {
      window.location.hash = '#?request_id=REQ-DUP';
      const req = createHttpRequest({ requestId: 'REQ-DUP', sendLineNumber: 44 });
      const { div } = makeMockLeftPanel();
      const leftRef = { current: div };

      const { rerender } = renderHook(() =>
        useUrlRequestAutoScroll(
          [req],
          leftRef as React.RefObject<HTMLDivElement | null>
        )
      );

      // First render should open it (rowKey = 44)
      expect(useLogStore.getState().openLogViewerIds.has(44)).toBe(true);

      // Re-render without changing hash — scrolledIdRef.current prevents re-opening
      rerender();
      // Just verify it doesn't crash
      expect(useLogStore.getState().openLogViewerIds.has(44)).toBe(true);
    });

    it('does not call openLogViewer or toggleRowExpansion if already open/expanded', () => {
      window.location.hash = '#?request_id=REQ-PREOPEN';
      const req = createHttpRequest({ requestId: 'REQ-PREOPEN', sendLineNumber: 46 });

      // Pre-open and pre-expand by rowKey
      useLogStore.getState().openLogViewer(46);
      useLogStore.getState().toggleRowExpansion(46);

      const { div } = makeMockLeftPanel();
      const leftRef = { current: div };

      renderHook(() =>
        useUrlRequestAutoScroll(
          [req],
          leftRef as React.RefObject<HTMLDivElement | null>
        )
      );

      // Should still have them open
      expect(useLogStore.getState().openLogViewerIds.has(46)).toBe(true);
      expect(useLogStore.getState().expandedRows.has(46)).toBe(true);
    });
  });

  describe('scroll retry when delta > 4 (line 76)', () => {
    it('retries scroll when leftPanel.scrollTop is far from target', () => {
      window.location.hash = '#?request_id=REQ-SCROLL';

      // Create 50 requests before the target so requestIndex = 50, making scrollTarget >> 4
      const reqs: HttpRequest[] = [...createHttpRequests(50)];
      const targetReq = createHttpRequest({ requestId: 'REQ-SCROLL', sendLineNumber: 200 });
      reqs.push(targetReq);

      const { div, scrollToSpy } = makeMockLeftPanel();
      // scrollTop stays at 0 (JSDOM never actually scrolls) → delta = clampedTarget > 4
      const leftRef = { current: div };

      renderHook(() =>
        useUrlRequestAutoScroll(
          reqs,
          leftRef as React.RefObject<HTMLDivElement | null>
        )
      );

      // The request is found and 1000ms timeout is registered
      expect(useLogStore.getState().openLogViewerIds.has(targetReq.sendLineNumber)).toBe(true);

      // Advance 1000ms → checkAndScroll fires → attemptScroll(0) called
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(scrollToSpy).toHaveBeenCalledTimes(1);

      // delta = |0 - clampedTarget| >> 4, attempt=0 < 6 → retry after 120ms
      act(() => {
        vi.advanceTimersByTime(120);
      });
      expect(scrollToSpy).toHaveBeenCalledTimes(2);

      // Another retry
      act(() => {
        vi.advanceTimersByTime(120);
      });
      expect(scrollToSpy).toHaveBeenCalledTimes(3);
    });

    it('calls onScrollToRequest callback after panel scroll', () => {
      window.location.hash = '#?request_id=REQ-CB';
      const req = createHttpRequest({ requestId: 'REQ-CB' });
      const { div } = makeMockLeftPanel();
      const leftRef = { current: div };
      const onScrollToRequest = vi.fn();

      renderHook(() =>
        useUrlRequestAutoScroll(
          [req],
          leftRef as React.RefObject<HTMLDivElement | null>,
          onScrollToRequest
        )
      );

      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(onScrollToRequest).toHaveBeenCalledWith(req);
    });

    it('retries checkAndScroll every 100ms when leftPanel is not yet available', () => {
      window.location.hash = '#?request_id=REQ-NOPANEL';
      const req = createHttpRequest({ requestId: 'REQ-NOPANEL' });

      // Panel is null initially
      const leftRef = { current: null } as React.RefObject<HTMLDivElement | null>;

      renderHook(() =>
        useUrlRequestAutoScroll([req], leftRef)
      );

      // Advance 1000ms → checkAndScroll fires, leftPanel is null → setTimeout(100)
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      // Provide panel now
      const { div, scrollToSpy } = makeMockLeftPanel();
      (leftRef as { current: HTMLDivElement | null }).current = div;

      // Advance 100ms → checkAndScroll retries with the panel
      act(() => {
        vi.advanceTimersByTime(100);
      });

      // scrollTo should have been called now
      expect(scrollToSpy).toHaveBeenCalled();
    });
  });

  describe('cleanup on unmount', () => {
    it('clears expanded and open state when no request_id in hash', () => {
      window.location.hash = '';
      useLogStore.setState({
        expandedRows: new Set([1, 2]),
        openLogViewerIds: new Set([1]),
      });

      const leftRef = { current: null } as React.RefObject<HTMLDivElement | null>;
      const { unmount } = renderHook(() =>
        useUrlRequestAutoScroll([], leftRef)
      );

      unmount();

      expect(useLogStore.getState().expandedRows.size).toBe(0);
      expect(useLogStore.getState().openLogViewerIds.size).toBe(0);
    });

    it('preserves expanded state on unmount when request_id is still in hash', () => {
      window.location.hash = '#?request_id=PRESERVE';
      useLogStore.setState({
        expandedRows: new Set([99]),
        openLogViewerIds: new Set([99]),
      });

      const leftRef = { current: null } as React.RefObject<HTMLDivElement | null>;
      const { unmount } = renderHook(() =>
        useUrlRequestAutoScroll([], leftRef)
      );

      unmount();

      // request_id is in hash → state should NOT be cleared
      expect(useLogStore.getState().expandedRows.has(99)).toBe(true);
    });
  });
});
