import { describe, it, expect } from 'vitest';
import {
  detectCollapseGroups,
  stripTimestamp,
  COLLAPSE_IGNORE_SOURCES,
  MIN_COLLAPSE_COUNT,
  MAX_PATTERN_PERIOD,
  type CollapseGroupInfo,
} from '../logCollapsingUtils';
import { createParsedLogLine } from '../../test/fixtures';
import type { FilteredLine } from '../logGapManager';
import type { ParsedLogLine } from '../../types/log.types';

function makeFilteredLine(index: number, overrides: Partial<ParsedLogLine> = {}): FilteredLine {
  return {
    line: createParsedLogLine({ lineNumber: index, ...overrides }),
    index,
  };
}

function makeFilteredLineWithSource(
  index: number,
  filePath: string,
  sourceLineNumber: number,
  rawTextSuffix?: string
): FilteredLine {
  const rawText = `2024-01-15T10:00:${String(index).padStart(2, '0')}.000000Z INFO ${rawTextSuffix ?? `message from ${filePath}:${sourceLineNumber}`} | ${filePath}:${sourceLineNumber} | spans: root`;
  return {
    line: createParsedLogLine({
      lineNumber: index,
      filePath,
      sourceLineNumber,
      rawText,
    }),
    index,
  };
}

describe('stripTimestamp', () => {
  it('strips ISO timestamp with microseconds and Z', () => {
    expect(stripTimestamp('2026-03-06T17:05:59.920483Z ERROR something'))
      .toBe('ERROR something');
  });

  it('strips ISO timestamp without Z', () => {
    expect(stripTimestamp('2024-01-15T10:00:00.000000 INFO message'))
      .toBe('INFO message');
  });

  it('returns original text if no timestamp found', () => {
    expect(stripTimestamp('no timestamp here'))
      .toBe('no timestamp here');
  });
});

