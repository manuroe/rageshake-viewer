import type { LogParserResult, ParsedLogLine, LogLevel } from '../types/log.types';
import type { ISODateTimeString, TimestampMicros } from '../types/time.types';
import { isoToMicros } from './timeUtils';

/**
 * Regex matching a standard Android logcat threadtime format line:
 * `MM-DD HH:MM:SS.mmm  PID  TID LEVEL TAG: message`
 *
 * Groups:
 * 1. `monthDay` — "MM-DD" date portion
 * 2. `time`     — "HH:MM:SS.mmm" time portion
 * 3. `level`    — single-char priority letter (V/D/I/W/E/F)
 * 4. `tag`      — log tag (up to and not including the colon)
 * 5. `msg`      — message body after "TAG: "
 *
 * @example
 * LOGCAT_LINE_RE.test('04-13 07:45:09.124  8730  8730 E AndroidRuntime: FATAL EXCEPTION');
 * // true
 */
export const LOGCAT_LINE_RE =
  /^(\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}\.\d{3})\s+\d+\s+\d+\s+([VDIWEF])\s+(.+?):\s*(.*)/;

/**
 * Maps a single-character Android logcat priority letter to the app's
 * internal `LogLevel` enum value.
 *
 * Android priority → app level:
 * - V (Verbose)  → TRACE
 * - D (Debug)    → DEBUG
 * - I (Info)     → INFO
 * - W (Warning)  → WARN
 * - E (Error)    → ERROR
 * - F (Fatal)    → ERROR
 *
 * Any unrecognised character falls back to UNKNOWN.
 *
 * @example
 * logcatLevelToLogLevel('E'); // 'ERROR'
 * logcatLevelToLogLevel('V'); // 'TRACE'
 * logcatLevelToLogLevel('F'); // 'ERROR'
 * logcatLevelToLogLevel('?'); // 'UNKNOWN'
 */
export function logcatLevelToLogLevel(char: string): LogLevel {
  switch (char) {
    case 'V': return 'TRACE';
    case 'D': return 'DEBUG';
    case 'I': return 'INFO';
    case 'W': return 'WARN';
    case 'E':
    case 'F': return 'ERROR';
    default:  return 'UNKNOWN';
  }
}

/**
 * Detect whether `content` is an Android logcat file by checking whether at
 * least 2 of the first 50 non-empty lines match the logcat threadtime format.
 *
 * Detection is based **purely on the timestamp and line structure** — the
 * presence of `--------- beginning of ...` section headers is not required.
 * This avoids false negatives when a logcat extract starts mid-section.
 *
 * Rageshake log lines always begin with a four-digit year
 * (`2026-01-26T...`), so they can never match `LOGCAT_LINE_RE`, which
 * requires a two-digit month-day prefix (`MM-DD`).
 *
 * @example
 * isLogcatFormat('04-13 07:45:09.124  8730  8730 E Tag: msg\n...');
 * // true
 * isLogcatFormat('2026-01-26T16:01:13.382222Z  INFO [sdk] hello\n...');
 * // false
 */
export function isLogcatFormat(content: string): boolean {
  let checked = 0;
  let matched = 0;
  let start = 0;

  while (start <= content.length) {
    const end = content.indexOf('\n', start);
    const line = end === -1 ? content.slice(start) : content.slice(start, end);
    const trimmed = line.trim();

    if (trimmed) {
      if (LOGCAT_LINE_RE.test(trimmed)) {
        matched++;
        if (matched >= 2) return true;
      }

      checked++;
      if (checked >= 50) break;
    }

    if (end === -1) break;
    start = end + 1;
  }

  return false;
}

/**
 * Infer the full four-digit year for a logcat date.
 *
 * Android logcat lines only carry a `MM-DD` date; the year is missing.
 * We use the current year as the default and roll back one year when the
 * parsed month is strictly greater than today's month — a simple heuristic
 * that handles logs captured at year boundaries (e.g. a log from December
 * viewed in January).
 *
 * @param month - 1-based month number parsed from the log line
 * @param referenceDate - the date to compare against (defaults to today; injectable for tests)
 * @returns four-digit year string, e.g. `"2026"`
 *
 * @example
 * // Viewing in April 2026, log from December 2025:
 * inferLogcatYear(12, new Date('2026-04-14')); // '2025'
 * // Viewing in April 2026, log from March 2026:
 * inferLogcatYear(3,  new Date('2026-04-14')); // '2026'
 */
export function inferLogcatYear(month: number, referenceDate: Date = new Date()): string {
  const currentYear = referenceDate.getFullYear();
  const currentMonth = referenceDate.getMonth() + 1; // getMonth() is 0-based
  return String(month > currentMonth ? currentYear - 1 : currentYear);
}

