/**
 * Time Utilities
 * 
 * This module provides time conversion and formatting functions.
 * See src/types/time.types.ts for type definitions and documentation.
 * 
 * ## Key Concepts
 * - Internal representation: microseconds since Unix epoch (TimestampMicros)
 * - Input format: ISO 8601 datetime strings (ISODateTimeString)
 * - Display format: Time-only strings for UI (HH:MM:SS or HH:MM:SS.ssssss)
 * - URL format: Full ISO datetime or shortcuts
 */

import type { 
  TimestampMicros, 
  ISODateTimeString, 
  TimeFilterValue,
  TimeDisplayFormat 
} from '../types/time.types';
import { 
  MICROS_PER_MILLISECOND, 
  MICROS_PER_SECOND,
  isTimeFilterShortcutOrKeyword 
} from '../types/time.types';

// =============================================================================
// Core Conversion Functions
// =============================================================================

/**
 * Parse ISO 8601 datetime string to microseconds since epoch.
 * Preserves full microsecond precision from the input.
 * 
 * @param iso - ISO datetime string (e.g., "2026-01-26T16:01:13.382222Z")
 * @returns Microseconds since Unix epoch, or 0 if parsing fails
 * 
 * @example
 * isoToMicros("2026-01-26T16:01:13.382222Z") // Returns microseconds timestamp
 * isoToMicros("2026-01-26T16:01:13Z")        // Works without fractional seconds
 */
export function isoToMicros(iso: ISODateTimeString): TimestampMicros {
  if (!iso) return 0;

  // Match ISO format: YYYY-MM-DDTHH:MM:SS[.fraction]Z
  const match = iso.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z)?$/);
  if (!match) return 0;

  const basePart = match[1];
  const fractionPart = match[2] || '0';
  
  // Parse base datetime (truncate to seconds)
  const baseMs = Date.parse(`${basePart}Z`);
  if (Number.isNaN(baseMs)) return 0;

  // Parse fractional seconds to microseconds
  // Pad or truncate to exactly 6 digits for microsecond precision
  const microsFraction = parseInt(fractionPart.padEnd(6, '0').slice(0, 6), 10);
  
  // Convert base ms to micros and add fractional part
  return (baseMs * MICROS_PER_MILLISECOND) + microsFraction;
}

/**
 * Convert microseconds since epoch to ISO 8601 datetime string.
 * Outputs with full microsecond precision.
 * 
 * @param micros - Microseconds since Unix epoch
 * @returns ISO datetime string with microseconds (e.g., "2026-01-26T16:01:13.382222Z")
 */
export function microsToISO(micros: TimestampMicros): ISODateTimeString {
  if (!micros || micros < 0) return '';
  
  // Extract milliseconds and remaining microseconds
  const ms = Math.floor(micros / MICROS_PER_MILLISECOND);
  const remainingMicros = micros % MICROS_PER_MILLISECOND;
  
  // Get ISO string from Date (has millisecond precision)
  const date = new Date(ms);
  const isoBase = date.toISOString(); // "2026-01-26T16:01:13.382Z"
  
  // Replace milliseconds with full microseconds
  const msMatch = isoBase.match(/^(.+\.)(\d{3})Z$/);
  if (msMatch) {
    const basePart = msMatch[1];
    const msDigits = msMatch[2];
    // Combine ms digits with remaining micros to get 6-digit fraction
    const fullMicros = parseInt(msDigits, 10) * 1000 + remainingMicros;
    return `${basePart}${fullMicros.toString().padStart(6, '0')}Z`;
  }
  
  return isoBase;
}

/**
 * Convert microseconds to milliseconds (for compatibility with existing code).
 * Note: This loses microsecond precision.
 */
export function microsToMs(micros: TimestampMicros): number {
  return Math.floor(micros / MICROS_PER_MILLISECOND);
}

/**
 * Convert milliseconds to microseconds.
 */
export function msToMicros(ms: number): TimestampMicros {
  return ms * MICROS_PER_MILLISECOND;
}

// =============================================================================
// Display Formatting Functions
// =============================================================================

/**
 * Format a timestamp for display.
 * All times are displayed in UTC.
 * 
 * @param micros - Microseconds since epoch
 * @param format - Display format (default: 'HH:MM:SS')
 * @returns Formatted time string
 */
