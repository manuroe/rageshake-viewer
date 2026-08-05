import { describe, it, expect } from 'vitest';
import { estimateLogcatSkewUs, alignLogcatResult, alignLogcatFiles, isLogcatFile } from '../logcatClockAlign';
import { isoToMicros } from '../timeUtils';
import type { LogParserResult, ParsedLogLine } from '../../types/log.types';
import type { ISODateTimeString, TimestampMicros } from '../../types/time.types';

const HOUR_US = 3600e6;
const LINE_ISO = '2026-08-05T10:40:15.922000Z' as ISODateTimeString;
const LINE_US = isoToMicros(LINE_ISO);

function makeLine(overrides: Partial<ParsedLogLine>): ParsedLogLine {
  return {
    lineNumber: 1,
    rawText: '08-05 10:40:15.922  1  1 D Tag: msg',
    isoTimestamp: LINE_ISO,
    timestampUs: LINE_US,
    displayTime: '10:40:15.922000',
    level: 'DEBUG',
    message: 'Tag: msg',
    strippedMessage: 'Tag: msg',
    ...overrides,
  };
}

function makeResult(lines: readonly ParsedLogLine[]): LogParserResult {
  return {
    requests: [],
    httpRequests: [],
    connectionIds: [],
    rawLogLines: lines,
    sentryEvents: [],
  };
}

describe('estimateLogcatSkewUs', () => {
  it('recovers a whole-hour timezone offset despite capture jitter', () => {
    // Logcat (UTC+2 device clock) ends 2h + 40s "after" the tracing logs.
    const logcatMax = 10 * HOUR_US + 40e6;
    const tracingMax = 8 * HOUR_US;
    expect(estimateLogcatSkewUs(logcatMax, tracingMax)).toBe(-2 * HOUR_US);
  });

  it('recovers a quarter-hour offset (e.g. UTC+5:45)', () => {
    const logcatMax = 5.75 * HOUR_US + 12e6;
    const tracingMax = 0.25 * HOUR_US;
    expect(estimateLogcatSkewUs(logcatMax, tracingMax)).toBe(-5.5 * HOUR_US);
  });

  it('returns 0 when the clocks already agree', () => {
    // Logcat dumped 40 seconds after the last tracing line, same clock.
    expect(estimateLogcatSkewUs(8 * HOUR_US + 40e6, 8 * HOUR_US)).toBe(0);
  });

  it('returns 0 when either input is missing', () => {
    expect(estimateLogcatSkewUs(0, 8 * HOUR_US)).toBe(0);
    expect(estimateLogcatSkewUs(8 * HOUR_US, 0)).toBe(0);
  });
});

describe('alignLogcatResult', () => {
  it('shifts timestamped lines and rewrites the derived fields', () => {
    const result = makeResult([makeLine({})]);
    const aligned = alignLogcatResult(result, -2 * HOUR_US);
    const line = aligned.rawLogLines[0];
    expect(line.timestampUs).toBe(LINE_US - 2 * HOUR_US);
    expect(line.isoTimestamp).toBe('2026-08-05T08:40:15.922000Z');
    expect(line.displayTime).toBe('08:40:15.922000');
    // Untouched fields survive.
    expect(line.rawText).toBe(result.rawLogLines[0].rawText);
  });

  it('leaves untimestamped section headers alone', () => {
    const header = makeLine({
      timestampUs: 0 as TimestampMicros,
      isoTimestamp: '' as ISODateTimeString,
      displayTime: '',
      rawText: '--------- beginning of main',
    });
    const aligned = alignLogcatResult(makeResult([header]), -2 * HOUR_US);
    expect(aligned.rawLogLines[0]).toBe(header);
  });

  it('is the identity for zero skew', () => {
    const result = makeResult([makeLine({})]);
    expect(alignLogcatResult(result, 0)).toBe(result);
  });
});

describe('isLogcatFile', () => {
  it('matches logcat entries by basename, ignoring the archive path', () => {
    expect(isLogcatFile('rageshake/logcat.log.gz')).toBe(true);
    expect(isLogcatFile('logcat.log')).toBe(true);
    expect(isLogcatFile('console.2026-01-15-10.log.gz')).toBe(false);
    // Suffixed variants count too — `\b` would miss the underscore.
    expect(isLogcatFile('logcat_events.log')).toBe(true);
    // A name that merely contains "logcat" is not a logcat dump.
    expect(isLogcatFile('my-logcat.log')).toBe(false);
  });
});

describe('alignLogcatFiles', () => {
  const at = (iso: string) => makeResult([makeLine({
    isoTimestamp: iso as ISODateTimeString,
    timestampUs: isoToMicros(iso as ISODateTimeString),
  })]);

  it('shifts logcat onto the tracing clock and reports the skew', () => {
    const { files, skewUs } = alignLogcatFiles([
      { name: 'console.log', result: at('2026-08-05T08:00:00.000000Z') },
      { name: 'logcat.log', result: at('2026-08-05T10:00:40.000000Z') },
    ]);
    expect(skewUs).toBe(-2 * HOUR_US);
    // Tracing file passes through untouched, logcat is rewritten.
    expect(files[0].result.rawLogLines[0].isoTimestamp).toBe('2026-08-05T08:00:00.000000Z');
    expect(files[1].result.rawLogLines[0].isoTimestamp).toBe('2026-08-05T08:00:40.000000Z');
  });

  it('returns the same entries when no logcat needs correcting', () => {
    const input = [
      { name: 'console.log', result: at('2026-08-05T08:00:00.000000Z') },
      { name: 'logcat.log', result: at('2026-08-05T08:00:40.000000Z') },
    ];
    const { files, skewUs } = alignLogcatFiles(input);
    expect(skewUs).toBe(0);
    expect(files[1]).toBe(input[1]);
  });
});
