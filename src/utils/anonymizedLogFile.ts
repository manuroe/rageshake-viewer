import type { ParsedLogLine } from '../types/log.types';
import { ANONYMIZED_LOG_MARKER } from './anonymizeUtils';

/**
 * Reconstruct raw log text from parsed lines: each line's primary text followed
 * by its continuation lines, one per physical line.
 */
export function serializeLogLines(lines: readonly ParsedLogLine[]): string {
  const out: string[] = [];
  for (const l of lines) {
    out.push(l.rawText);
    if (l.continuationLines) out.push(...l.continuationLines);
  }
  return out.join('\n');
}

/**
 * Full text for a saved anonymised log file: the marker line (so re-loading the
 * file is recognised as anonymised) followed by the serialized lines.
 */
export function buildAnonymizedFileText(lines: readonly ParsedLogLine[]): string {
  return `${ANONYMIZED_LOG_MARKER}\n${serializeLogLines(lines)}\n`;
}

/**
 * Derive a download name from the loaded file name by inserting `-anonym`
 * before the extension, e.g. `console.log` → `console-anonym.log`.
 *
 * A trailing `.gz` is dropped first (the in-memory content is already
 * decompressed plain text). A name with no extension becomes `<name>-anonym.log`;
 * only a null/empty name falls back to `logs-anonym.log`.
 */
export function deriveAnonymizedFilename(logFileName: string | null): string {
  const raw = (logFileName ?? '').trim() || 'logs.log';
  const name = raw.replace(/\.gz$/i, '');
  const dot = name.lastIndexOf('.');
  if (dot > 0) {
    return `${name.slice(0, dot)}-anonym${name.slice(dot)}`;
  }
  return `${name}-anonym.log`;
}
