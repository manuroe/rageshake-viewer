import { describe, it, expect } from 'vitest';
import { buildExportText, formatExportLine, wrapLine, type ExportOptions, type ExportContext } from '../logExportUtils';
import { ANONYMIZED_LOG_MARKER } from '../anonymizeUtils';
import { buildDisplayItems, type DisplayItem } from '../logGapManager';
import { createParsedLogLine } from '../../test/fixtures';
import type { ParsedLogLine } from '../../types/log.types';

const BASE_OPTIONS: ExportOptions = {
  showIntro: false,
  showLineNumbers: false,
  showGaps: false,
  stripPrefix: false,
  maxWidthEnabled: false,
  maxWidth: 120,
  collapseDuplicates: false,
};

const BASE_CONTEXT: ExportContext = {
  filterQuery: '',
  contextLines: 0,
  startTime: null,
  endTime: null,
};

function makeRaw(count: number): ParsedLogLine[] {
  return Array.from({ length: count }, (_, i) =>
    createParsedLogLine({ lineNumber: i + 1, rawText: `2024-01-15T10:00:00.000000Z INFO line ${i + 1}` })
  );
}

function makeDisplayItems(rawLines: ParsedLogLine[], indices: number[]): DisplayItem[] {
  const filteredLines = indices.map((i) => ({ line: rawLines[i], index: i }));
  return buildDisplayItems(filteredLines, rawLines, []);
}

// --------------------------------------------------------------------------
// wrapLine
// --------------------------------------------------------------------------

describe('wrapLine', () => {
  it('returns a single-element array when text fits within maxWidth', () => {
    expect(wrapLine('hello', 10)).toEqual(['hello']);
  });

  it('wraps text at maxWidth boundary', () => {
    expect(wrapLine('abcdefghij', 5)).toEqual(['abcde', '  fgh', '  ij']);
  });

  it('handles exact-length text with no wrapping', () => {
    expect(wrapLine('abcde', 5)).toEqual(['abcde']);
  });

  it('continuation lines are indented with two spaces', () => {
    const result = wrapLine('12345678', 4);
    expect(result[0]).toBe('1234');
    expect(result[1]).toMatch(/^  /);
  });

  it('does not enter an infinite loop when maxWidth is 1 or 2 (clamps to 3)', () => {
    // maxWidth <= 2 would give contWidth <= 0, causing an infinite loop without
    // the guard. Verify that the function returns a finite result instead.
    const result = wrapLine('hello', 1);
    // Should produce a finite array of lines (not hang)
    expect(result.length).toBeGreaterThan(0);
    // All original characters are present (ignoring continuation indentation)
    const stripped = result.map((l) => l.trimStart()).join('');
    expect(stripped).toBe('hello');
  });
});

// --------------------------------------------------------------------------
// formatExportLine
// --------------------------------------------------------------------------

describe('formatExportLine', () => {
  it('returns rawText unchanged with all options off', () => {
    const raw = '2024-01-15T10:00:00.000000Z INFO hello world';
    expect(formatExportLine(raw, 1, BASE_OPTIONS)).toBe(raw);
  });

  it('prefixes with padded line number when showLineNumbers is true', () => {
    const result = formatExportLine('hello', 42, { ...BASE_OPTIONS, showLineNumbers: true });
    expect(result).toBe('[00042] hello');
  });

  it('strips ISO timestamp prefix when stripPrefix is true', () => {
    const raw = '2024-01-15T10:00:00.000000Z INFO hello';
    const result = formatExportLine(raw, 1, { ...BASE_OPTIONS, stripPrefix: true });
    expect(result).toBe('hello');
  });

  it('wraps long lines when maxWidthEnabled is true', () => {
    const raw = 'abcdefghij'; // 10 chars
    const result = formatExportLine(raw, 1, { ...BASE_OPTIONS, maxWidthEnabled: true, maxWidth: 5 });
    // Should wrap into multiple lines joined by \n
    expect(result).toContain('\n');
    result.split('\n').forEach((segment, i) => {
      if (i === 0) expect(segment.length).toBeLessThanOrEqual(5);
    });
  });

  it('does not wrap lines shorter than maxWidth', () => {
    const raw = 'short';
    const result = formatExportLine(raw, 1, { ...BASE_OPTIONS, maxWidthEnabled: true, maxWidth: 120 });
    expect(result).toBe('short');
    expect(result).not.toContain('\n');
  });

  it('combines lineNumbers + stripPrefix + maxWidth wrapping correctly', () => {
    const raw = '2024-01-15T10:00:00.000000Z INFO hello world that is very long indeed sorry';
    const result = formatExportLine(raw, 7, { ...BASE_OPTIONS, showLineNumbers: true, stripPrefix: true, maxWidthEnabled: true, maxWidth: 20 });
    // After strip: 'hello world that is very long indeed sorry'
    // After line num prefix: '[00007] hello world that is very long indeed sorry'
    // Should be wrapped at 20
    const outputLines = result.split('\n');
    expect(outputLines[0].length).toBeLessThanOrEqual(20);
    expect(outputLines[0].startsWith('[00007]')).toBe(true);
    // Continuation lines are indented
    if (outputLines.length > 1) {
      expect(outputLines[1].startsWith('  ')).toBe(true);
    }
  });
});

