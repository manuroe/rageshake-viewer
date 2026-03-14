import { describe, it, expect } from 'vitest';
import {
  parseTimeInput,
  shortcutToMs,
  shortcutToMicros,
  getTimeDisplayName,
  calculateTimeRangeMicros,
  isInTimeRangeMicros,
  timeToMs,
  timeToURLFormat,
  urlToTimeFormat,
  isoToMicros,
  microsToISO,
  filterValueToURL,
  urlToFilterValue,
  countRequestsForTimeRange,
  formatTimestamp,
  microsToMs,
  msToMicros,
  extractTimeFromISO,
  escapeHtml,
  isFullISODatetime,
  msToISO,
  isoToTime,
  applyTimeRangeFilterMicros,
  formatDuration,
  snapSelectionToLogLine,
  SNAP_TOLERANCE_US,
} from '../timeUtils';

describe('Time Filter Utilities', () => {
  describe('parseTimeInput', () => {
    it('should parse shortcut strings', () => {
      expect(parseTimeInput('last-5-min')).toBe('last-5-min');
      expect(parseTimeInput('last-10-min')).toBe('last-10-min');
      expect(parseTimeInput('last-hour')).toBe('last-hour');
      expect(parseTimeInput('last-day')).toBe('last-day');
    });

    it('should parse ISO time format', () => {
      expect(parseTimeInput('12:34:56')).toBe('12:34:56');
      expect(parseTimeInput('12:34:56.123456')).toBe('12:34:56.123456');
      expect(parseTimeInput('23:59:59.999999')).toBe('23:59:59.999999');
    });

    it('should return null for invalid input', () => {
      expect(parseTimeInput('invalid')).toBeNull();
      expect(parseTimeInput('12:60:00')).toBeNull();
      expect(parseTimeInput('')).toBeNull();
    });

    it('should handle whitespace', () => {
      expect(parseTimeInput('  last-5-min  ')).toBe('last-5-min');
      expect(parseTimeInput('  12:34:56  ')).toBe('12:34:56');
    });
  });

  describe('shortcutToMs', () => {
    it('should convert shortcuts to milliseconds', () => {
      expect(shortcutToMs('last-5-min')).toBe(5 * 60 * 1000);
      expect(shortcutToMs('last-10-min')).toBe(10 * 60 * 1000);
      expect(shortcutToMs('last-hour')).toBe(60 * 60 * 1000);
      expect(shortcutToMs('last-day')).toBe(24 * 60 * 60 * 1000);
    });

    it('should return 0 for unknown shortcut', () => {
      expect(shortcutToMs('unknown')).toBe(0);
    });
  });

  describe('getTimeDisplayName', () => {
    it('should return display names for shortcuts', () => {
      expect(getTimeDisplayName('last-5-min')).toBe('Last 5 min');
      expect(getTimeDisplayName('last-10-min')).toBe('Last 10 min');
      expect(getTimeDisplayName('last-hour')).toBe('Last hour');
      expect(getTimeDisplayName('last-day')).toBe('Last day');
    });

    it('should return time string for ISO times', () => {
      expect(getTimeDisplayName('12:34:56')).toBe('12:34:56');
    });

    it('should return empty string for null', () => {
      expect(getTimeDisplayName(null)).toBe('');
    });

    it('should return End of log for end', () => {
      expect(getTimeDisplayName('end')).toBe('End of log');
    });
  });

  describe('calculateTimeRangeMicros', () => {
    it('should return full range when no filters set', () => {
      // minLogTimeUs = 0, maxLogTimeUs = 10000
      const result = calculateTimeRangeMicros(null, null, 0, 10000);
      expect(result.startUs).toBe(0);
      expect(result.endUs).toBe(10000);
    });

    it('should handle shortcut as start time', () => {
      // Create a test scenario: log spans from 12:40:00 to 12:45:00
      const startIso = '2024-01-01T12:40:00.000000Z';
      const endIso = '2024-01-01T12:45:00.000000Z';
      const minUs = isoToMicros(startIso);
      const maxUs = isoToMicros(endIso);
      
      const result = calculateTimeRangeMicros('last-5-min', 'end', minUs, maxUs);
      expect(result.endUs).toBe(maxUs);
      // last-5-min = 5 * 60 * 1000 * 1000 microseconds
      expect(result.startUs).toBe(maxUs - shortcutToMicros('last-5-min'));
    });

    it('should handle ISO datetime strings', () => {
      const startIso = '2024-01-01T12:34:56.000000Z';
      const endIso = '2024-01-01T12:45:00.000000Z';
      const minUs = isoToMicros('2024-01-01T12:00:00.000000Z');
      const maxUs = isoToMicros('2024-01-01T13:00:00.000000Z');
      
      const result = calculateTimeRangeMicros(startIso, endIso, minUs, maxUs);
      expect(result.startUs).toBe(isoToMicros(startIso));
      expect(result.endUs).toBe(isoToMicros(endIso));
    });

    it('should clamp start time to minLogTimeUs', () => {
      // Log only spans 1 minute, but we request last-hour
      const minUs = isoToMicros('2024-01-01T00:00:00.000000Z');
      const maxUs = isoToMicros('2024-01-01T00:01:00.000000Z');
      
      const result = calculateTimeRangeMicros('last-hour', 'end', minUs, maxUs);
      expect(result.startUs).toBeGreaterThanOrEqual(0);
      // Clamped to minLogTimeUs
      expect(result.startUs).toBe(minUs);
    });
  });

  describe('isInTimeRangeMicros', () => {
    it('should check if timestamp is in range', () => {
      const startUs = isoToMicros('2024-01-01T12:00:00.000000Z');
      const endUs = isoToMicros('2024-01-01T13:00:00.000000Z');
      const midUs = isoToMicros('2024-01-01T12:30:00.000000Z');

      expect(isInTimeRangeMicros(midUs, startUs, endUs)).toBe(true);
      expect(isInTimeRangeMicros(startUs, startUs, endUs)).toBe(true);
      expect(isInTimeRangeMicros(endUs, startUs, endUs)).toBe(true);
    });

    it('should exclude times outside range', () => {
      const startUs = isoToMicros('2024-01-01T12:00:00.000000Z');
      const endUs = isoToMicros('2024-01-01T13:00:00.000000Z');
      const beforeUs = isoToMicros('2024-01-01T11:59:59.000000Z');
      const afterUs = isoToMicros('2024-01-01T13:00:01.000000Z');

      expect(isInTimeRangeMicros(beforeUs, startUs, endUs)).toBe(false);
      expect(isInTimeRangeMicros(afterUs, startUs, endUs)).toBe(false);
    });
  });

  describe('timeToMs', () => {
    it('should convert time strings to milliseconds', () => {
      expect(timeToMs('00:00:00')).toBe(0);
      expect(timeToMs('01:00:00')).toBe(3600000);
      expect(timeToMs('00:01:00')).toBe(60000);
      expect(timeToMs('00:00:01')).toBe(1000);
      expect(timeToMs('12:34:56')).toBe(45296000);
    });

    it('should handle partial seconds', () => {
      expect(timeToMs('00:00:01.5')).toBe(1500);
      // Note: timeToMs returns integer milliseconds, losing sub-ms precision
      expect(timeToMs('00:00:00.123456')).toBe(123);
    });
  });

  describe('isoToMicros and microsToISO', () => {
    it('should convert ISO datetime to microseconds and back', () => {
      const iso = '2026-01-26T16:01:13.382222Z';
      const micros = isoToMicros(iso);
      expect(micros).toBeGreaterThan(0);
      // Round trip
      const backToISO = microsToISO(micros);
      expect(backToISO).toBe(iso);
    });

    it('should handle ISO without fractional seconds', () => {
      const iso = '2026-01-26T16:01:13Z';
      const micros = isoToMicros(iso);
      expect(micros).toBeGreaterThan(0);
      const backToISO = microsToISO(micros);
      // Output always includes microseconds
      expect(backToISO).toBe('2026-01-26T16:01:13.000000Z');
    });

    it('should return 0 for invalid input', () => {
      expect(isoToMicros('')).toBe(0);
      expect(isoToMicros('invalid')).toBe(0);
    });

    it('should preserve microsecond precision', () => {
      const iso = '2026-01-26T16:01:13.123456Z';
      const micros = isoToMicros(iso);
      const backToISO = microsToISO(micros);
      expect(backToISO).toBe(iso);
    });
  });

  describe('timeToURLFormat (filterValueToURL)', () => {
    it('should preserve full ISO datetime with actual date', () => {
      expect(filterValueToURL('2022-04-15T09:45:19.968Z')).toBe('2022-04-15T09:45:19.968Z');
      expect(filterValueToURL('2025-12-31T23:59:59Z')).toBe('2025-12-31T23:59:59Z');
    });

    it('should pass through time-only strings unchanged (no epoch prefix)', () => {
      // New behavior: time-only strings are passed through as-is
      // URLs should use full ISO datetime with real dates
      expect(filterValueToURL('09:45:19.968')).toBe('09:45:19.968');
    });

    it('should keep shortcuts unchanged', () => {
      expect(filterValueToURL('start')).toBe('start');
      expect(filterValueToURL('end')).toBe('end');
      expect(filterValueToURL('last-hour')).toBe('last-hour');
      expect(filterValueToURL('last-day')).toBe('last-day');
    });

    it('should return null for null input', () => {
      expect(filterValueToURL(null)).toBeNull();
    });
  });

  describe('urlToTimeFormat (urlToFilterValue)', () => {
    it('should preserve full ISO datetime with actual date', () => {
      expect(urlToFilterValue('2022-04-15T09:45:19.968Z')).toBe('2022-04-15T09:45:19.968Z');
      expect(urlToFilterValue('2025-12-31T23:59:59Z')).toBe('2025-12-31T23:59:59Z');
    });

    it('should preserve epoch-based ISO datetime (no special handling)', () => {
      // New behavior: all ISO datetimes are treated the same
      expect(urlToFilterValue('1970-01-01T09:45:19.968Z')).toBe('1970-01-01T09:45:19.968Z');
      expect(urlToFilterValue('1970-01-01T00:00:00Z')).toBe('1970-01-01T00:00:00Z');
    });

    it('should keep shortcuts unchanged', () => {
      expect(urlToFilterValue('start')).toBe('start');
      expect(urlToFilterValue('end')).toBe('end');
      expect(urlToFilterValue('last-hour')).toBe('last-hour');
    });

    it('should return null for null input', () => {
      expect(urlToFilterValue(null)).toBeNull();
    });

    it('should return null for invalid format', () => {
      // Non-ISO, non-shortcut values are rejected
      expect(urlToFilterValue('invalid')).toBeNull();
    });
  });

  describe('filterValueToURL ↔ urlToFilterValue round-trip', () => {
    it('should preserve full ISO datetimes with real dates in both directions', () => {
      const original = '2026-01-21T09:48:37.123456Z';
      const toURL = filterValueToURL(original);
      const fromURL = urlToFilterValue(toURL);
      expect(fromURL).toBe(original);
    });

    it('should preserve epoch ISO datetimes (treated like any other date)', () => {
      const original = '1970-01-01T09:48:37.123456Z';
      const toURL = filterValueToURL(original);
      expect(toURL).toBe(original);
      const fromURL = urlToFilterValue(toURL);
      expect(fromURL).toBe(original);
    });

    it('should preserve shortcuts in both directions', () => {
      const shortcuts = ['start', 'end', 'last-hour', 'last-day', 'last-5-min'];
      shortcuts.forEach(shortcut => {
        const toURL = filterValueToURL(shortcut);
        const fromURL = urlToFilterValue(toURL);
        expect(fromURL).toBe(shortcut);
      });
    });
  });

  describe('shortcut handling - hyphenated format', () => {
    it('should handle all hyphenated shortcuts', () => {
      expect(shortcutToMs('last-min')).toBe(60 * 1000);
      expect(getTimeDisplayName('last-min')).toBe('Last min');
      expect(parseTimeInput('last-min')).toBe('last-min');
    });
  });

  describe('formatTimestamp', () => {
    const sampleMicros = isoToMicros('2024-06-15T12:34:56.123456Z');

    it('returns empty string for zero micros', () => {
      expect(formatTimestamp(0)).toBe('');
    });

    it('returns empty string for negative micros', () => {
      // @ts-expect-error testing negative value path
      expect(formatTimestamp(-1000)).toBe('');
    });

    it('formats HH:MM format', () => {
      const result = formatTimestamp(sampleMicros, 'HH:MM');
      expect(result).toBe('12:34');
    });

    it('formats HH:MM:SS format (default)', () => {
      const result = formatTimestamp(sampleMicros, 'HH:MM:SS');
      expect(result).toBe('12:34:56');
    });

    it('formats HH:MM:SS.us format', () => {
      const result = formatTimestamp(sampleMicros, 'HH:MM:SS.us');
      expect(result).toBe('12:34:56.123456');
    });

    it('formats ISO format', () => {
      const result = formatTimestamp(sampleMicros, 'ISO');
      expect(result).toBe('2024-06-15T12:34:56.123456Z');
    });

    it('uses HH:MM:SS as default format', () => {
      expect(formatTimestamp(sampleMicros)).toBe('12:34:56');
    });
  });

  describe('calculateTimeRangeMicros - keyword branches', () => {
    const minUs = isoToMicros('2024-01-01T10:00:00.000000Z');
    const maxUs = isoToMicros('2024-01-01T12:00:00.000000Z');

    it('handles start keyword as start filter', () => {
      const result = calculateTimeRangeMicros('start', null, minUs, maxUs);
      expect(result.startUs).toBe(minUs);
      expect(result.endUs).toBe(maxUs);
    });

    it('handles end keyword as end filter', () => {
      const result = calculateTimeRangeMicros(null, 'end', minUs, maxUs);
      expect(result.startUs).toBe(minUs);
      expect(result.endUs).toBe(maxUs);
    });

    it('handles both start and end keywords', () => {
      const result = calculateTimeRangeMicros('start', 'end', minUs, maxUs);
      expect(result.startUs).toBe(minUs);
      expect(result.endUs).toBe(maxUs);
    });
  });

  describe('microsToISO edge cases', () => {
    it('returns empty string for zero micros', () => {
      expect(microsToISO(0)).toBe('');
    });

    it('returns empty string for null-ish input', () => {
      // @ts-expect-error testing edge case
      expect(microsToISO(null)).toBe('');
    });
  });
});