describe('detectCollapseGroups', () => {
  it('returns empty result for fewer than 2 lines', () => {
    const result = detectCollapseGroups([]);
    expect(result.collapsedIndices.size).toBe(0);
    expect(result.collapseGroups.size).toBe(0);

    const single = detectCollapseGroups([makeFilteredLine(0)]);
    expect(single.collapsedIndices.size).toBe(0);
    expect(single.collapseGroups.size).toBe(0);
  });

  it('detects exact duplicates (same text after removing timestamp)', () => {
    const lines: FilteredLine[] = [
      {
        line: createParsedLogLine({
          lineNumber: 0,
          rawText: '2024-01-15T10:00:00.000000Z INFO Duplicate message',
        }),
        index: 0,
      },
      {
        line: createParsedLogLine({
          lineNumber: 1,
          rawText: '2024-01-15T10:00:01.000000Z INFO Duplicate message',
        }),
        index: 1,
      },
      {
        line: createParsedLogLine({
          lineNumber: 2,
          rawText: '2024-01-15T10:00:02.000000Z INFO Duplicate message',
        }),
        index: 2,
      },
      {
        line: createParsedLogLine({
          lineNumber: 3,
          rawText: '2024-01-15T10:00:03.000000Z INFO Duplicate message',
        }),
        index: 3,
      },
    ];

    const result = detectCollapseGroups(lines);

    expect(result.collapsedIndices).toEqual(new Set([1, 2, 3]));
    // 1 primary + 2 continuation entries (down-1, down-2)
    expect(result.collapseGroups.size).toBe(3);
    expect(result.collapseGroups.get('down-0')).toEqual({ type: 'exact', count: 3 });
    expect(result.collapseGroups.get('down-1')).toEqual({ type: 'exact', count: 2 });
    expect(result.collapseGroups.get('down-2')).toEqual({ type: 'exact', count: 1 });
  });

  it(`does not collapse groups smaller than MIN_COLLAPSE_COUNT (${MIN_COLLAPSE_COUNT})`, () => {
    // 3 exact duplicates = total group size 3, below threshold of 4
    const lines: FilteredLine[] = [
      {
        line: createParsedLogLine({
          lineNumber: 0,
          rawText: '2024-01-15T10:00:00.000000Z INFO Small dup group',
        }),
        index: 0,
      },
      {
        line: createParsedLogLine({
          lineNumber: 1,
          rawText: '2024-01-15T10:00:01.000000Z INFO Small dup group',
        }),
        index: 1,
      },
      {
        line: createParsedLogLine({
          lineNumber: 2,
          rawText: '2024-01-15T10:00:02.000000Z INFO Small dup group',
        }),
        index: 2,
      },
    ];

    const result = detectCollapseGroups(lines);

    expect(result.collapsedIndices.size).toBe(0);
    expect(result.collapseGroups.size).toBe(0);
  });

  it('detects similar lines (same filePath and sourceLineNumber)', () => {
    const lines: FilteredLine[] = [
      makeFilteredLineWithSource(0, 'crates/matrix-sdk/src/room.rs', 42, 'Room is unknown room_id=!abc'),
      makeFilteredLineWithSource(1, 'crates/matrix-sdk/src/room.rs', 42, 'Room is unknown room_id=!def'),
      makeFilteredLineWithSource(2, 'crates/matrix-sdk/src/room.rs', 42, 'Room is unknown room_id=!ghi'),
      makeFilteredLineWithSource(3, 'crates/matrix-sdk/src/room.rs', 42, 'Room is unknown room_id=!jkl'),
    ];

    const result = detectCollapseGroups(lines);

    expect(result.collapsedIndices).toEqual(new Set([1, 2, 3]));
    expect(result.collapseGroups.get('down-0')).toEqual({ type: 'similar', count: 3 });
  });

  it('demotes exact group to similar when a member is only similar', () => {
    const lines: FilteredLine[] = [
      makeFilteredLineWithSource(0, 'crates/room.rs', 10, 'exact text'),
      makeFilteredLineWithSource(1, 'crates/room.rs', 10, 'exact text'),
      makeFilteredLineWithSource(2, 'crates/room.rs', 10, 'different text'),
      makeFilteredLineWithSource(3, 'crates/room.rs', 10, 'different text 2'),
    ];

    const result = detectCollapseGroups(lines);

    expect(result.collapsedIndices).toEqual(new Set([1, 2, 3]));
    expect(result.collapseGroups.get('down-0')).toEqual({ type: 'similar', count: 3 });
  });

  it('does not collapse non-adjacent raw indices', () => {
    const lines: FilteredLine[] = [
      {
        line: createParsedLogLine({
          lineNumber: 0,
          rawText: '2024-01-15T10:00:00.000000Z INFO Same message',
        }),
        index: 0,
      },
      // Gap in indices: index 2 follows index 0 (index 1 is filtered out)
      {
        line: createParsedLogLine({
          lineNumber: 2,
          rawText: '2024-01-15T10:00:02.000000Z INFO Same message',
        }),
        index: 2,
      },
    ];

    const result = detectCollapseGroups(lines);

    expect(result.collapsedIndices.size).toBe(0);
    expect(result.collapseGroups.size).toBe(0);
  });

  it('does not collapse unrelated lines', () => {
    const lines: FilteredLine[] = [
      {
        line: createParsedLogLine({
          lineNumber: 0,
          rawText: '2024-01-15T10:00:00.000000Z INFO First message',
        }),
        index: 0,
      },
      {
        line: createParsedLogLine({
          lineNumber: 1,
          rawText: '2024-01-15T10:00:01.000000Z ERROR Different message',
        }),
        index: 1,
      },
    ];

    const result = detectCollapseGroups(lines);

    expect(result.collapsedIndices.size).toBe(0);
    expect(result.collapseGroups.size).toBe(0);
  });

  it('creates separate groups for non-consecutive similar lines', () => {
    const lines: FilteredLine[] = [
      makeFilteredLineWithSource(0, 'crates/room.rs', 42, 'msg A'),
      makeFilteredLineWithSource(1, 'crates/room.rs', 42, 'msg B'),
      makeFilteredLineWithSource(2, 'crates/room.rs', 42, 'msg C'),
      makeFilteredLineWithSource(3, 'crates/room.rs', 42, 'msg D'),
      {
        line: createParsedLogLine({
          lineNumber: 4,
          rawText: '2024-01-15T10:00:04.000000Z INFO unrelated line',
        }),
        index: 4,
      },
      makeFilteredLineWithSource(5, 'crates/room.rs', 42, 'msg E'),
      makeFilteredLineWithSource(6, 'crates/room.rs', 42, 'msg F'),
      makeFilteredLineWithSource(7, 'crates/room.rs', 42, 'msg G'),
      makeFilteredLineWithSource(8, 'crates/room.rs', 42, 'msg H'),
    ];

    const result = detectCollapseGroups(lines);

    expect(result.collapsedIndices).toEqual(new Set([1, 2, 3, 6, 7, 8]));
    // 2 primary + 2 continuation per group = 6 total
    expect(result.collapseGroups.size).toBe(6);
    expect(result.collapseGroups.get('down-0')).toEqual({ type: 'similar', count: 3 });
    expect(result.collapseGroups.get('down-5')).toEqual({ type: 'similar', count: 3 });
  });

  it('ignores lines from COLLAPSE_IGNORE_SOURCES as group representatives', () => {
    const ignoredPath = COLLAPSE_IGNORE_SOURCES[0];
    const lines: FilteredLine[] = [
      makeFilteredLineWithSource(0, ignoredPath, 89, 'request A'),
      makeFilteredLineWithSource(1, ignoredPath, 89, 'request B'),
      makeFilteredLineWithSource(2, ignoredPath, 89, 'request C'),
    ];

    const result = detectCollapseGroups(lines);

    expect(result.collapsedIndices.size).toBe(0);
    expect(result.collapseGroups.size).toBe(0);
  });

  it('ignored source breaks an ongoing group', () => {
    const ignoredPath = COLLAPSE_IGNORE_SOURCES[0];
    const lines: FilteredLine[] = [
      makeFilteredLineWithSource(0, 'crates/room.rs', 42, 'msg A'),
      makeFilteredLineWithSource(1, ignoredPath, 89, 'ignored line'),
      makeFilteredLineWithSource(2, 'crates/room.rs', 42, 'msg B'),
    ];

    const result = detectCollapseGroups(lines);

    // Lines 0 and 2 are not adjacent (1 is between them), so no grouping
    expect(result.collapsedIndices.size).toBe(0);
  });

  it('handles mixed exact and similar in a single group', () => {
    const lines: FilteredLine[] = [
      makeFilteredLineWithSource(0, 'crates/room.rs', 10, 'exact text'),
      // index 1: exact match to representative
      makeFilteredLineWithSource(1, 'crates/room.rs', 10, 'exact text'),
      // index 2: similar (same source) but different text
      makeFilteredLineWithSource(2, 'crates/room.rs', 10, 'slightly different'),
      // index 3: also similar
      makeFilteredLineWithSource(3, 'crates/room.rs', 10, 'another variation'),
    ];

    const result = detectCollapseGroups(lines);

    expect(result.collapsedIndices).toEqual(new Set([1, 2, 3]));
    // Demoted to 'similar' because line 2 is only similar, not exact
    expect(result.collapseGroups.get('down-0')).toEqual({ type: 'similar', count: 3 });
  });

  it('returns correct gap IDs matching the gap manager format', () => {
    const lines: FilteredLine[] = [
      {
        line: createParsedLogLine({
          lineNumber: 10,
          rawText: '2024-01-15T10:00:00.000000Z INFO dup',
        }),
        index: 10,
      },
      {
        line: createParsedLogLine({
          lineNumber: 11,
          rawText: '2024-01-15T10:00:01.000000Z INFO dup',
        }),
        index: 11,
      },
      {
        line: createParsedLogLine({
          lineNumber: 12,
          rawText: '2024-01-15T10:00:02.000000Z INFO dup',
        }),
        index: 12,
      },
      {
        line: createParsedLogLine({
          lineNumber: 13,
          rawText: '2024-01-15T10:00:03.000000Z INFO dup',
        }),
        index: 13,
      },
    ];

    const result = detectCollapseGroups(lines);

    expect(result.collapseGroups.has('down-10')).toBe(true);
    expect(result.collapseGroups.get('down-10')).toEqual({ type: 'exact', count: 3 });
  });

  it('does not collapse lines without filePath for similar check', () => {
    // Lines with no filePath/sourceLineNumber and different text should not collapse
    const lines: FilteredLine[] = [
      {
        line: createParsedLogLine({
          lineNumber: 0,
          rawText: '2024-01-15T10:00:00.000000Z INFO message alpha',
        }),
        index: 0,
      },
      {
        line: createParsedLogLine({
          lineNumber: 1,
          rawText: '2024-01-15T10:00:01.000000Z INFO message beta',
        }),
        index: 1,
      },
    ];

    const result = detectCollapseGroups(lines);
    expect(result.collapsedIndices.size).toBe(0);
  });
});

