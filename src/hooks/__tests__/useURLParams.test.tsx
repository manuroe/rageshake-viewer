/**
 * Unit tests for useURLParams hook
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useURLParams, parseStatusParam } from '../useURLParams';

// Wrapper with router at specific path
function createWrapper(initialEntries: string[] = ['/']) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        {children}
      </MemoryRouter>
    );
  };
}

describe('parseStatusParam', () => {
  it('returns null for null input', () => {
    expect(parseStatusParam(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseStatusParam('')).toBeNull();
  });

  it('parses single status code', () => {
    const result = parseStatusParam('500');
    expect(result).toEqual(new Set(['500']));
  });

  it('parses multiple comma-separated codes', () => {
    const result = parseStatusParam('400,404,500');
    expect(result).toEqual(new Set(['400', '404', '500']));
  });

  it('handles whitespace in codes', () => {
    const result = parseStatusParam('400, 500 ');
    expect(result).toEqual(new Set(['400', '500']));
  });

  it('filters empty segments', () => {
    const result = parseStatusParam('400,,500');
    expect(result).toEqual(new Set(['400', '500']));
  });

  it('returns null when all segments are empty after trimming', () => {
    const result = parseStatusParam(',  ,');
    expect(result).toBeNull();
  });
});

describe('useURLParams', () => {
  describe('reading params', () => {
    it('reads start and end params', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/?start=2025-01-01&end=2025-01-02']),
      });

      expect(result.current.start).toBe('2025-01-01');
      expect(result.current.end).toBe('2025-01-02');
    });

    it('returns null for missing start/end', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/']),
      });

      expect(result.current.start).toBeNull();
      expect(result.current.end).toBeNull();
    });

    it('reads scale param with default', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/']),
      });

      expect(result.current.scale).toBe(10); // DEFAULT_MS_PER_PIXEL
    });

    it('reads custom scale param', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/?scale=50']),
      });

      expect(result.current.scale).toBe(50);
    });

    it('falls back to default scale when scale param is zero', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/?scale=0']),
      });

      expect(result.current.scale).toBe(10); // DEFAULT_MS_PER_PIXEL
    });

    it('falls back to default scale when scale param is negative', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/?scale=-5']),
      });

      expect(result.current.scale).toBe(10); // DEFAULT_MS_PER_PIXEL
    });

    it('reads status param as Set', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/?status=400,500']),
      });

      expect(result.current.status).toEqual(new Set(['400', '500']));
    });

    it('reads filter param', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/?filter=sync']),
      });

      expect(result.current.filter).toBe('sync');
    });

    it('reads request_id param', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/?request_id=abc123']),
      });

      expect(result.current.requestId).toBe('abc123');
    });

    it('handles URL-encoded filter param', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/?filter=%2F_matrix%2Fclient']),
      });

      expect(result.current.filter).toBe('/_matrix/client');
    });

  });

  describe('writing params', () => {
    it('setTimeFilter updates start and end', () => {
      const { result } = renderHook(
        () => useURLParams(),
        { wrapper: createWrapper(['/']) }
      );

      act(() => {
        result.current.setTimeFilter('2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z');
      });

      expect(result.current.start).toBe('2025-01-01T00:00:00Z');
      expect(result.current.end).toBe('2025-01-02T00:00:00Z');
    });

    it('setTimeFilter with null clears params', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/?start=2025-01-01&end=2025-01-02']),
      });

      act(() => {
        result.current.setTimeFilter(null, null);
      });

      expect(result.current.start).toBeNull();
      expect(result.current.end).toBeNull();
    });

    it('setScale updates scale param', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/']),
      });

      act(() => {
        result.current.setScale(50);
      });

      expect(result.current.scale).toBe(50);
    });

    it('setScale with default value removes param', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/?scale=50']),
      });

      act(() => {
        result.current.setScale(10); // DEFAULT_MS_PER_PIXEL
      });

      // Scale should return default but param should be removed
      expect(result.current.scale).toBe(10);
    });

    it('setStatusFilter updates status param', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/']),
      });

      act(() => {
        result.current.setStatusFilter(new Set(['400', '500']));
      });

      expect(result.current.status).toEqual(new Set(['400', '500']));
    });

    it('setStatusFilter with null clears status', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/?status=500']),
      });

      act(() => {
        result.current.setStatusFilter(null);
      });

      expect(result.current.status).toBeNull();
    });

    it('setUriFilter updates filter param', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/']),
      });

      act(() => {
        result.current.setUriFilter('/_matrix/sync');
      });

      expect(result.current.filter).toBe('/_matrix/sync');
    });

    it('setUriFilter with empty string clears filter', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/?filter=sync']),
      });

      act(() => {
        result.current.setUriFilter('');
      });

      expect(result.current.filter).toBeNull();
    });

    it('setRequestId updates request_id param', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/']),
      });

      act(() => {
        result.current.setRequestId('req-123');
      });

      expect(result.current.requestId).toBe('req-123');
    });

    it('setRequestId with null clears request_id', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/?request_id=abc']),
      });

      act(() => {
        result.current.setRequestId(null);
      });

      expect(result.current.requestId).toBeNull();
    });

    it('preserves other params when updating one', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/?start=2025-01-01&filter=sync']),
      });

      act(() => {
        result.current.setScale(50);
      });

      // Other params should be preserved
      expect(result.current.start).toBe('2025-01-01');
      expect(result.current.filter).toBe('sync');
      expect(result.current.scale).toBe(50);
    });

    it('setTimeoutFilter sets timeout param', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/']),
      });

      act(() => {
        result.current.setTimeoutFilter(30000);
      });

      expect(result.current.timeout).toBe(30000);
    });

    it('setTimeoutFilter with null clears timeout param', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/?timeout=5000']),
      });

      act(() => {
        result.current.setTimeoutFilter(null);
      });

      expect(result.current.timeout).toBeNull();
    });

  });

  describe('timeout param parsing', () => {
    it('reads timeout param as number', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/?timeout=5000']),
      });

      expect(result.current.timeout).toBe(5000);
    });

    it('returns null for absent timeout param', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/']),
      });

      expect(result.current.timeout).toBeNull();
    });

    it('returns null when timeout param is NaN', () => {
      const { result } = renderHook(() => useURLParams(), {
        wrapper: createWrapper(['/?timeout=invalid']),
      });

      expect(result.current.timeout).toBeNull();
    });
  });
});