export function formatTimestamp(micros: TimestampMicros, format: TimeDisplayFormat = 'HH:MM:SS'): string {
  if (!micros || micros < 0) return '';
  
  const iso = microsToISO(micros);
  
  switch (format) {
    case 'HH:MM': {
      const match = iso.match(/T(\d{2}:\d{2})/);
      return match ? match[1] : '';
    }
    case 'HH:MM:SS': {
      const match = iso.match(/T(\d{2}:\d{2}:\d{2})/);
      return match ? match[1] : '';
    }
    case 'HH:MM:SS.us': {
      const match = iso.match(/T(\d{2}:\d{2}:\d{2}\.\d{6})/);
      return match ? match[1] : '';
    }
    case 'ISO':
      return iso;
  }
}

/**
 * Extract time-only portion from ISO datetime string.
 * Used for display when date is not needed.
 * 
 * @param iso - ISO datetime string
 * @returns Time portion (e.g., "16:01:13.382222")
 */
export function extractTimeFromISO(iso: ISODateTimeString): string {
  if (!iso) return '';
  const match = iso.match(/T([\d:.]+)Z?$/);
  return match ? match[1] : iso;
}

export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// =============================================================================
// URL Format Functions
// =============================================================================

/**
 * Check if a string is a full ISO datetime (contains date portion).
 * Examples: "2022-04-15T09:45:19.968Z", "2022-04-15T09:45:19Z"
 */
export function isFullISODatetime(timeStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(timeStr);
}

/**
 * Convert a filter value to URL format.
 * - ISO datetimes are kept as-is
 * - Shortcuts and keywords are kept as-is
 * 
 * @param value - Time filter value
 * @returns URL-safe string representation
 */
export function filterValueToURL(value: TimeFilterValue | null): string | null {
  if (!value) return null;
  // Shortcuts and keywords pass through unchanged
  if (isTimeFilterShortcutOrKeyword(value)) {
    return value;
  }
  // ISO datetime strings pass through unchanged
  return value;
}

/**
 * Parse URL parameter to time filter value.
 * 
 * @param urlValue - Value from URL parameter
 * @returns Parsed TimeFilterValue or null
 */
export function urlToFilterValue(urlValue: string | null): TimeFilterValue | null {
  if (!urlValue) return null;
  // Shortcuts and keywords pass through unchanged
  if (isTimeFilterShortcutOrKeyword(urlValue)) {
    return urlValue;
  }
  // Full ISO datetime strings pass through unchanged
  if (isFullISODatetime(urlValue)) {
    return urlValue;
  }
  // Invalid format
  return null;
}

// =============================================================================
// Legacy Compatibility Functions (to be removed after migration)
// =============================================================================

/**
 * Convert time string to milliseconds.
 * Note: Milliseconds lose sub-millisecond precision. Use isoToMicros() for full accuracy.
 */