// ─── Multi-line pattern collapsing ──────────────────────────────────────────

/**
 * Build FilteredLine entries for a repeating multi-line pattern.
 * `template` is an array of rawText bodies (everything after the timestamp).
 * `repetitions` controls how many full copies are generated.
 * Line indices are contiguous starting from 0.
 */
function makePatternLines(template: string[], repetitions: number): FilteredLine[] {
  const lines: FilteredLine[] = [];
  for (let r = 0; r < repetitions; r++) {
    for (let m = 0; m < template.length; m++) {
      const idx = r * template.length + m;
      const rawText = `2024-01-15T10:${String(idx).padStart(2, '0')}:00.000000Z ${template[m]}`;
      lines.push({
        line: createParsedLogLine({ lineNumber: idx, rawText }),
        index: idx,
      });
    }
  }
  return lines;
}

describe('detectCollapseGroups – multi-line patterns', () => {
  it('collapses a 2-line pattern repeated 4 times (8 lines total)', () => {
    const lines = makePatternLines(
      [
        'WARN send_queue: error loading request | crates/send_queue.rs:709 | spans: root',
        'WARN send_queue: error applying deps   | crates/send_queue.rs:684 | spans: root',
      ],
      4,
    );

    const result = detectCollapseGroups(lines);

    // Lines 2-7 (indices 2..7) are hidden; lines 0-1 are the visible template.
    expect(result.collapsedIndices).toEqual(new Set([2, 3, 4, 5, 6, 7]));
    // Primary gap below last line of first rep (index 1).
    expect(result.collapseGroups.get('down-1')).toEqual({
      type: 'pattern',
      count: 6,
      patternLength: 2,
      patternFirstLineIndex: 0,
    });
  });

  it(`does not collapse when hidden lines < MIN_COLLAPSE_COUNT (${MIN_COLLAPSE_COUNT})`, () => {
    // 2-line pattern × 2 reps → hidden = 2 < 4
    const lines = makePatternLines(
      [
        'WARN queue: error A | queue.rs:10 | spans: root',
        'WARN queue: error B | queue.rs:20 | spans: root',
      ],
      2,
    );

    const result = detectCollapseGroups(lines);

    expect(result.collapsedIndices.size).toBe(0);
    expect(result.collapseGroups.size).toBe(0);
  });

  it('collapses a 3-line pattern repeated 3 times (9 lines total)', () => {
    const lines = makePatternLines(
      [
        'WARN mod_a: event A | mod_a.rs:1 | spans: root',
        'WARN mod_b: event B | mod_b.rs:2 | spans: root',
        'WARN mod_c: event C | mod_c.rs:3 | spans: root',
      ],
      3,
    );

    const result = detectCollapseGroups(lines);

    // First rep visible (0-2); reps 2-3 hidden (3-8).
    expect(result.collapsedIndices).toEqual(new Set([3, 4, 5, 6, 7, 8]));
    expect(result.collapseGroups.get('down-2')).toEqual({
      type: 'pattern',
      count: 6,
      patternLength: 3,
      patternFirstLineIndex: 0,
    });
  });

  it('generates correct continuation entries for a 2-line × 4-rep pattern', () => {
    const lines = makePatternLines(
      [
        'WARN queue: error A | queue.rs:10 | spans: root',
        'WARN queue: error B | queue.rs:20 | spans: root',
      ],
      4, // 8 total lines, 6 hidden
    );

    const result = detectCollapseGroups(lines);

    // Primary + 5 continuation entries for indices 2..6
    expect(result.collapseGroups.get('down-1')).toEqual({ type: 'pattern', count: 6, patternLength: 2, patternFirstLineIndex: 0 });
    expect(result.collapseGroups.get('down-2')).toEqual({ type: 'pattern', count: 5, patternLength: 2 });
    expect(result.collapseGroups.get('down-3')).toEqual({ type: 'pattern', count: 4, patternLength: 2 });
    expect(result.collapseGroups.get('down-4')).toEqual({ type: 'pattern', count: 3, patternLength: 2 });
    expect(result.collapseGroups.get('down-5')).toEqual({ type: 'pattern', count: 2, patternLength: 2 });
    expect(result.collapseGroups.get('down-6')).toEqual({ type: 'pattern', count: 1, patternLength: 2 });
    expect(result.collapseGroups.size).toBe(6);
  });

  it('collapses a 2-line similar pattern (different room_id per rep, same source file:line)', () => {
    // Mirrors the real-world account_data/global.rs pattern:
    //   TRACE @:113  "Marking room as direct room room_id=!abc"
    //   DEBUG @:176  "couldn't find room … room=!abc"
    //   TRACE @:113  "Marking room as direct room room_id=!def"
    //   DEBUG @:176  "couldn't find room … room=!def"
    //   ... (many repetitions)
    const makeRep = (idx: number, roomId: string): FilteredLine[] => [
      {
        line: createParsedLogLine({
          lineNumber: idx * 2,
          rawText: `2026-05-11T10:47:5${idx}.000Z TRACE account_data: Marking room as direct room room_id="${roomId}" | global.rs:113 | spans: root`,
          filePath: 'crates/matrix-sdk-base/src/response_processors/account_data/global.rs',
          sourceLineNumber: 113,
        }),
        index: idx * 2,
      },
      {
        line: createParsedLogLine({
          lineNumber: idx * 2 + 1,
          rawText: `2026-05-11T10:47:5${idx}.001Z DEBUG account_data: couldn't find room room="${roomId}" | global.rs:176 | spans: root`,
          filePath: 'crates/matrix-sdk-base/src/response_processors/account_data/global.rs',
          sourceLineNumber: 176,
        }),
        index: idx * 2 + 1,
      },
    ];

    const lines: FilteredLine[] = [
      ...makeRep(0, '!room1:example.org'),
      ...makeRep(1, '!room2:example.org'),
      ...makeRep(2, '!room3:example.org'),
      ...makeRep(3, '!room4:example.org'),
    ];

    const result = detectCollapseGroups(lines);

    // First rep (indices 0-1) visible; reps 2-4 (indices 2-7) hidden
    expect(result.collapsedIndices).toEqual(new Set([2, 3, 4, 5, 6, 7]));
    expect(result.collapseGroups.get('down-1')).toEqual({
      type: 'pattern',
      count: 6,
      patternLength: 2,
      patternFirstLineIndex: 0,
    });
  });

  it('does not collapse when the 2nd segment does not match the template', () => {
    // Lines A B C D where C ≠ A → no 2-line pattern
    const lines: FilteredLine[] = [
      { line: createParsedLogLine({ lineNumber: 0, rawText: '2024-01-15T10:00:00.000000Z WARN queue: error A | queue.rs:10' }), index: 0 },
      { line: createParsedLogLine({ lineNumber: 1, rawText: '2024-01-15T10:00:01.000000Z WARN queue: error B | queue.rs:20' }), index: 1 },
      { line: createParsedLogLine({ lineNumber: 2, rawText: '2024-01-15T10:00:02.000000Z WARN queue: error X | queue.rs:99' }), index: 2 },
      { line: createParsedLogLine({ lineNumber: 3, rawText: '2024-01-15T10:00:03.000000Z WARN queue: error Y | queue.rs:88' }), index: 3 },
    ];

    const result = detectCollapseGroups(lines);

    expect(result.collapsedIndices.size).toBe(0);
    expect(result.collapseGroups.size).toBe(0);
  });

  it('does not collapse a pattern with a gap in raw indices', () => {
    // Simulate a filter that removed index 2, breaking adjacency
    const lines: FilteredLine[] = [
      { line: createParsedLogLine({ lineNumber: 0, rawText: '2024-01-15T10:00:00.000000Z WARN q: error A' }), index: 0 },
      { line: createParsedLogLine({ lineNumber: 1, rawText: '2024-01-15T10:00:01.000000Z WARN q: error B' }), index: 1 },
      // index 2 is filtered out → gap
      { line: createParsedLogLine({ lineNumber: 3, rawText: '2024-01-15T10:00:03.000000Z WARN q: error A' }), index: 3 },
      { line: createParsedLogLine({ lineNumber: 4, rawText: '2024-01-15T10:00:04.000000Z WARN q: error B' }), index: 4 },
    ];

    const result = detectCollapseGroups(lines);

    expect(result.collapsedIndices.size).toBe(0);
  });

  it('pattern detection does not suppress single-line deduplication elsewhere', () => {
    // 4 identical single lines preceded by 2 unrelated lines that form no pattern
    const lines: FilteredLine[] = [
      { line: createParsedLogLine({ lineNumber: 0, rawText: '2024-01-15T10:00:00.000000Z INFO alpha' }), index: 0 },
      { line: createParsedLogLine({ lineNumber: 1, rawText: '2024-01-15T10:00:01.000000Z INFO beta' }), index: 1 },
      { line: createParsedLogLine({ lineNumber: 2, rawText: '2024-01-15T10:00:02.000000Z INFO dup line' }), index: 2 },
      { line: createParsedLogLine({ lineNumber: 3, rawText: '2024-01-15T10:00:03.000000Z INFO dup line' }), index: 3 },
      { line: createParsedLogLine({ lineNumber: 4, rawText: '2024-01-15T10:00:04.000000Z INFO dup line' }), index: 4 },
      { line: createParsedLogLine({ lineNumber: 5, rawText: '2024-01-15T10:00:05.000000Z INFO dup line' }), index: 5 },
    ];

    const result = detectCollapseGroups(lines);

    // Single-line dedup should still collapse lines 3-5 under representative at index 2
    expect(result.collapsedIndices).toEqual(new Set([3, 4, 5]));
    expect(result.collapseGroups.get('down-2')).toEqual({ type: 'exact', count: 3 });
  });

  it(`respects MAX_PATTERN_PERIOD (${MAX_PATTERN_PERIOD}) – does not attempt larger periods`, () => {
    // A period-(MAX_PATTERN_PERIOD + 1) pattern should NOT be collapsed
    const periodTooLarge = MAX_PATTERN_PERIOD + 1;
    const template = Array.from({ length: periodTooLarge }, (_, k) => `INFO line-${k} | mod.rs:${k}`);
    const lines = makePatternLines(template, 3); // hidden = periodTooLarge*2 > 4, but period too large

    const result = detectCollapseGroups(lines);

    expect(result.collapsedIndices.size).toBe(0);
  });
});
