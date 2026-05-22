import type { ParsedLogLine } from '../types/log.types';
import type { FilteredLine } from './logGapManager';
import { ISO_TIMESTAMP_RE } from './logMessageUtils';

/**
 * Derived from {@link ISO_TIMESTAMP_RE}; strips the timestamp and any
 * immediately following whitespace in a single regex pass.
 * Lines that do not start with a timestamp are returned unchanged (no match).
 */
const STRIP_TIMESTAMP_RE = new RegExp(`${ISO_TIMESTAMP_RE.source}\\s*`);

/**
 * Source file paths that should never participate in collapsing, even when
 * consecutive duplicate/similar lines are detected. Add paths here to always
 * show these logs expanded.
 */
export const COLLAPSE_IGNORE_SOURCES: readonly string[] = [
  'crates/matrix-sdk/src/http_client/native.rs',
];

/** Minimum total group size (including the representative line) to trigger collapsing. */
export const MIN_COLLAPSE_COUNT = 4;

/**
 * Maximum period (number of distinct lines) to search for when detecting repeating
 * multi-line patterns. Larger values are rarely seen in practice and add cost.
 */
export const MAX_PATTERN_PERIOD = 8;

export type CollapseType = 'exact' | 'similar' | 'pattern';

export interface CollapseGroupInfo {
  readonly type: CollapseType;
  readonly count: number;
  /**
   * For `type === 'pattern'`: the period (number of lines per repetition).
   * The UI uses this to display "N repetitions of P-line pattern" instead of a raw line count.
   */
  readonly patternLength?: number;
  /**
   * For `type === 'pattern'` primary entries only: the raw log-line index of the first
   * (topmost) visible line that forms the template. Combined with `patternLength`, the view
   * can identify indices `[patternFirstLineIndex .. patternFirstLineIndex + patternLength - 1]`
   * as the template block and apply a visual highlight to them.
   */
  readonly patternFirstLineIndex?: number;
}

export interface CollapseResult {
  /** Indices (in raw log lines array) to hide due to collapsing */
  collapsedIndices: Set<number>;
  /**
   * Map from gap ID (e.g. "down-5") to collapse group metadata.
   * Used during rendering to show collapse badges instead of regular gap arrows.
   */
  collapseGroups: Map<string, CollapseGroupInfo>;
}

/**
 * Strip the ISO timestamp prefix from a raw log line for exact-duplicate comparison.
 */
export function stripTimestamp(rawText: string): string {
  // Single-pass: STRIP_TIMESTAMP_RE matches the timestamp + trailing whitespace
  // only when the line starts with a timestamp, so continuation lines with
  // intentional leading indentation are returned unchanged (no match = no-op).
  return rawText.replace(STRIP_TIMESTAMP_RE, '');
}

/**
 * Core relation check using pre-computed stripped texts.
 * Called from the hot path to avoid redundant regex replacements per comparison.
 */
function lineRelation(
  a: ParsedLogLine,
  aStripped: string,
  b: ParsedLogLine,
  bStripped: string,
): CollapseType | null {
  if (aStripped === bStripped) return 'exact';
  if (
    a.filePath !== undefined &&
    b.filePath !== undefined &&
    a.sourceLineNumber !== undefined &&
    b.sourceLineNumber !== undefined &&
    a.filePath === b.filePath &&
    a.sourceLineNumber === b.sourceLineNumber
  ) {
    return 'similar';
  }
  return null;
}

/**
 * Check if a line should be excluded from collapsing based on the ignore list.
 */
function isIgnoredSource(line: ParsedLogLine): boolean {
  return !!line.filePath && COLLAPSE_IGNORE_SOURCES.includes(line.filePath);
}