// --------------------------------------------------------------------------
// buildExportText — baseline
// --------------------------------------------------------------------------

describe('buildExportText', () => {
  it('returns one line per visible line with all options off', () => {
    const raw = makeRaw(3);
    const items = makeDisplayItems(raw, [0, 1, 2]);
    const result = buildExportText(items, BASE_OPTIONS, BASE_CONTEXT);
    const outputLines = result.split('\n');
    expect(outputLines).toHaveLength(3);
    expect(outputLines[0]).toBe(raw[0].rawText);
    expect(outputLines[2]).toBe(raw[2].rawText);
  });

  it('returns empty string for empty displayItems', () => {
    expect(buildExportText([], BASE_OPTIONS, BASE_CONTEXT)).toBe('');
  });

  it('prepends ANONYMIZED_LOG_MARKER when context.isAnonymized is true', () => {
    const raw = makeRaw(1);
    const items = makeDisplayItems(raw, [0]);
    const result = buildExportText(items, BASE_OPTIONS, { ...BASE_CONTEXT, isAnonymized: true });
    const outputLines = result.split('\n');
    expect(outputLines[0]).toBe(ANONYMIZED_LOG_MARKER);
    // The log line still follows the marker
    expect(outputLines[1]).toBe(raw[0].rawText);
  });

  // --------------------------------------------------------------------------
  // showLineNumbers
  // --------------------------------------------------------------------------

  it('prefixes lines with original lineNumber when showLineNumbers is true', () => {
    const raw = makeRaw(2);
    const items = makeDisplayItems(raw, [0, 1]);
    const result = buildExportText(items, { ...BASE_OPTIONS, showLineNumbers: true }, BASE_CONTEXT);
    const outputLines = result.split('\n');
    // lineNumber is 1-based from the fixture (lineNumber = i + 1)
    expect(outputLines[0]).toMatch(/^\[00001\]/);
    expect(outputLines[1]).toMatch(/^\[00002\]/);
  });

  // --------------------------------------------------------------------------
  // showGaps
  // --------------------------------------------------------------------------

  it('does NOT insert gap indicator when showGaps is false', () => {
    const raw = makeRaw(10);
    // Show lines 0 and 5 (gap of 4 between them)
    const items = makeDisplayItems(raw, [0, 5]);
    const result = buildExportText(items, BASE_OPTIONS, BASE_CONTEXT);
    expect(result).not.toContain('lines');
  });

  it('inserts gap indicator between non-adjacent visible lines when showGaps is true', () => {
    const raw = makeRaw(10);
    const items = makeDisplayItems(raw, [0, 5]);
    const result = buildExportText(items, { ...BASE_OPTIONS, showGaps: true }, BASE_CONTEXT);
    const outputLines = result.split('\n');
    // Expect: line1, gap indicator, line6
    expect(outputLines).toHaveLength(3);
    expect(outputLines[1]).toMatch(/^\.\.\. \d+ lines \.\.\./);
  });

  it('does NOT insert a gap indicator before the very first visible line', () => {
    const raw = makeRaw(10);
    // Lines 3 and 7 are visible — there is a gap before line 3 (lines 0-2)
    // and a gap between 3 and 7, but NOT a leading-edge indicator before 3
    const items = makeDisplayItems(raw, [3, 7]);
    const result = buildExportText(items, { ...BASE_OPTIONS, showGaps: true }, BASE_CONTEXT);
    const outputLines = result.split('\n');
    // First output line should be the actual log line, not a gap indicator
    expect(outputLines[0]).not.toMatch(/^\.\.\./);
    // Second line is the gap indicator
    expect(outputLines[1]).toMatch(/^\.\.\./);
    // Third line is the second log line
    expect(outputLines[2]).not.toMatch(/^\.\.\./);
  });

  it('does NOT insert a gap indicator after the last visible line', () => {
    const raw = makeRaw(10);
    const items = makeDisplayItems(raw, [0, 3]);
    const result = buildExportText(items, { ...BASE_OPTIONS, showGaps: true }, BASE_CONTEXT);
    const outputLines = result.split('\n');
    // Last output line should be an actual log line, not a gap indicator
    expect(outputLines[outputLines.length - 1]).not.toMatch(/^\.\.\./);
  });

  it('does NOT insert gap indicator for adjacent visible lines', () => {
    const raw = makeRaw(5);
    const items = makeDisplayItems(raw, [0, 1, 2]);
    const result = buildExportText(items, { ...BASE_OPTIONS, showGaps: true }, BASE_CONTEXT);
    expect(result).not.toContain('...');
  });

  // --------------------------------------------------------------------------
  // maxWidth wrapping
  // --------------------------------------------------------------------------

  it('wraps long lines when maxWidthEnabled is true', () => {
    const longLine = 'x'.repeat(200);
    const raw = [createParsedLogLine({ lineNumber: 1, rawText: longLine })];
    const items = makeDisplayItems(raw, [0]);
    const result = buildExportText(items, { ...BASE_OPTIONS, maxWidthEnabled: true, maxWidth: 50 }, BASE_CONTEXT);
    result.split('\n').forEach((segment, i) => {
      if (i === 0) expect(segment.length).toBeLessThanOrEqual(50);
    });
  });

  // --------------------------------------------------------------------------
  // showIntro
  // --------------------------------------------------------------------------

  it('prepends intro header when showIntro is true', () => {
    const raw = makeRaw(1);
    const items = makeDisplayItems(raw, [0]);
    const result = buildExportText(items, { ...BASE_OPTIONS, showIntro: true }, BASE_CONTEXT);
    expect(result).toContain('# Log export');
  });

  it('includes filter query in intro when set', () => {
    const raw = makeRaw(1);
    const items = makeDisplayItems(raw, [0]);
    const ctx: ExportContext = { ...BASE_CONTEXT, filterQuery: 'my-filter' };
    const result = buildExportText(items, { ...BASE_OPTIONS, showIntro: true }, ctx);
    expect(result).toContain('my-filter');
  });

  it('includes time range in intro when both start and end are set', () => {
    const raw = makeRaw(1);
    const items = makeDisplayItems(raw, [0]);
    const ctx: ExportContext = {
      ...BASE_CONTEXT,
      startTime: '2026-01-01T00:00:00Z',
      endTime: '2026-01-01T01:00:00Z',
    };
    const result = buildExportText(items, { ...BASE_OPTIONS, showIntro: true }, ctx);
    expect(result).toContain('Time range');
    expect(result).toContain('2026-01-01T00:00:00Z');
    expect(result).toContain('2026-01-01T01:00:00Z');
  });

  it('uses (start) / (end) placeholders when only one time bound is set', () => {
    const raw = makeRaw(1);
    const items = makeDisplayItems(raw, [0]);
    const ctxOnlyEnd: ExportContext = { ...BASE_CONTEXT, startTime: null, endTime: '2026-01-01T01:00:00Z' };
    const result = buildExportText(items, { ...BASE_OPTIONS, showIntro: true }, ctxOnlyEnd);
    expect(result).toContain('(start)');
    expect(result).toContain('2026-01-01T01:00:00Z');
  });

  it('includes contextLines in intro when non-zero', () => {
    const raw = makeRaw(1);
    const items = makeDisplayItems(raw, [0]);
    const ctx: ExportContext = { ...BASE_CONTEXT, contextLines: 5 };
    const result = buildExportText(items, { ...BASE_OPTIONS, showIntro: true }, ctx);
    expect(result).toContain('Context lines: 5');
  });

  it('includes lineRange in intro when set', () => {
    const raw = makeRaw(1);
    const items = makeDisplayItems(raw, [0]);
    const ctx: ExportContext = { ...BASE_CONTEXT, lineRange: { start: 10, end: 50 } };
    const result = buildExportText(items, { ...BASE_OPTIONS, showIntro: true }, ctx);
    expect(result).toContain('Line range: 10');
    expect(result).toContain('50');
  });

  it('includes export options in intro when they are active', () => {
    const raw = makeRaw(1);
    const items = makeDisplayItems(raw, [0]);
    const opts: ExportOptions = {
      ...BASE_OPTIONS,
      showIntro: true,
      showLineNumbers: true,
      showGaps: true,
      maxWidthEnabled: true,
      maxWidth: 80,
    };
    const result = buildExportText(items, opts, BASE_CONTEXT);
    expect(result).toContain('line-numbers');
    expect(result).toContain('gap-indicators');
    expect(result).toContain('max-width=80');
  });

  it('separates intro from log lines with a blank line', () => {
    const raw = makeRaw(1);
    const items = makeDisplayItems(raw, [0]);
    const result = buildExportText(items, { ...BASE_OPTIONS, showIntro: true }, BASE_CONTEXT);
    // There should be a blank line between the last intro line and the first log line
    const outputLines = result.split('\n');
    const firstNonIntro = outputLines.findIndex((l) => !l.startsWith('#') && l.trim() === '');
    expect(firstNonIntro).toBeGreaterThan(0);
  });
});

