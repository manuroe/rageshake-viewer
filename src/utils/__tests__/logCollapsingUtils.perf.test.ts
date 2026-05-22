/**
 * Performance benchmarks for detectCollapseGroups.
 *
 * The multi-line pattern detection path (detectPatternAt) calls getLineRelation
 * up to 35 times per position (sum of P=2..8 for templateAllRelated + first-segment
 * probe). Each getLineRelation call invokes stripTimestamp twice (two regex
 * replacements). On a large non-repetitive log file this regresses from O(N) to
 * O(35N) regex replacements vs. the old single-line-only path.
 *
 * This benchmark exposes that regression and guards against it re-appearing.
 *
 * Run with: npm run bench
 */
import { describe, bench } from 'vitest';
import { detectCollapseGroups } from '../logCollapsingUtils';
import type { FilteredLine } from '../logGapManager';
import type { ParsedLogLine } from '../../types/log.types';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const BASE_MS = new Date('2025-01-15T10:00:00Z').getTime();

/**
 * Build a ParsedLogLine with a unique timestamp and message so that no two lines
 * are related (exact or similar). This is the worst-case input for detectPatternAt:
 * the function must probe all period lengths before giving up at each position.
 */
function makeLine(i: number): ParsedLogLine {
  const ms = BASE_MS + i * 100;
  const iso = new Date(ms).toISOString().replace(/\.\d{3}Z$/, '.000000Z');
  const rawText = `${iso} DEBUG [module_${i % 20}] event ${i}: unique payload id=${i}`;
  return {
    lineNumber: i,
    rawText,
    isoTimestamp: iso,
    timestampUs: ms * 1000,
    displayTime: iso.slice(11, 23),
    level: 'DEBUG',
    message: `event ${i}: unique payload id=${i}`,
    strippedMessage: `[module_${i % 20}] event ${i}: unique payload id=${i}`,
  };
}

/**
 * Build a FilteredLine[] with contiguous indices (no gaps), all unique lines.
 * Simulates a real log file where the collapsing algorithm finds nothing to collapse.
 */
function makeUniqueLines(count: number): FilteredLine[] {
  const lines: FilteredLine[] = [];
  for (let i = 0; i < count; i++) {
    lines.push({ line: makeLine(i), index: i });
  }
  return lines;
}

/**
 * Build a FilteredLine[] that contains a handful of 2-line repeating patterns
 * interspersed with unique lines. Simulates a realistic log with some duplicated
 * error bursts — the happy-path input for the algorithm.
 */
function makeMixedLines(count: number): FilteredLine[] {
  const lines: FilteredLine[] = [];
  let idx = 0;
  while (idx < count) {
    // Every ~50 lines, inject a 2-line × 8-rep pattern (14 hidden lines)
    if (idx % 50 === 0 && idx + 16 <= count) {
      const ms0 = BASE_MS + idx * 100;
      const iso0 = new Date(ms0).toISOString().replace(/\.\d{3}Z$/, '.000000Z');
      const ms1 = BASE_MS + (idx + 1) * 100;
      const iso1 = new Date(ms1).toISOString().replace(/\.\d{3}Z$/, '.000000Z');
      for (let r = 0; r < 8; r++) {
        lines.push({
          line: {
            lineNumber: idx + r * 2,
            rawText: `${iso0} WARN send_queue: error loading | queue.rs:709 | spans: root`,
            isoTimestamp: iso0,
            timestampUs: ms0 * 1000,
            displayTime: iso0.slice(11, 23),
            level: 'WARN',
            message: 'error loading | queue.rs:709 | spans: root',
            strippedMessage: 'send_queue: error loading | queue.rs:709 | spans: root',
          },
          index: idx + r * 2,
        });
        lines.push({
          line: {
            lineNumber: idx + r * 2 + 1,
            rawText: `${iso1} WARN send_queue: error applying deps | queue.rs:684 | spans: root`,
            isoTimestamp: iso1,
            timestampUs: ms1 * 1000,
            displayTime: iso1.slice(11, 23),
            level: 'WARN',
            message: 'error applying deps | queue.rs:684 | spans: root',
            strippedMessage: 'send_queue: error applying deps | queue.rs:684 | spans: root',
          },
          index: idx + r * 2 + 1,
        });
      }
      idx += 16;
    } else {
      lines.push({ line: makeLine(idx), index: idx });
      idx++;
    }
  }
  return lines;
}

// Pre-build fixtures outside bench callbacks so fixture construction time is not
// included in the measurement.
const UNIQUE_10K = makeUniqueLines(10_000);
const UNIQUE_50K = makeUniqueLines(50_000);
const MIXED_10K = makeMixedLines(10_000);
const MIXED_50K = makeMixedLines(50_000);

// ─── Benchmarks ───────────────────────────────────────────────────────────────

describe('detectCollapseGroups performance', () => {
  describe('unique lines (no patterns — worst case for detectPatternAt probe)', () => {
    bench('detectCollapseGroups: 10K unique lines', () => {
      detectCollapseGroups(UNIQUE_10K);
    });

    bench('detectCollapseGroups: 50K unique lines', () => {
      detectCollapseGroups(UNIQUE_50K);
    });
  });

  describe('mixed lines (realistic — unique + repeating bursts)', () => {
    bench('detectCollapseGroups: 10K mixed lines', () => {
      detectCollapseGroups(MIXED_10K);
    });

    bench('detectCollapseGroups: 50K mixed lines', () => {
      detectCollapseGroups(MIXED_50K);
    });
  });
});
