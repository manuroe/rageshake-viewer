/**
 * Unit tests for logcatParser.ts
 * Tests format detection, level mapping, timestamp construction, and
 * integration with the top-level parseLogFile() entry point.
 */
import { describe, it, expect } from 'vitest';
import { isLogcatFormat, logcatLevelToLogLevel, inferLogcatYear, parseLogcatContent, LOGCAT_LINE_RE } from '../logcatParser';
import { parseLogFile } from '../logParser';

// ---------------------------------------------------------------------------
// Sample fixtures
// ---------------------------------------------------------------------------

const LOGCAT_LINE_E = '04-13 07:45:09.124  8730  8730 E AndroidRuntime: FATAL EXCEPTION: main';
const LOGCAT_LINE_W = '04-14 07:58:03.587 15386 15451 W ement.android.: No such thread id for suspend: 25';
const LOGCAT_LINE_I = '04-14 08:00:00.232 15386 15386 I oplus.android.OplusFrameworkFactoryImpl: Unknow feature:IOplusTextViewRTLUtilForUG';
const LOGCAT_LINE_D = '04-14 08:00:00.206 15386 15386 D AppCompatDelegate: Checking for metadata for AppLocalesMetadataHolderService : Service not found';
const LOGCAT_LINE_V = '04-14 08:00:01.000 15386 15386 V SomeTag: verbose message';
const LOGCAT_LINE_F = '04-14 08:00:02.000 15386 15386 F SomeTag: fatal message';

const LOGCAT_HEADER_CRASH = '--------- beginning of crash';
const LOGCAT_HEADER_MAIN  = '--------- beginning of main';

const RAGESHAKE_LINE  = '2026-01-26T16:01:13.382222Z  INFO [matrix-rust-sdk] hello world';
const RAGESHAKE_LINE2 = '2026-01-26T16:01:14.000000Z DEBUG [matrix-rust-sdk] another line';

const SAMPLE_LOGCAT = [
  LOGCAT_HEADER_CRASH,
  LOGCAT_LINE_E,
  '04-13 07:45:09.124  8730  8730 E AndroidRuntime: Process: io.element.android.x, PID: 8730',
  LOGCAT_HEADER_MAIN,
  LOGCAT_LINE_W,
  '04-14 08:00:00.205 15386 15386 E MultiApp.Impl: OplusMultiAppImpl',
  LOGCAT_LINE_D,
  LOGCAT_LINE_I,
].join('\n');

// ---------------------------------------------------------------------------
// isLogcatFormat
// ---------------------------------------------------------------------------

