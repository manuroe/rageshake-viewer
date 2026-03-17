import type { DisplayItem } from './logGapManager';
import { stripLogPrefix } from './logMessageUtils';

/**
 * Options that control how exported log text is formatted.
 *
 * All fields are required; the dialog creates a fresh object each time the
 * user triggers an export action.
 */
export interface ExportOptions {
  /**
   * When true, prepend a header block describing the active filters and view
   * settings at the time of export.
   */
  readonly showIntro: boolean;
  /**
   * When true, prefix each output line with its original 1-based log line
   * number, e.g. `[00042] ...`.
   */
  readonly showLineNumbers: boolean;
  /**
   * When true, insert a `... N lines ...` indicator between two consecutive
   * visible lines that are not adjacent in the original log.
   * Leading and trailing edges are never annotated.
   */
  readonly showGaps: boolean;
  /**
   * When true, strip the ISO timestamp and log level prefix from each line,
   * matching what the LogDisplayView "Strip prefix" toggle shows.
   * When false, emit the full `rawText`.
   */
  readonly stripPrefix: boolean;
  /**
   * When true, wrap lines longer than `maxWidth` characters by inserting
   * newlines so each output line is at most `maxWidth` characters. Continuation
   * lines are indented with two spaces so they are visually distinct.
   */
  readonly maxWidthEnabled: boolean;
  /**
   * Maximum output width per line (characters). Only used when
   * `maxWidthEnabled` is true. Must be ≥ 4.
   * @default 120
   */
  readonly maxWidth: number;
  /**
   * When true, collapse consecutive display lines that share the same message
   * content (compared after stripping the timestamp/level prefix) into a single
   * output line. When `showGaps` is also true a `... N duplicated lines ...`
   * indicator is inserted after the first occurrence. Lines separated by a
   * filtered gap are never collapsed.
   */
  readonly collapseDuplicates: boolean;
}

/**
 * Contextual information describing what was active in the LogDisplayView at
 * the time the user opened the export dialog.
 *
 * Used to populate the optional introduction header.
 */
export interface ExportContext {
  /** Active debounced filter query (empty string = no filter). */
  readonly filterQuery: string;
  /** Number of context lines shown around filter matches. */
  readonly contextLines: number;
  /** Whether line-wrap was enabled in the view. */
  readonly lineWrap: boolean;
  /** Whether strip-prefix was enabled in the view. */
  readonly stripPrefix: boolean;
  /** Whether collapse-duplicates was enabled in the view. */
  readonly collapseEnabled: boolean;
  /** Active line range restriction, if any. */
  readonly lineRange?: { readonly start: number; readonly end: number };
  /** Global time filter start (ISO string or null). */
  readonly startTime: string | null;
  /** Global time filter end (ISO string or null). */
  readonly endTime: string | null;
}

/**
 * Wrap a single text segment at `maxWidth` characters, returning an array of
 * lines where continuation lines are prefixed with two spaces.
 *
 * @example
 * ```ts
 * wrapLine('abcdefghij', 5);
 * // ['abcde', '  fgh', '  ij']
 * ```
 */
export function wrapLine(text: string, maxWidth: number): string[] {
  // Guard against values that would make contWidth <= 0 and cause an infinite loop.
  const safeWidth = Math.max(maxWidth, 3);
  if (text.length <= safeWidth) return [text];
  const lines: string[] = [];
  lines.push(text.slice(0, safeWidth));
  let offset = safeWidth;
  const contWidth = safeWidth - 2; // account for two-space indent
  while (offset < text.length) {
    lines.push('  ' + text.slice(offset, offset + contWidth));
    offset += contWidth;
  }
  return lines;
}

/**
 * Format a single line's text content according to the export options.
 *
 * Exported so it can be unit-tested in isolation.
 *
 * @example
 * ```ts
 * const text = formatExportLine(
 *   '2026-01-01T00:00:00.000Z INFO hello world',
 *   42,
 *   { showLineNumbers: true, stripPrefix: true, maxWidthEnabled: false, maxWidth: 120, showGaps: false, showIntro: false }
 * );
 * // '[00042] hello world'
 * ```
 */
