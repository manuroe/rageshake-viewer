/**
 * Log Message Utilities
 *
 * Pure helpers for parsing and normalising raw log message strings.
 * These functions are log-format-aware but have no React or store dependencies,
 * making them straightforward to unit-test in isolation.
 */

/**
 * Regular expression that matches the ISO timestamp + log-level prefix of a
 * Matrix Rust SDK log line, allowing the prefix to be stripped via
 * {@link stripLogPrefix}.
 *
 * Exported so consumers can reuse the canonical pattern without duplicating the
 * regex literal.
 *
 * @example
 * LOG_PREFIX_RE.test("2026-01-28T13:24:43.950890Z INFO foo") // => true
 * LOG_PREFIX_RE.test("2026-01-28T13:24:43Z INFO foo")       // => true (no fractions)
 * LOG_PREFIX_RE.test("2026-01-28T13:24:43.123456 INFO foo")  // => true (no Z)
 */
export const LOG_PREFIX_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\s+\w+\s+/;

/**
 * Strip the ISO timestamp + log-level prefix from a raw log line, keeping only
 * the message payload.
 *
 * Uses {@link LOG_PREFIX_RE} — the single canonical source for this pattern in
 * the codebase. If the line does not match, it is returned unchanged.
 *
 * @param rawText - Raw log line string.
 * @returns The payload portion, or the original string if no prefix is found.
 *
 * @example
 * stripLogPrefix("2026-01-28T13:24:43.950890Z INFO Something happened")
 * // => "Something happened"
 */
export function stripLogPrefix(rawText: string): string {
  return rawText.replace(LOG_PREFIX_RE, '');
}

/**
 * Strip the ISO timestamp prefix and log-level token from a raw log message,
 * returning only the payload text.
 *
 * Matrix Rust SDK log lines follow the pattern:
 *   `<ISO-timestamp>  <LEVEL>  <payload>`
 *
 * This is used to group duplicate error/warning messages by their semantic
 * content rather than by the full raw text (which would never be equal because
 * each line has a unique timestamp).
 *
 * If the input does not match the expected pattern the original string is
 * returned unchanged so callers never receive an empty result unexpectedly.
 *
 * @param message - Raw log message string (may contain leading timestamp + level).
 * @returns The payload portion of the message, or the original string if no
 *   timestamp prefix is recognised.
 *
 * @example
 * extractCoreMessage("2026-01-28T13:24:43.950890Z WARN Something went wrong")
 * // => "Something went wrong"
 *
 * extractCoreMessage("No timestamp here")
 * // => "No timestamp here"
 */
export function extractCoreMessage(message: string): string {
  // Pattern: ISO timestamp followed by TRACE|DEBUG|INFO|WARN|ERROR and the payload.
  // The timestamp and level are separated from the payload by arbitrary whitespace.
  // Fractional seconds (".SSSSSS") and trailing "Z" are both made optional to match
  // all formats that logParser's extractISOTimestamp accepts.
  const match = message.match(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\s+(?:TRACE|DEBUG|INFO|WARN|ERROR)\s+(.+)$/
  );
  if (match && match[1]) {
    return match[1].trim();
  }
  return message;
}