// --------------------------------------------------------------------------
// buildExportText — collapseDuplicates
// --------------------------------------------------------------------------

describe('buildExportText — collapseDuplicates', () => {
  /** Make N display items all sharing the same message text (different timestamps). */
  function makeDupItems(count: number): DisplayItem[] {
    const raw = Array.from({ length: count }, (_, i) =>
      createParsedLogLine({
        lineNumber: i + 1,
        rawText: `2024-01-15T10:00:0${i}.000000Z INFO repeated message`,
      })
    );
    return makeDisplayItems(raw, Array.from({ length: count }, (_, i) => i));
  }

  it('silently skips duplicates when collapseDuplicates=true and showGaps=false', () => {
    const items = makeDupItems(4);
    const result = buildExportText(items, { ...BASE_OPTIONS, collapseDuplicates: true }, BASE_CONTEXT);
    const outputLines = result.split('\n');
    // Only the first occurrence should be emitted
    expect(outputLines).toHaveLength(1);
    expect(outputLines[0]).toContain('repeated message');
  });

  it('emits "... N duplicated lines ..." when collapseDuplicates=true and showGaps=true', () => {
    const items = makeDupItems(4);
    const result = buildExportText(
      items,
      { ...BASE_OPTIONS, collapseDuplicates: true, showGaps: true },
      BASE_CONTEXT,
    );
    const outputLines = result.split('\n');
    // First line = the message; second line = duplicate indicator
    expect(outputLines).toHaveLength(2);
    expect(outputLines[1]).toBe('... 3 duplicated lines ...');
  });

  it('does not collapse when there is only one occurrence', () => {
    const raw = makeRaw(3);
    const items = makeDisplayItems(raw, [0, 1, 2]);
    const result = buildExportText(
      items,
      { ...BASE_OPTIONS, collapseDuplicates: true },
      BASE_CONTEXT,
    );
    // All three distinct lines should appear
    expect(result.split('\n')).toHaveLength(3);
  });

  it('does not collapse lines separated by a filtered gap', () => {
    // Lines 0 and 2 have the same message; line 1 is filtered out (gap)
    const raw = [
      createParsedLogLine({ lineNumber: 1, rawText: '2024-01-15T10:00:00.000000Z INFO same message' }),
      createParsedLogLine({ lineNumber: 2, rawText: '2024-01-15T10:00:01.000000Z INFO different' }),
      createParsedLogLine({ lineNumber: 3, rawText: '2024-01-15T10:00:02.000000Z INFO same message' }),
    ];
    // Display only lines 0 and 2 — this creates a gap above line 2
    const items = makeDisplayItems(raw, [0, 2]);
    const result = buildExportText(
      items,
      { ...BASE_OPTIONS, collapseDuplicates: true, showGaps: true },
      BASE_CONTEXT,
    );
    const outputLines = result.split('\n');
    // Expect: first line, regular gap indicator, second line (not collapsed)
    expect(outputLines).toHaveLength(3);
    expect(outputLines[1]).toMatch(/^\.\.\. \d+ lines \.\.\./);
    expect(outputLines[2]).toContain('same message');
  });

  it('handles a mix of duplicate and non-duplicate lines', () => {
    const raw = [
      createParsedLogLine({ lineNumber: 1, rawText: '2024-01-15T10:00:00.000000Z INFO foo' }),
      createParsedLogLine({ lineNumber: 2, rawText: '2024-01-15T10:00:01.000000Z INFO foo' }),
      createParsedLogLine({ lineNumber: 3, rawText: '2024-01-15T10:00:02.000000Z INFO bar' }),
      createParsedLogLine({ lineNumber: 4, rawText: '2024-01-15T10:00:03.000000Z INFO foo' }),
    ];
    const items = makeDisplayItems(raw, [0, 1, 2, 3]);
    const result = buildExportText(
      items,
      { ...BASE_OPTIONS, collapseDuplicates: true, showGaps: true },
      BASE_CONTEXT,
    );
    const outputLines = result.split('\n');
    // foo, ...1 duplicated lines..., bar, foo
    expect(outputLines).toHaveLength(4);
    expect(outputLines[0]).toContain('foo');
    expect(outputLines[1]).toBe('... 1 duplicated lines ...');
    expect(outputLines[2]).toContain('bar');
    expect(outputLines[3]).toContain('foo');
  });
});