export function timeToMs(timeStr: string): number {
  if (!timeStr) return 0;

  // Handle full ISO datetime
  if (timeStr.includes('T')) {
    const micros = isoToMicros(timeStr);
    if (micros > 0) {
      return microsToMs(micros);
    }
  }

  // Handle time-only format (legacy) - convert to microseconds from midnight
  const timeMatch = timeStr.match(/^(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?$/);
  if (!timeMatch) return 0;

  const hours = parseInt(timeMatch[1], 10);
  const minutes = parseInt(timeMatch[2], 10);
  const seconds = parseInt(timeMatch[3], 10);
  const fractionStr = timeMatch[4] || '0';
  const fraction = parseFloat(`0.${fractionStr}`);
  
  return (
    hours * 3600000 + 
    minutes * 60000 + 
    seconds * 1000 + 
    Math.floor(fraction * 1000)
  );
}

export function timeToURLFormat(timeValue: string | null): string | null {
  return filterValueToURL(timeValue);
}

export function urlToTimeFormat(urlValue: string | null): string | null {
  if (!urlValue) return null;
  // Keep shortcuts and keywords as-is
  if (urlValue === 'start' || urlValue === 'end' || urlValue.startsWith('last')) {
    return urlValue;
  }
  // Full ISO datetimes pass through
  if (isFullISODatetime(urlValue)) {
    return urlValue;
  }
  return urlValue;
}

export function msToISO(timestampMs: number): ISODateTimeString {
  return microsToISO(msToMicros(timestampMs));
}

export function isoToTime(isoStr: string): string {
  return extractTimeFromISO(isoStr);
}

// =============================================================================
// Input Parsing Functions
// =============================================================================

/**
 * Parse and validate a time filter input string.
 * Accepts shortcuts, keywords, time-only strings, or full ISO datetime.
 * 
 * @param input - User input string
 * @returns Validated TimeFilterValue or null if invalid
 */
export function parseTimeInput(input: string): TimeFilterValue | null {
  if (!input || typeof input !== 'string') return null;

  const trimmed = input.trim();

  // Handle shortcuts and keywords
  if (isTimeFilterShortcutOrKeyword(trimmed)) {
    return trimmed;
  }

  // Handle full ISO datetime format (YYYY-MM-DDTHH:MM:SS[.ffffff]Z)
  if (isFullISODatetime(trimmed)) {
    const isoRegex = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z?$/;
    const isoMatch = trimmed.match(isoRegex);
    if (isoMatch) {
      const hour = parseInt(isoMatch[1], 10);
      const minute = parseInt(isoMatch[2], 10);
      const second = parseInt(isoMatch[3], 10);

      if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59) {
        // Ensure it ends with Z for consistency
        return trimmed.endsWith('Z') ? trimmed : `${trimmed}Z`;
      }
    }
    return null;
  }

  // Handle time-only format (HH:MM:SS or HH:MM:SS.ffffff) - legacy support
  // Note: This should be avoided in new code; use full ISO datetime instead
  const timeRegex = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;
  const match = trimmed.match(timeRegex);
  if (match) {
    const hour = parseInt(match[1], 10);
    const minute = parseInt(match[2], 10);
    const second = parseInt(match[3], 10);

    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59) {
      // For legacy time-only input, return as-is (will be handled by caller)
      return trimmed;
    }
  }

  return null;
}

// =============================================================================
// Time Shortcut Functions
// =============================================================================

/**
 * Convert a time shortcut to microseconds offset.
 * 
 * @param shortcut - Time shortcut (e.g., 'last-5-min')
 * @returns Offset in microseconds
 */
export function shortcutToMicros(shortcut: string): TimestampMicros {
  const shortcuts: Record<string, TimestampMicros> = {
    /* eslint-disable @typescript-eslint/naming-convention */
    'last-min': 60 * MICROS_PER_SECOND,
    'last-5-min': 5 * 60 * MICROS_PER_SECOND,
    'last-10-min': 10 * 60 * MICROS_PER_SECOND,
    'last-hour': 60 * 60 * MICROS_PER_SECOND,
    'last-day': 24 * 60 * 60 * MICROS_PER_SECOND,
    /* eslint-enable @typescript-eslint/naming-convention */
  };
  return shortcuts[shortcut] || 0;
}

export function shortcutToMs(shortcut: string): number {
  return microsToMs(shortcutToMicros(shortcut));
}

/**
 * Get display name for a time value (shortcut or ISO time)
 */
export function getTimeDisplayName(timeValue: string | null): string {
  if (!timeValue) return '';
  if (timeValue === 'start') return 'Start of log';
  if (timeValue === 'end') return 'End of log';
  if (timeValue === 'last-min') return 'Last min';
  if (timeValue === 'last-5-min') return 'Last 5 min';
  if (timeValue === 'last-10-min') return 'Last 10 min';
  if (timeValue === 'last-hour') return 'Last hour';
  if (timeValue === 'last-day') return 'Last day';
  // For ISO datetime, show time-only portion for readability
  if (isFullISODatetime(timeValue)) {
    return extractTimeFromISO(timeValue);
  }
  return timeValue;
}

// =============================================================================
// Time Range Utilities
// =============================================================================

/**
 * Compute the minimum and maximum `timestampUs` values from an array of log lines.
 *
 * Uses a linear scan instead of `Math.min(...spread)` / `Math.max(...spread)` to
 * avoid stack-overflow errors on large log files (JS spread has a call-stack limit).
 *
 * @param lines - Array of objects carrying a `timestampUs` field (microseconds).
 * @returns `{ min, max }` as `TimestampMicros`. Both are 0 when no line has `timestampUs > 0`.
 *
 * @example
 * const { min, max } = getMinMaxTimestamps(rawLogLines);
 * // min = earliest positive timestamp, max = latest positive timestamp
 */