/**
 * Parse an Android logcat file (threadtime format) into a `LogParserResult`.
 *
 * Only `rawLogLines` is populated. The `requests`, `httpRequests`,
 * `connectionIds`, and `sentryEvents` arrays are always empty because logcat
 * does not carry the rageshake HTTP span data needed to reconstruct those.
 * The `/summary` and `/logs` views degrade gracefully when those arrays are
 * empty, displaying only log-level counts and the raw log stream.
 *
 * Lines that do not match the logcat format (e.g. `--------- beginning of crash`
 * section headers) are emitted as `UNKNOWN`-level entries with the last-seen
 * timestamp so they remain visible in the `/logs` view and stay in order
 * during time-range filtering.
 *
 * @example
 * const result = parseLogcatContent('04-13 07:45:09.124  8730  8730 E Tag: msg');
 * result.rawLogLines[0].level;       // 'ERROR'
 * result.rawLogLines[0].strippedMessage; // 'Tag: msg'
 */
export function parseLogcatContent(content: string): LogParserResult {
  const lines = content.split('\n');
  const rawLogLines: ParsedLogLine[] = [];

  // Tracks the last-seen timestamp so unmatched lines (e.g. section headers)
  // can inherit it and remain in the correct time-order position.
  let lastIsoTimestamp: ISODateTimeString = '' as ISODateTimeString;
  let lastTimestampUs: TimestampMicros = 0 as TimestampMicros;
  let lastDisplayTime = '';

  // Cache the inferred year per month so inferLogcatYear (with Date.now()) is
  // only called once per distinct month value across the whole file.
  const yearCache = new Map<number, string>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Match against the trimmed line for consistency with isLogcatFormat(),
    // while preserving the original line as rawText.
    const match = trimmed.match(LOGCAT_LINE_RE);
    if (!match) {
      // Unrecognised lines (e.g. "--------- beginning of crash" section headers)
      // are emitted as UNKNOWN entries so they are visible in the /logs view.
      // They inherit the last-seen timestamp to stay in time-order position.
      rawLogLines.push({
        lineNumber: i + 1,
        rawText: line,
        isoTimestamp: lastIsoTimestamp,
        timestampUs: lastTimestampUs,
        displayTime: lastDisplayTime,
        level: 'UNKNOWN',
        message: line,
        strippedMessage: line,
      });
      continue;
    }

    const [, monthDay, time, levelChar, tag, msg] = match;

    // Infer the year, caching per month to avoid repeated Date construction.
    const month = parseInt(monthDay.slice(0, 2), 10);
    let year = yearCache.get(month);
    if (year === undefined) {
      year = inferLogcatYear(month);
      yearCache.set(month, year);
    }

    // Build an ISO 8601 timestamp. Logcat milliseconds are padded to 3 digits;
    // we append three trailing zeros to produce the 6-digit microsecond precision
    // expected by isoToMicros() without synthesising fake precision.
    const isoTimestamp = `${year}-${monthDay}T${time}000Z` as ISODateTimeString;
    const timestampUs = isoToMicros(isoTimestamp);

    // displayTime: just the time portion from the logcat line (HH:MM:SS.mmm),
    // appended with "000" for consistency with the 6-digit display format used
    // elsewhere in the app (HH:MM:SS.ssssss).
    const displayTime = `${time}000`;

    lastIsoTimestamp = isoTimestamp;
    lastTimestampUs = timestampUs;
    lastDisplayTime = displayTime;

    const level = logcatLevelToLogLevel(levelChar);
    const strippedMessage = `${tag}: ${msg}`;

    rawLogLines.push({
      lineNumber: i + 1,
      rawText: line,
      isoTimestamp,
      timestampUs,
      displayTime,
      level,
      message: line,
      strippedMessage,
    });
  }

  // Backfill leading unmatched entries (timestampUs === 0) with the first
  // real timestamp found in the file. Without this, lines that appear before
  // the first data line (e.g. "--------- beginning of crash" at the top of
  // the file) would have timestampUs=0, fall outside the log's time range,
  // and be hidden by the time-range filter.
  const firstRealTimestamp = rawLogLines.find(l => l.timestampUs !== 0);
  if (firstRealTimestamp) {
    for (const entry of rawLogLines) {
      if (entry.timestampUs !== 0) break; // reached the first real entry
      // Cast away readonly to mutate the leading placeholder entries in place.
      const mutable = entry as { -readonly [K in keyof ParsedLogLine]: ParsedLogLine[K] };
      mutable.isoTimestamp = firstRealTimestamp.isoTimestamp;
      mutable.timestampUs = firstRealTimestamp.timestampUs;
      mutable.displayTime = firstRealTimestamp.displayTime;
    }
  }

  return {
    requests: [],
    httpRequests: [],
    connectionIds: [],
    rawLogLines,
    sentryEvents: [],
    isAnonymized: false,
  };
}