// ---------------------------------------------------------------------------
// countRequestsForTimeRange
// ---------------------------------------------------------------------------

describe('countRequestsForTimeRange', () => {
  // Helper: build minimal rawLogLines with sequential microsecond timestamps.
  // Line i gets timestampUs = BASE_US + i * 1_000_000 (1 second apart).
  const BASE_US = new Date('2024-01-15T10:00:00Z').getTime() * 1000;
  const SEC_US = 1_000_000;

  const makeLines = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      lineNumber: i,
      timestampUs: (BASE_US + i * SEC_US) as number,
    }));

  // ISO strings for lines 0, 2, 4
  const isoAt = (i: number) => new Date((BASE_US + i * SEC_US) / 1000).toISOString();

  const makeReq = (responseLineNumber: number) => ({ responseLineNumber });

  it('returns all requests when no filter is active', () => {
    const rawLogLines = makeLines(10);
    const requests = [makeReq(1), makeReq(3), makeReq(0), makeReq(0)]; // 2 incomplete
    expect(countRequestsForTimeRange(requests, rawLogLines, null, null)).toBe(4);
  });

  it('counts only completed requests in range + all incomplete when a filter is set', () => {
    // Design intent: incomplete requests (responseLineNumber=0) are ALWAYS included regardless
    // of the time window. They serve as the canonical denominator in stats display
    // (e.g. “2 completed within window / 4 total including in-flight”), so the caller never
    // under-counts the work that was in progress at the time of the snapshot.
    const rawLogLines = makeLines(10);
    // 2 completed inside window (lines 1, 3), 1 outside (line 7), 2 incomplete
    const requests = [makeReq(1), makeReq(3), makeReq(7), makeReq(0), makeReq(0)];
    const start = isoAt(0); // line 0
    const end   = isoAt(4); // line 4
    // Expected: 2 in-range + 2 incomplete = 4
    expect(countRequestsForTimeRange(requests, rawLogLines, start, end)).toBe(4);
  });

  it('includes all incomplete requests even when no completed request falls in window', () => {
    const rawLogLines = makeLines(10);
    // 1 completed outside window, 3 incomplete
    const requests = [makeReq(8), makeReq(0), makeReq(0), makeReq(0)];
    const start = isoAt(0);
    const end   = isoAt(2);
    expect(countRequestsForTimeRange(requests, rawLogLines, start, end)).toBe(3);
  });

  it('returns 0 when no requests', () => {
    const rawLogLines = makeLines(5);
    expect(countRequestsForTimeRange([], rawLogLines, isoAt(0), isoAt(4))).toBe(0);
  });

  it('returns length when no filter even if all are incomplete', () => {
    const rawLogLines = makeLines(5);
    const requests = [makeReq(0), makeReq(0), makeReq(0)];
    expect(countRequestsForTimeRange(requests, rawLogLines, null, null)).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// microsToMs / msToMicros
// ---------------------------------------------------------------------------
describe('microsToMs', () => {
  it('converts microseconds to milliseconds (floor)', () => {
    expect(microsToMs(1000)).toBe(1);
    expect(microsToMs(1500)).toBe(1);
    expect(microsToMs(2000000)).toBe(2000);
  });

  it('returns 0 for 0', () => {
    expect(microsToMs(0)).toBe(0);
  });
});

describe('msToMicros', () => {
  it('converts milliseconds to microseconds', () => {
    expect(msToMicros(1)).toBe(1000);
    expect(msToMicros(2000)).toBe(2000000);
  });

  it('returns 0 for 0', () => {
    expect(msToMicros(0)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// extractTimeFromISO / isoToTime
// ---------------------------------------------------------------------------
describe('extractTimeFromISO', () => {
  it('extracts time portion from ISO string', () => {
    expect(extractTimeFromISO('2026-01-26T16:01:13.382222Z')).toBe('16:01:13.382222');
  });

  it('extracts time without fractional seconds', () => {
    expect(extractTimeFromISO('2026-01-26T09:30:00Z')).toBe('09:30:00');
  });

  it('returns empty string for empty input', () => {
    expect(extractTimeFromISO('')).toBe('');
  });

  it('returns input as-is when no T delimiter', () => {
    expect(extractTimeFromISO('not-an-iso-string')).toBe('not-an-iso-string');
  });
});

describe('isoToTime (legacy wrapper)', () => {
  it('delegates to extractTimeFromISO', () => {
    expect(isoToTime('2026-01-26T16:01:13.382222Z')).toBe('16:01:13.382222');
  });

  it('returns empty string for empty input', () => {
    expect(isoToTime('')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// isFullISODatetime
// ---------------------------------------------------------------------------
describe('isFullISODatetime', () => {
  it('returns true for full ISO datetime strings', () => {
    expect(isFullISODatetime('2026-01-26T16:01:13Z')).toBe(true);
    expect(isFullISODatetime('2026-01-26T16:01:13.382222Z')).toBe(true);
  });

  it('returns false for time-only and shortcut strings', () => {
    expect(isFullISODatetime('16:01:13')).toBe(false);
    expect(isFullISODatetime('last-5-min')).toBe(false);
    expect(isFullISODatetime('start')).toBe(false);
    expect(isFullISODatetime('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// msToISO (legacy wrapper)
// ---------------------------------------------------------------------------
describe('msToISO', () => {
  it('converts milliseconds timestamp to ISO string', () => {
    const ms = new Date('2026-01-26T16:01:13.000Z').getTime();
    const result = msToISO(ms);
    expect(result).toMatch(/^2026-01-26T16:01:13\./);
  });

  it('returns empty string for 0', () => {
    expect(msToISO(0)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------
describe('escapeHtml', () => {
  it('escapes < and > characters', () => {
    const result = escapeHtml('<script>alert("xss")</script>');
    expect(result).toContain('&lt;');
    expect(result).toContain('&gt;');
    expect(result).not.toContain('<script>');
  });

  it('returns plain text unchanged', () => {
    expect(escapeHtml('hello world')).toBe('hello world');
  });

  it('escapes ampersands', () => {
    const result = escapeHtml('a & b');
    expect(result).toContain('&amp;');
  });
});

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------
describe('formatDuration', () => {
  it('formats sub-second durations as integer ms', () => {
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(0)).toBe('0ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('formats durations >= 1000ms as seconds with 2 decimal places', () => {
    expect(formatDuration(1000)).toBe('1.00s');
    expect(formatDuration(1500)).toBe('1.50s');
    expect(formatDuration(2750)).toBe('2.75s');
  });
});

// ---------------------------------------------------------------------------
// applyTimeRangeFilterMicros
// ---------------------------------------------------------------------------
describe('applyTimeRangeFilterMicros', () => {
  const BASE_US = new Date('2024-01-15T10:00:00Z').getTime() * 1000;
  const SEC_US = 1_000_000;

  const makeLines = (count: number) =>
    Array.from({ length: count }, (_, i) => ({
      lineNumber: i + 1,
      timestampUs: BASE_US + i * SEC_US,
    }));

  const isoAt = (i: number) =>
    new Date((BASE_US + i * SEC_US) / 1000).toISOString();

  it('returns all requests when no filter set', () => {
    const requests = [{ responseLineNumber: 1 }, { responseLineNumber: 2 }];
    const result = applyTimeRangeFilterMicros(requests, makeLines(5), null, null);
    expect(result).toHaveLength(2);
  });

  it('returns all requests when rawLogLines has no valid timestamps (defensive fallback)', () => {
    // When there are no log lines to derive min/max times from,
    // the function cannot filter by time and returns the input unchanged.
    const emptyLines: Array<{ lineNumber: number; timestampUs: number }> = [];
    const requests = [{ responseLineNumber: 1 }];
    const result = applyTimeRangeFilterMicros(requests, emptyLines, isoAt(0), isoAt(4));
    expect(result).toEqual(requests);
  });

  it('filters out requests whose response timestamp is outside the range', () => {
    const rawLogLines = makeLines(10);
    const requests = [
      { responseLineNumber: 2 },  // line 2 → inside window [line1, line4]
      { responseLineNumber: 4 },  // line 4 → inside
      { responseLineNumber: 8 },  // line 8 → outside
    ];
    const result = applyTimeRangeFilterMicros(
      requests,
      rawLogLines,
      isoAt(0),
      isoAt(3)
    );
    expect(result).toHaveLength(2);
  });

  it('excludes incomplete requests (responseLineNumber === 0)', () => {
    const rawLogLines = makeLines(5);
    const requests = [{ responseLineNumber: 0 }, { responseLineNumber: 2 }];
    const result = applyTimeRangeFilterMicros(requests, rawLogLines, isoAt(0), isoAt(4));
    expect(result).toHaveLength(1);
    expect(result[0].responseLineNumber).toBe(2);
  });

  it('handles end keyword as end filter', () => {
    const rawLogLines = makeLines(5);
    const requests = [{ responseLineNumber: 2 }, { responseLineNumber: 4 }];
    const result = applyTimeRangeFilterMicros(requests, rawLogLines, isoAt(0), 'end');
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// parseTimeInput — invalid ISO time-component branches
// ---------------------------------------------------------------------------
describe('parseTimeInput - invalid time component branches', () => {
  it('rejects ISO with hour out of range (> 23)', () => {
    expect(parseTimeInput('2026-01-26T25:00:00Z')).toBeNull();
  });

  it('rejects ISO with minute out of range (> 59)', () => {
    expect(parseTimeInput('2026-01-26T10:61:00Z')).toBeNull();
  });

  it('rejects ISO with second out of range (> 59)', () => {
    expect(parseTimeInput('2026-01-26T10:00:61Z')).toBeNull();
  });

  it('rejects time-only with hour out of range', () => {
    expect(parseTimeInput('25:00:00')).toBeNull();
  });

  it('rejects time-only with minute out of range', () => {
    expect(parseTimeInput('10:61:00')).toBeNull();
  });

  it('accepts valid ISO without trailing Z and appends Z', () => {
    const result = parseTimeInput('2026-01-26T10:00:00');
    expect(result).toBe('2026-01-26T10:00:00Z');
  });
});

// =============================================================================
// snapSelectionToLogLine
// =============================================================================

describe('snapSelectionToLogLine', () => {
  // Sample log lines covering a 4-second window
  const BASE = 1_700_000_000_000_000 as ReturnType<typeof isoToMicros>; // arbitrary
  const STEP = 1_000_000 as ReturnType<typeof isoToMicros>; // 1 s

  const lines = [0, 1, 2, 3, 4].map((i) => ({
    timestampUs: (BASE + i * STEP) as ReturnType<typeof isoToMicros>,
    isoTimestamp: `2023-11-14T22:13:${String(20 + i).padStart(2, '0')}.000000Z`,
  }));

  const fullDataRange = {
    minTime: lines[0].timestampUs,
    maxTime: lines[lines.length - 1].timestampUs,
  };

  it('returns "start" when selection is exactly at the data minimum', () => {
    expect(
      snapSelectionToLogLine(fullDataRange.minTime, lines, fullDataRange, 'start')
    ).toBe('start');
  });

  it('returns "end" when selection is exactly at the data maximum', () => {
    expect(
      snapSelectionToLogLine(fullDataRange.maxTime, lines, fullDataRange, 'end')
    ).toBe('end');
  });

  it('returns "start" when selection is within tolerance of the minimum', () => {
    const nearMin = (fullDataRange.minTime + SNAP_TOLERANCE_US - 1) as ReturnType<typeof isoToMicros>;
    expect(
      snapSelectionToLogLine(nearMin, lines, fullDataRange, 'start')
    ).toBe('start');
  });

  it('returns "end" when selection is within tolerance of the maximum', () => {
    const nearMax = (fullDataRange.maxTime - SNAP_TOLERANCE_US + 1) as ReturnType<typeof isoToMicros>;
    expect(
      snapSelectionToLogLine(nearMax, lines, fullDataRange, 'end')
    ).toBe('end');
  });

  it('returns ISO timestamp of closest line for a mid-range start boundary', () => {
    // Value sits between line[1] and line[2]; line[2] is closer
    const midUs = (lines[1].timestampUs + Math.floor(STEP * 0.7)) as ReturnType<typeof isoToMicros>;
    const result = snapSelectionToLogLine(midUs, lines, fullDataRange, 'start');
    expect(result).toBe(lines[2].isoTimestamp);
  });

  it('returns ISO timestamp of closest line for a mid-range end boundary', () => {
    // Value is exactly at line[3]
    const result = snapSelectionToLogLine(lines[3].timestampUs, lines, fullDataRange, 'end');
    expect(result).toBe(lines[3].isoTimestamp);
  });

  it('does NOT return "end" for a start-edge selection near the minimum', () => {
    // Regression: edge keyword must match the requested edge, not the opposite one
    const nearMin = (fullDataRange.minTime + 100) as ReturnType<typeof isoToMicros>;
    const result = snapSelectionToLogLine(nearMin, lines, fullDataRange, 'end');
    // nearMin is far from maxTime so it should NOT return "end"
    expect(result).not.toBe('end');
    expect(result).toBe(lines[0].isoTimestamp);
  });

  it('returns the edge keyword when rawLogLines is empty', () => {
    // Guard: with no log lines there is no "nearest" line to snap to;
    // the function should still return a usable keyword.
    expect(snapSelectionToLogLine(BASE, [], fullDataRange, 'start')).toBe('start');
    expect(snapSelectionToLogLine(BASE, [], fullDataRange, 'end')).toBe('end');
  });

  it('returns "start" when a boundary is just outside tolerance of the minimum (start edge)', () => {
    // Value is SNAP_TOLERANCE_US + 1 away from the minimum — must NOT snap to "start".
    const outsideTolerance = (fullDataRange.minTime + SNAP_TOLERANCE_US + 1) as ReturnType<typeof isoToMicros>;
    const result = snapSelectionToLogLine(outsideTolerance, lines, fullDataRange, 'start');
    // Closest line is still lines[0] since the gap to line[1] is larger
    expect(result).toBe(lines[0].isoTimestamp);
  });

  it('returns "end" when a boundary is just outside tolerance of the maximum (end edge)', () => {
    // Value is SNAP_TOLERANCE_US + 1 away from the maximum — must NOT snap to "end".
    const outsideTolerance = (fullDataRange.maxTime - SNAP_TOLERANCE_US - 1) as ReturnType<typeof isoToMicros>;
    const result = snapSelectionToLogLine(outsideTolerance, lines, fullDataRange, 'end');
    // Closest line is still lines[4] (the last line)
    expect(result).toBe(lines[lines.length - 1].isoTimestamp);
  });
});