export function getMinMaxTimestamps(lines: Array<{ timestampUs: TimestampMicros }>): { min: TimestampMicros; max: TimestampMicros } {
  let min = Infinity;
  let max = -Infinity;
  for (const line of lines) {
    const t = line.timestampUs;
    if (t > 0) {
      if (t < min) min = t;
      if (t > max) max = t;
    }
  }
  if (min === Infinity) return { min: 0 as TimestampMicros, max: 0 as TimestampMicros };
  return { min: min as TimestampMicros, max: max as TimestampMicros };
}

// =============================================================================
// Time Range Calculation Functions
// =============================================================================

/**
 * Calculate the actual time range in microseconds given filter values.
 * 
 * @param startFilter - Start time filter (ISO datetime, shortcut, or keyword)
 * @param endFilter - End time filter (ISO datetime, shortcut, or keyword)
 * @param minLogTimeUs - Minimum timestamp in log (microseconds)
 * @param maxLogTimeUs - Maximum timestamp in log (microseconds)
 * @returns { startUs, endUs } range in microseconds
 */
export function calculateTimeRangeMicros(
  startFilter: TimeFilterValue | null,
  endFilter: TimeFilterValue | null,
  minLogTimeUs: TimestampMicros,
  maxLogTimeUs: TimestampMicros
): { startUs: TimestampMicros; endUs: TimestampMicros } {
  // Default: full range
  if (!startFilter && !endFilter) {
    return { startUs: minLogTimeUs, endUs: maxLogTimeUs };
  }

  // End time (reference point)
  let endUs = maxLogTimeUs;
  if (endFilter) {
    if (endFilter === 'end') {
      endUs = maxLogTimeUs;
    } else if (isFullISODatetime(endFilter)) {
      endUs = isoToMicros(endFilter);
    }
    // Ignore invalid filters, keep maxLogTimeUs
  }

  // Start time
  let startUs = minLogTimeUs;
  if (startFilter) {
    if (startFilter === 'start') {
      startUs = minLogTimeUs;
    } else if (startFilter.startsWith('last-')) {
      // Shortcut: calculate offset from end
      const offsetUs = shortcutToMicros(startFilter);
      startUs = Math.max(minLogTimeUs, endUs - offsetUs);
    } else if (isFullISODatetime(startFilter)) {
      startUs = isoToMicros(startFilter);
    }
    // Ignore invalid filters
  }

  return { startUs, endUs };
}

/**
 * Check if a microsecond timestamp is within the given time range.
 */
export function isInTimeRangeMicros(
  timestampUs: TimestampMicros,
  startUs: TimestampMicros,
  endUs: TimestampMicros
): boolean {
  return timestampUs >= startUs && timestampUs <= endUs;
}

// =============================================================================
// Time Range Filter Functions
// =============================================================================

/**
 * Apply time range filter to a list of requests using rawLogLines for timestamps.
 * Uses microsecond precision for filtering.
 * 
 * @param requests - Requests to filter (must have responseLineNumber)
 * @param rawLogLines - Parsed log lines with timestamps
 * @param startFilter - Start time filter value
 * @param endFilter - End time filter value
 * @returns Filtered requests within the time range
 */
/**
 * Count the total number of requests for a time window, always including incomplete
 * items (responseLineNumber === 0) in the count regardless of whether callers
 * choose to display them.
 *
 * This is the canonical denominator for the "X / Y" stats display.
 * - No filter → all requests (incomplete already included).
 * - Filter active → completed requests whose response falls in the window +
 *                   all incomplete requests (they have no response timestamp to
 *                   compare, so they are treated as always in-scope).
 *
 * Centralising this here prevents the bug where two views each computed the
 * denominator differently.
 */