/**
 * Try to detect a repeating multi-line pattern starting at `startIdx`.
 *
 * Iterates over period lengths P = 2..MAX_PATTERN_PERIOD. For each P the first
 * P lines form the "template"; subsequent segments of P lines are compared
 * using `lineRelation()` with pre-computed stripped texts (handles both exact and similar matches per position).
 * Returns the smallest P whose
 * hidden line count (`P * (repetitions - 1)`) meets MIN_COLLAPSE_COUNT, or
 * `null` if no such pattern exists.
 *
 * @example
 * // Lines: A, B, A, B, A, B, A, B  →  { period: 2, repetitions: 4 }
 * detectPatternAt(lines, 0);
 */
function detectPatternAt(
  filteredLines: FilteredLine[],
  startIdx: number,
  stripped: readonly string[],
): { period: number; repetitions: number } | null {
  const remaining = filteredLines.length - startIdx;
  if (remaining < 4) return null; // need at least MIN_COLLAPSE_COUNT lines

  for (let p = 2; p <= MAX_PATTERN_PERIOD; p++) {
    // Need the template (P lines) plus at least one segment (P lines) within bounds.
    if (startIdx + p >= filteredLines.length) break;

    // Verify the template itself is adjacent in the raw log array
    let templateOk = true;
    for (let m = 1; m < p; m++) {
      if (filteredLines[startIdx + m].index !== filteredLines[startIdx + m - 1].index + 1) {
        templateOk = false;
        break;
      }
    }
    if (!templateOk) break; // non-adjacent template; larger P won't help

    // Quick probe: check only template[0] vs segment[0][0] before the more expensive
    // templateAllRelated scan. For non-repetitive logs this short-circuits with a single
    // string comparison instead of P-1 lineRelation calls, reducing per-position cost
    // from O(P) to O(1) for the common case.
    const tmpl0Line = filteredLines[startIdx].line;
    const tmpl0Stripped = stripped[startIdx];
    const quickProbeIdx = startIdx + p;
    if (!lineRelation(tmpl0Line, tmpl0Stripped, filteredLines[quickProbeIdx].line, stripped[quickProbeIdx])) {
      continue;
    }

    // Guard: if all template lines are related (exact or similar) to template[0],
    // the sequence degenerates to a single-line duplicate group — let that path handle it.
    const templateAllRelated = Array.from(
      { length: p - 1 },
      (_, k) => lineRelation(tmpl0Line, tmpl0Stripped, filteredLines[startIdx + k + 1].line, stripped[startIdx + k + 1]),
    ).every(r => r !== null);
    if (templateAllRelated) continue;

    // Count consecutive repetitions using exact or similar matching per position.
    let reps = 1;
    let segStart = startIdx + p;
    while (segStart + p - 1 < filteredLines.length) {
      let segOk = true;
      for (let m = 0; m < p; m++) {
        const j = segStart + m;
        // Must be adjacent to the previous line in the raw log array
        if (filteredLines[j].index !== filteredLines[j - 1].index + 1) {
          segOk = false;
          break;
        }
        // Must match the corresponding template line (exact or similar)
        if (!lineRelation(filteredLines[startIdx + m].line, stripped[startIdx + m], filteredLines[j].line, stripped[j])) {
          segOk = false;
          break;
        }
      }
      if (!segOk) break;
      reps++;
      segStart += p;
    }

    const hiddenLines = p * (reps - 1);
    if (hiddenLines >= MIN_COLLAPSE_COUNT) {
      return { period: p, repetitions: reps };
    }
  }
  return null;
}

/**
 * Detect consecutive duplicate/similar lines in the filtered view and compute
 * collapse groups.
 *
 * Only lines that are adjacent in the raw log array (consecutive indices) are
 * grouped. Groups whose total size is at least `MIN_COLLAPSE_COUNT` keep only
 * the first (representative) visible; the rest are returned in `collapsedIndices`.
 *
 * Each group is classified as:
 * - 'exact': all members are identical to the representative after removing the ISO timestamp
 * - 'similar': all members share the same source file:line as the representative
 *
 * If any member in an otherwise-exact group is merely similar, the whole group
 * is demoted to 'similar'.
 */