export function formatExportLine(rawText: string, lineNumber: number, options: ExportOptions): string {
  let text = options.stripPrefix ? stripLogPrefix(rawText) : rawText;

  if (options.showLineNumbers) {
    const pad = String(lineNumber).padStart(5, '0');
    text = `[${pad}] ${text}`;
  }

  if (options.maxWidthEnabled && options.maxWidth >= 4 && text.length > options.maxWidth) {
    return wrapLine(text, options.maxWidth).join('\n');
  }

  return text;
}

/**
 * Build printable export text from the currently visible `displayItems`.
 *
 * This is the single entry-point used by the export dialog to produce the
 * string that will be copied to the clipboard or written to a file.
 *
 * Gap indicators (`... N lines ...`) are only inserted **between** two
 * visible lines when `showGaps` is enabled and at least one gap exists
 * between them.  Leading and trailing gaps (before the first or after the
 * last visible line) are intentionally omitted: they don't add useful
 * information in an export context.
 *
 * @param displayItems - The ordered array of display items from the view.
 * @param options - Export formatting options chosen by the user.
 * @param context - View state snapshot used for the optional intro header.
 * @returns The formatted text ready for clipboard or file output.
 *
 * @example
 * ```ts
 * const text = buildExportText(displayItems, {
 *   showIntro: false,
 *   showLineNumbers: false,
 *   showGaps: false,
 *   stripPrefix: false,
 *   maxWidthEnabled: false,
 *   maxWidth: 120,
 * }, context);
 * ```
 */
export function buildExportText(
  displayItems: DisplayItem[],
  options: ExportOptions,
  context: ExportContext,
): string {
  const lines: string[] = [];

  if (options.showIntro) {
    lines.push(...buildIntroLines(options, context));
    lines.push('');
  }

  let i = 0;
  while (i < displayItems.length) {
    const item = displayItems[i];
    const { line } = item.data;

    // Gap indicator above this line, but only when it is not the leading edge
    // (i.e. there must be a previous visible line for the gap to be "between" two lines).
    if (options.showGaps && i > 0 && item.gapAbove && !item.gapAbove.isFirst) {
      lines.push(`... ${item.gapAbove.gapSize} lines ...`);
    }

    lines.push(formatExportLine(line.rawText, line.lineNumber, options));

    if (options.collapseDuplicates) {
      // Count consecutive following items that share the same message content.
      // We strip the timestamp/level prefix for comparison so that lines with
      // different timestamps but identical messages are treated as duplicates.
      // We stop the run as soon as a filtered gap appears between items.
      const baseText = stripLogPrefix(line.rawText);
      let dupCount = 0;
      let j = i + 1;
      while (
        j < displayItems.length &&
        !displayItems[j].gapAbove &&
        stripLogPrefix(displayItems[j].data.line.rawText) === baseText
      ) {
        dupCount++;
        j++;
      }
      if (dupCount > 0 && options.showGaps) {
        lines.push(`... ${dupCount} duplicated lines ...`);
      }
      i = j;
    } else {
      i++;
    }
  }

  return lines.join('\n');
}

/**
 * Produce the introduction header lines that describe the current view state.
 *
 * Separated from `buildExportText` so it can be tested and extended
 * independently.
 */
function buildIntroLines(options: ExportOptions, context: ExportContext): string[] {
  const intro: string[] = [
    '# Log export',
  ];

  if (context.filterQuery) {
    intro.push(`# Filter query: ${context.filterQuery}`);
  }
  if (context.contextLines > 0) {
    intro.push(`# Context lines: ${context.contextLines}`);
  }
  if (context.startTime || context.endTime) {
    const from = context.startTime ?? '(start)';
    const to = context.endTime ?? '(end)';
    intro.push(`# Time range: ${from} → ${to}`);
  }
  if (context.lineRange) {
    intro.push(`# Line range: ${context.lineRange.start}–${context.lineRange.end}`);
  }

  const exportSettings: string[] = [];
  if (options.showLineNumbers) exportSettings.push('line-numbers');
  if (options.showGaps) exportSettings.push('gap-indicators');
  if (options.stripPrefix) exportSettings.push('strip-prefix');
  if (options.maxWidthEnabled) exportSettings.push(`max-width=${options.maxWidth}`);
  if (options.collapseDuplicates) exportSettings.push('collapse-duplicates');
  if (exportSettings.length > 0) {
    intro.push(`# Export options: ${exportSettings.join(', ')}`);
  }

  return intro;
}