export function countRequestsForTimeRange<T extends { responseLineNumber: number }>(
  requests: T[],
  rawLogLines: Array<{ lineNumber: number; timestampUs: TimestampMicros }>,
  startFilter: TimeFilterValue | null,
  endFilter: TimeFilterValue | null
): number {
  if (!startFilter && !endFilter) return requests.length;
  const incompleteCount = requests.filter(r => !r.responseLineNumber).length;
  const completedInRange = applyTimeRangeFilterMicros(requests, rawLogLines, startFilter, endFilter).length;
  return completedInRange + incompleteCount;
}

export function applyTimeRangeFilterMicros<T extends { responseLineNumber: number }>(
  requests: T[],
  rawLogLines: Array<{ lineNumber: number; timestampUs: TimestampMicros }>,
  startFilter: TimeFilterValue | null,
  endFilter: TimeFilterValue | null
): T[] {
  if (!startFilter && !endFilter) return requests;

  // Find min/max time from rawLogLines
  const validTimes = rawLogLines.map((l) => l.timestampUs).filter((t) => t > 0);
  if (validTimes.length === 0) return requests;
  
  const minLogTimeUs = Math.min(...validTimes);
  const maxLogTimeUs = Math.max(...validTimes);

  // Calculate actual start and end times
  const { startUs, endUs } = calculateTimeRangeMicros(startFilter, endFilter, minLogTimeUs, maxLogTimeUs);

  return requests.filter((r) => {
    if (!r.responseLineNumber) return false;
    const responseLine = rawLogLines.find(l => l.lineNumber === r.responseLineNumber);
    if (!responseLine || !responseLine.timestampUs) return false;
    return isInTimeRangeMicros(responseLine.timestampUs, startUs, endUs);
  });
}

/**
 * Format a duration in milliseconds as a human-readable string.
 * Returns seconds with 2 decimal places for >= 1000ms, otherwise milliseconds.
 */
export function formatDuration(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  return `${ms.toFixed(0)}ms`;
}

// =============================================================================
// Selection Snapping
// =============================================================================

/**
 * Maximum distance (in microseconds) within which a selection boundary is
 * considered to "align" with the data edge and is therefore represented by the
 * `"start"` / `"end"` URL keyword rather than an absolute timestamp.
 *
 * 1 000 µs = 1 ms — generous enough to absorb floating-point drift while still
 * being much smaller than any real gap between consecutive log entries.
 */
export const SNAP_TOLERANCE_US = 1_000 as TimestampMicros;

/**
 * Snap a local selection boundary to the ISO timestamp string of the nearest
 * log line, or to the `"start"` / `"end"` keyword when the value is within
 * {@link SNAP_TOLERANCE_US} of the data edge.
 *
 * This is pure domain logic extracted from the `handleApplyGlobally` handler in
 * `SummaryView` so that it can be tested independently of any React component.
 *
 * @param us - The selection boundary in microseconds.
 * @param rawLogLines - All parsed log lines (used to find the nearest match).
 * @param fullDataRange - The absolute min/max of the loaded log data.
 * @param edge - Whether this boundary is the `"start"` or `"end"` of the
 *   selection (controls which keyword is returned when within tolerance).
 * @returns An ISO timestamp string from the nearest log line, or `"start"` /
 *   `"end"` when the value aligns with the data edge.
 *
 * @example
 * // Selection starts exactly at the data minimum → returns "start"
 * snapSelectionToLogLine(minTime, lines, { minTime, maxTime }, "start")
 * // => "start"
 *
 * // Selection starts mid-range → returns the ISO timestamp of the nearest line
 * snapSelectionToLogLine(midTime, lines, { minTime, maxTime }, "start")
 * // => "2026-01-28T13:24:43.950890Z"
 */
export function snapSelectionToLogLine(
  us: TimestampMicros,
  rawLogLines: Array<{ timestampUs: TimestampMicros; isoTimestamp: string }>,
  fullDataRange: { minTime: TimestampMicros; maxTime: TimestampMicros },
  edge: 'start' | 'end'
): string {
  if (rawLogLines.length === 0) return edge;
  const edgeTime = edge === 'start' ? fullDataRange.minTime : fullDataRange.maxTime;
  if (Math.abs(us - edgeTime) <= SNAP_TOLERANCE_US) {
    return edge;
  }
  const closestLine = rawLogLines.reduce((best, line) =>
    Math.abs(line.timestampUs - us) < Math.abs(best.timestampUs - us) ? line : best
  );
  return closestLine.isoTimestamp;
}