export function detectCollapseGroups(filteredLines: FilteredLine[]): CollapseResult {
  const collapsedIndices = new Set<number>();
  const collapseGroups = new Map<string, CollapseGroupInfo>();

  if (filteredLines.length < 2) {
    return { collapsedIndices, collapseGroups };
  }

  // Precompute stripped texts once — avoids O(N × P_max) regex replacements in the hot path.
  // detectPatternAt calls lineRelation up to 35 times per position (sum P=2..8) and
  // stripTimestamp was previously called twice per lineRelation call.
  const stripped: string[] = new Array(filteredLines.length);
  for (let k = 0; k < filteredLines.length; k++) {
    stripped[k] = stripTimestamp(filteredLines[k].line.rawText);
  }

  let i = 0;
  while (i < filteredLines.length) {
    const representative = filteredLines[i];

    if (isIgnoredSource(representative.line)) {
      i++;
      continue;
    }

    // ── Multi-line pattern detection (runs before single-line check) ────────
    const patternMatch = detectPatternAt(filteredLines, i, stripped);
    if (patternMatch) {
      const { period, repetitions } = patternMatch;
      const hiddenCount = period * (repetitions - 1);
      // The representative (visible) block is the first repetition.
      const lastRepLine = filteredLines[i + period - 1];

      for (let k = i + period; k < i + period * repetitions; k++) {
        collapsedIndices.add(filteredLines[k].index);
      }

      // Primary gap entry: below the last line of the first (visible) repetition.
      // patternFirstLineIndex lets the view highlight the template lines above this bar.
      collapseGroups.set(`down-${lastRepLine.index}`, {
        type: 'pattern',
        count: hiddenCount,
        patternLength: period,
        patternFirstLineIndex: filteredLines[i].index,
      });
      // Continuation entries so the summary bar stays visible after each
      // +10-line expansion (same convention as single-line groups).
      for (let k = i + period; k < i + period * repetitions - 1; k++) {
        collapseGroups.set(`down-${filteredLines[k].index}`, {
          type: 'pattern',
          count: i + period * repetitions - 1 - k,
          patternLength: period,
        });
      }

      i += period * repetitions; // advance past ALL repetitions (template + hidden)
      continue;
    }

    // ── Single-line deduplication (unchanged) ──────────────────────────────
    let groupEnd = i;
    let groupType: CollapseType | null = null;

    for (let j = i + 1; j < filteredLines.length; j++) {
      const candidate = filteredLines[j];

      // Must be adjacent in the raw log array
      if (candidate.index !== filteredLines[j - 1].index + 1) break;

      // Ignored sources break the group
      if (isIgnoredSource(candidate.line)) break;

      const relation = lineRelation(representative.line, stripped[i], candidate.line, stripped[j]);
      if (!relation) break;

      // Track weakest relation: demote 'exact' → 'similar' if any member is just similar
      if (groupType === null) {
        groupType = relation;
      } else if (groupType === 'exact' && relation === 'similar') {
        groupType = 'similar';
      }

      groupEnd = j;
    }

    if (groupEnd > i && groupType) {
      const repIndex = representative.index;
      const count = groupEnd - i; // number of hidden lines

      // Only collapse when the total group size (representative + hidden) reaches the minimum.
      // Groups smaller than MIN_COLLAPSE_COUNT are left expanded.
      if (1 + count >= MIN_COLLAPSE_COUNT) {
        for (let k = i + 1; k <= groupEnd; k++) {
          collapsedIndices.add(filteredLines[k].index);
        }
        // Primary entry: gap below representative before any expansion.
        collapseGroups.set(`down-${repIndex}`, { type: groupType, count });
        // Continuation entries: if the user partially expands the group (+10), the gap
        // migrates to down-{last expanded line index}. Pre-populate these so the summary
        // bar remains visible with the correct remaining count after each expansion.
        for (let k = i + 1; k < groupEnd; k++) {
          collapseGroups.set(`down-${filteredLines[k].index}`, { type: groupType, count: groupEnd - k });
        }
      }

      i = groupEnd + 1;
    } else {
      i++;
    }
  }

  return { collapsedIndices, collapseGroups };
}
