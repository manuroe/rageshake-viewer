import type { ParsedLogLine } from '../types/log.types';
import type { FilteredLine } from './logGapManager';
import { ISO_TIMESTAMP_RE } from './logMessageUtils';

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

export type CollapseType = 'exact' | 'similar';

export interface CollapseGroupInfo {
  type: CollapseType;
  count: number;
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
  // ISO_TIMESTAMP_RE is the canonical pattern. Only strip (and trimStart the
  // following whitespace) when the line actually starts with a timestamp —
  // continuation lines may have intentional leading indentation that must be
  // preserved so that symmetric comparison still works correctly.
  if (!ISO_TIMESTAMP_RE.test(rawText)) return rawText;
  return rawText.replace(ISO_TIMESTAMP_RE, '').trimStart();
}

/**
 * Determine the collapse relation between two log lines.
 * Returns 'exact' if lines are identical except for timestamp,
 * 'similar' if they come from the same source file:line,
 * or null if unrelated.
 */
function getLineRelation(a: ParsedLogLine, b: ParsedLogLine): CollapseType | null {
  if (stripTimestamp(a.rawText) === stripTimestamp(b.rawText)) {
    return 'exact';
  }
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

  let i = 0;
  while (i < filteredLines.length) {
    const representative = filteredLines[i];

    if (isIgnoredSource(representative.line)) {
      i++;
      continue;
    }

    let groupEnd = i;
    let groupType: CollapseType | null = null;

    for (let j = i + 1; j < filteredLines.length; j++) {
      const candidate = filteredLines[j];

      // Must be adjacent in the raw log array
      if (candidate.index !== filteredLines[j - 1].index + 1) break;

      // Ignored sources break the group
      if (isIgnoredSource(candidate.line)) break;

      const relation = getLineRelation(representative.line, candidate.line);
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
