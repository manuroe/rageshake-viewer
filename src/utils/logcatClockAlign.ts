import type { LogParserResult, ParsedLogLine } from '../types/log.types';
import type { ISODateTimeString, TimestampMicros } from '../types/time.types';
import type { NamedLogParserResult } from './mergeLogParserResults';
import { microsToISO, getMinMaxTimestamps } from './timeUtils';

/** 15 minutes in microseconds — the granularity real-world UTC offsets use. */
const QUARTER_HOUR_US = 15 * 60 * 1e6;

/**
 * Minimum rounded skew treated as a timezone offset rather than ordinary
 * capture jitter. Logcat is dumped moments before the rageshake is sent, so a
 * genuine same-clock logcat ends within seconds of the tracing logs. Offsets
 * step in quarter hours (see QUARTER_HOUR_US) but no inhabited zone sits within
 * half an hour of UTC, so half an hour is the safe floor: below it, a rounded
 * difference is jitter rather than a device in another timezone.
 */
const MIN_SKEW_US = 30 * 60 * 1e6;

/**
 * Estimate the clock skew of a logcat file against the UTC tracing logs of the
 * same rageshake.
 *
 * Why: Android logcat timestamps are device-local time while the Rust tracing
 * files are UTC, and both are captured at rageshake-submission time. Merging
 * them on one axis without correction fabricates multi-hour "gaps" and
 * phantom activity clusters. Since both files end at submission, the
 * difference between their last timestamps is the device's UTC offset plus a
 * few seconds of jitter — rounding to the nearest quarter hour (the smallest
 * real timezone granularity) recovers the offset exactly.
 *
 * @param logcatMaxUs - last timestamp of the logcat file (device-local clock)
 * @param tracingMaxUs - last timestamp across the UTC tracing files
 * @returns microseconds to ADD to logcat timestamps to align them with UTC;
 *   `0` when the clocks already agree (or either input is missing)
 *
 * @example
 * // Tracing ends at 08:00, logcat 2h 38s "later" at 10:00:38 — a UTC+2 device:
 * estimateLogcatSkewUs(36_038_000_000, 28_800_000_000); // -7_200_000_000
 * // Same clock (logcat dumped 38s after the last tracing line):
 * estimateLogcatSkewUs(28_838_000_000, 28_800_000_000); // 0
 */
export function estimateLogcatSkewUs(
  logcatMaxUs: TimestampMicros | number,
  tracingMaxUs: TimestampMicros | number,
): number {
  if (!logcatMaxUs || !tracingMaxUs) return 0;
  const diff = tracingMaxUs - logcatMaxUs;
  const rounded = Math.round(diff / QUARTER_HOUR_US) * QUARTER_HOUR_US;
  return Math.abs(rounded) < MIN_SKEW_US ? 0 : rounded;
}

/**
 * Return a copy of a logcat `LogParserResult` with every timestamped line
 * shifted by `skewUs`, so its lines merge correctly with the UTC tracing
 * files.
 *
 * Only `rawLogLines` is rewritten: logcat results carry nothing else (see
 * `parseLogcatContent`). Lines without a timestamp (section headers before the
 * first dated line, `timestampUs === 0`) are left untouched.
 *
 * @param result - the parsed logcat file
 * @param skewUs - microseconds to add, from {@link estimateLogcatSkewUs}
 * @returns a new result with shifted `timestampUs` / `isoTimestamp` /
 *   `displayTime`; the same object when `skewUs` is `0`
 *
 * @example
 * const aligned = alignLogcatResult(logcatResult, -7_200_000_000);
 * aligned.rawLogLines[0].isoTimestamp; // two hours earlier, now in UTC
 */
export function alignLogcatResult(result: LogParserResult, skewUs: number): LogParserResult {
  if (skewUs === 0) return result;
  const rawLogLines: ParsedLogLine[] = result.rawLogLines.map((line) => {
    if (!line.timestampUs) return line;
    const timestampUs = (line.timestampUs + skewUs) as TimestampMicros;
    const isoTimestamp = microsToISO(timestampUs) as ISODateTimeString;
    // displayTime is the time-of-day portion of the ISO timestamp, matching
    // the HH:MM:SS.ssssss format the rest of the app derives from it.
    const displayTime = isoTimestamp.slice(11, 26);
    return { ...line, timestampUs, isoTimestamp, displayTime };
  });
  return { ...result, rawLogLines };
}

/**
 * Is this archive entry an Android logcat dump (device-local clock)?
 *
 * Prefix match, not `/^logcat\b/`: `\b` does not fire before `_`, so a dump
 * named `logcat_main.log` would be read as a UTC tracing file — left
 * uncorrected *and* poisoning the reference clock the correction is measured
 * against. Do not tighten this back to a word boundary.
 */
export function isLogcatFile(name: string): boolean {
  return /^logcat/i.test(name.split('/').pop() ?? name);
}

/**
 * Align every logcat file in a set onto the UTC clock of its tracing siblings,
 * before the set is handed to `mergeLogParserResults`.
 *
 * Both the CLI and the viewer merge the same archive, so both call this — a
 * timestamp printed by `rageshake grep` and the same line opened through a deep
 * link have to agree.
 *
 * One skew is derived for the whole set, from the latest logcat timestamp
 * against the latest tracing timestamp, and then applied to every logcat entry
 * or to none. Estimating per file would let two dumps off the same device clock
 * be shifted by different amounts, and the single returned `skewUs` could then
 * describe only the last of them — so the returned value is true of every file
 * that moved, by construction.
 *
 * @param files - the parsed archive entries, logcat and tracing mixed
 * @returns the files with logcat results shifted, and the applied skew (`0`
 *   when nothing was corrected) so callers can disclose it
 */
export function alignLogcatFiles(
  files: readonly NamedLogParserResult[],
): { files: readonly NamedLogParserResult[]; skewUs: number } {
  const lastUs = (r: LogParserResult): number => getMinMaxTimestamps(r.rawLogLines).max;
  const maxOf = (wantLogcat: boolean): number => files.reduce(
    (max, f) => (isLogcatFile(f.name) === wantLogcat ? Math.max(max, lastUs(f.result)) : max), 0);

  const skewUs = estimateLogcatSkewUs(maxOf(true), maxOf(false));
  if (skewUs === 0) return { files, skewUs };
  return {
    files: files.map((f) => (isLogcatFile(f.name)
      ? { name: f.name, result: alignLogcatResult(f.result, skewUs) }
      : f)),
    skewUs,
  };
}