describe('isLogcatFormat', () => {
  it('returns true for a valid logcat snippet', () => {
    expect(isLogcatFormat(SAMPLE_LOGCAT)).toBe(true);
  });

  it('returns true even when file starts with section headers', () => {
    // Headers alone are not enough; there must be ≥2 matching data lines.
    const withHeaders = `${LOGCAT_HEADER_CRASH}\n${LOGCAT_LINE_E}\n${LOGCAT_HEADER_MAIN}\n${LOGCAT_LINE_W}`;
    expect(isLogcatFormat(withHeaders)).toBe(true);
  });

  it('returns false for a rageshake (ISO timestamp) log', () => {
    const rageshake = `${RAGESHAKE_LINE}\n${RAGESHAKE_LINE2}`;
    expect(isLogcatFormat(rageshake)).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isLogcatFormat('')).toBe(false);
  });

  it('returns false for only one matching line (below threshold)', () => {
    expect(isLogcatFormat(LOGCAT_LINE_E)).toBe(false);
  });

  it('returns false when only section headers are present', () => {
    expect(isLogcatFormat(`${LOGCAT_HEADER_CRASH}\n${LOGCAT_HEADER_MAIN}`)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// logcatLevelToLogLevel
// ---------------------------------------------------------------------------

describe('logcatLevelToLogLevel', () => {
  it.each([
    ['V', 'TRACE'],
    ['D', 'DEBUG'],
    ['I', 'INFO'],
    ['W', 'WARN'],
    ['E', 'ERROR'],
    ['F', 'ERROR'],
  ] as const)('maps %s → %s', (char, expected) => {
    expect(logcatLevelToLogLevel(char)).toBe(expected);
  });

  it('returns UNKNOWN for an unrecognised character', () => {
    expect(logcatLevelToLogLevel('?')).toBe('UNKNOWN');
    expect(logcatLevelToLogLevel('')).toBe('UNKNOWN');
  });
});

// ---------------------------------------------------------------------------
// inferLogcatYear
// ---------------------------------------------------------------------------

describe('inferLogcatYear', () => {
  it('returns the reference year when the log month <= current month', () => {
    // Log from March, viewing in April 2026
    expect(inferLogcatYear(3, new Date('2026-04-14'))).toBe('2026');
    // Log from April (same month), viewing in April 2026
    expect(inferLogcatYear(4, new Date('2026-04-14'))).toBe('2026');
  });

  it('rolls back one year when the log month > current month (year boundary)', () => {
    // Log from December, viewing in January 2026 → log must be from 2025
    expect(inferLogcatYear(12, new Date('2026-01-03'))).toBe('2025');
    // Log from November, viewing in April 2026 → log must be from 2025
    expect(inferLogcatYear(11, new Date('2026-04-14'))).toBe('2025');
  });
});

// ---------------------------------------------------------------------------
// LOGCAT_LINE_RE — regex structural tests
// ---------------------------------------------------------------------------

describe('LOGCAT_LINE_RE', () => {
  it('matches a well-formed logcat line and extracts all groups', () => {
    const m = LOGCAT_LINE_E.match(LOGCAT_LINE_RE);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('04-13');         // monthDay
    expect(m![2]).toBe('07:45:09.124'); // time
    expect(m![3]).toBe('E');             // level char
    expect(m![4]).toBe('AndroidRuntime'); // tag
    expect(m![5]).toBe('FATAL EXCEPTION: main'); // message (includes internal colons)
  });

  it('does not match a section header line', () => {
    expect(LOGCAT_LINE_RE.test(LOGCAT_HEADER_CRASH)).toBe(false);
  });

  it('does not match a rageshake ISO-timestamp line', () => {
    expect(LOGCAT_LINE_RE.test(RAGESHAKE_LINE)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// parseLogcatContent
// ---------------------------------------------------------------------------

describe('parseLogcatContent', () => {
  it('emits section header lines as UNKNOWN-level ParsedLogLine entries', () => {
    const result = parseLogcatContent(SAMPLE_LOGCAT);
    // SAMPLE_LOGCAT has 2 section headers → they appear as UNKNOWN entries
    const headerLines = result.rawLogLines.filter(l => l.rawText.startsWith('---------'));
    expect(headerLines).toHaveLength(2);
    headerLines.forEach(l => {
      expect(l.level).toBe('UNKNOWN');
      expect(l.strippedMessage).toBe(l.rawText);
    });
  });

  it('parses all lines from the sample including section headers as UNKNOWN', () => {
    const result = parseLogcatContent(SAMPLE_LOGCAT);
    // SAMPLE_LOGCAT has 2 section headers + 6 data lines = 8 total
    expect(result.rawLogLines).toHaveLength(8);
  });

  it('assigns physical line numbers (1-based) matching position in the file', () => {
    // SAMPLE_LOGCAT has no blank lines so physical and logical positions match.
    const result = parseLogcatContent(SAMPLE_LOGCAT);
    result.rawLogLines.forEach((line, idx) => {
      expect(line.lineNumber).toBe(idx + 1);
    });
  });

  it('physical line numbers skip blank lines and reflect true file position', () => {
    // Insert a blank line between two data lines; the second should get lineNumber 3.
    const withBlank = `${LOGCAT_LINE_E}\n\n${LOGCAT_LINE_W}`;
    const result = parseLogcatContent(withBlank);
    expect(result.rawLogLines[0].lineNumber).toBe(1);
    expect(result.rawLogLines[1].lineNumber).toBe(3); // blank line at index 1 → skip to 3
  });

  it('sets the correct level for data lines (headers are UNKNOWN)', () => {
    const result = parseLogcatContent(SAMPLE_LOGCAT);
    // Filter to data lines only (non-header)
    const dataLines = result.rawLogLines.filter(l => !l.rawText.startsWith('---------'));
    // Lines in SAMPLE_LOGCAT order: E, E, W, E, D, I
    expect(dataLines[0].level).toBe('ERROR');
    expect(dataLines[2].level).toBe('WARN');
    expect(dataLines[4].level).toBe('DEBUG');
    expect(dataLines[5].level).toBe('INFO');
  });

  it('builds a valid ISO timestamp', () => {
    const result = parseLogcatContent(LOGCAT_LINE_E + '\n' + LOGCAT_LINE_W);
    const first = result.rawLogLines[0];
    // Date portion: current year + 04-13; time: 07:45:09.124000
    expect(first.isoTimestamp).toMatch(/^\d{4}-04-13T07:45:09\.124000Z$/);
    expect(first.displayTime).toBe('07:45:09.124000');
  });

  it('produces a non-zero timestampUs', () => {
    const result = parseLogcatContent(LOGCAT_LINE_E + '\n' + LOGCAT_LINE_W);
    expect(result.rawLogLines[0].timestampUs).toBeGreaterThan(0);
  });

  it('sets strippedMessage to "TAG: message"', () => {
    const result = parseLogcatContent(LOGCAT_LINE_E + '\n' + LOGCAT_LINE_W);
    expect(result.rawLogLines[0].strippedMessage).toBe('AndroidRuntime: FATAL EXCEPTION: main');
  });

  it('sets message and rawText to the full raw line', () => {
    const result = parseLogcatContent(LOGCAT_LINE_E + '\n' + LOGCAT_LINE_W);
    expect(result.rawLogLines[0].message).toBe(LOGCAT_LINE_E);
    expect(result.rawLogLines[0].rawText).toBe(LOGCAT_LINE_E);
  });

  it('returns empty requests, httpRequests, connectionIds, and sentryEvents arrays', () => {
    const result = parseLogcatContent(SAMPLE_LOGCAT);
    expect(result.requests).toHaveLength(0);
    expect(result.httpRequests).toHaveLength(0);
    expect(result.connectionIds).toHaveLength(0);
    expect(result.sentryEvents).toHaveLength(0);
  });

  it('sets isAnonymized to false', () => {
    const result = parseLogcatContent(SAMPLE_LOGCAT);
    expect(result.isAnonymized).toBe(false);
  });

  it('handles a file that is only section headers (all become UNKNOWN entries)', () => {
    const onlyHeaders = `${LOGCAT_HEADER_CRASH}\n${LOGCAT_HEADER_MAIN}`;
    const result = parseLogcatContent(onlyHeaders);
    expect(result.rawLogLines).toHaveLength(2);
    result.rawLogLines.forEach(l => expect(l.level).toBe('UNKNOWN'));
  });

  it('section header inherits the last-seen timestamp for time-order positioning', () => {
    const withHeaderBetween = `${LOGCAT_LINE_E}\n${LOGCAT_HEADER_CRASH}\n${LOGCAT_LINE_W}`;
    const result = parseLogcatContent(withHeaderBetween);
    expect(result.rawLogLines).toHaveLength(3);
    const [first, header, second] = result.rawLogLines;
    expect(header.level).toBe('UNKNOWN');
    expect(header.rawText).toBe(LOGCAT_HEADER_CRASH);
    // Header inherits the preceding data line's timestamp
    expect(header.timestampUs).toBe(first.timestampUs);
    expect(second.timestampUs).toBeGreaterThanOrEqual(first.timestampUs);
  });

  it('section header at the start of file inherits the first data line timestamp', () => {
    const result = parseLogcatContent(`${LOGCAT_HEADER_CRASH}\n${LOGCAT_LINE_E}`);
    const [header, dataLine] = result.rawLogLines;
    expect(header.rawText).toBe(LOGCAT_HEADER_CRASH);
    // Leading headers are backfilled with the first real timestamp so that
    // the time-range filter does not hide them.
    expect(header.timestampUs).toBe(dataLine.timestampUs);
    expect(header.timestampUs).toBeGreaterThan(0);
  });

  it('handles all priority chars: V D I W E F', () => {
    const allLevels = [LOGCAT_LINE_V, LOGCAT_LINE_F, LOGCAT_LINE_D, LOGCAT_LINE_I, LOGCAT_LINE_W, LOGCAT_LINE_E].join('\n');
    const result = parseLogcatContent(allLevels);
    const levels = result.rawLogLines.map(l => l.level);
    expect(levels).toEqual(['TRACE', 'ERROR', 'DEBUG', 'INFO', 'WARN', 'ERROR']);
  });
});

// ---------------------------------------------------------------------------
// parseLogFile integration — logcat files route to the logcat parser
// ---------------------------------------------------------------------------

describe('parseLogFile with logcat input', () => {
  it('does not throw a ParsingError for a valid logcat file', () => {
    expect(() => parseLogFile(SAMPLE_LOGCAT)).not.toThrow();
  });

  it('returns rawLogLines with the parsed logcat data', () => {
    const result = parseLogFile(SAMPLE_LOGCAT);
    expect(result.rawLogLines.length).toBeGreaterThan(0);
  });

  it('returns empty HTTP request arrays (no rageshake span data)', () => {
    const result = parseLogFile(SAMPLE_LOGCAT);
    expect(result.requests).toHaveLength(0);
    expect(result.httpRequests).toHaveLength(0);
  });

  it('still parses a rageshake file correctly after the logcat check', () => {
    const rageshakeLog = `${RAGESHAKE_LINE}\n${RAGESHAKE_LINE2}`;
    const result = parseLogFile(rageshakeLog);
    expect(result.rawLogLines.length).toBe(2);
    expect(result.rawLogLines[0].level).toBe('INFO');
  });
});
