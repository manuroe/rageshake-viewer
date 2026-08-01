/**
 * rageshake CLI — compact, LLM-friendly views over rageshake archives and logs.
 *
 * Thin command wrapper over the viewer's pure parsers: never dumps raw logs,
 * every command emits bounded output sized for an LLM context window.
 *
 * Usage: npx tsx cli/rageshake.ts <command> <path> [options]
 * Run with no arguments for the full command reference.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'fflate';
import { parseTar } from '../src/utils/tarParser.ts';
import { parseLogFile } from '../src/utils/logParser.ts';
import { mergeLogParserResults, type NamedLogParserResult } from '../src/utils/mergeLogParserResults.ts';
import { parseDetailsJson } from '../src/utils/detailsJson.ts';
import { isAnalyzableEntry } from '../src/utils/archiveSummary.ts';
import { isValidGzipHeader, isValidTextContent, decodeTextBytes } from '../src/utils/fileValidator.ts';
import { detectAnonymizedLog, MATRIX_IDENTIFIER_RE } from '../src/utils/anonymizeUtils.ts';
import { computeSummaryStats } from '../src/utils/summaryStats.ts';
import { lastColdStartUs, lastForegroundUs, deriveAppStateSegments } from '../src/utils/lifecycleEvents.ts';
import { buildLogOverview, type OverviewNode } from '../src/utils/logOverview.ts';
import { buildSpanOverview, type SpanNode } from '../src/utils/spanOverview.ts';
import { extractDateKey, extractCategory } from '../src/utils/listingEntries.ts';
import { stripLogPrefix } from '../src/utils/logMessageUtils.ts';
import { isoToMicros, microsToISO, getMinMaxTimestamps, formatDuration } from '../src/utils/timeUtils.ts';
import type { LogParserResult, ParsedLogLine, LifecycleEvent, HttpRequest } from '../src/types/log.types.ts';
import type { TimestampMicros, ISODateTimeString } from '../src/types/time.types.ts';

const USAGE = `rageshake CLI — compact views over a rageshake archive (.tar.gz) or log file (.log / .log.gz)

Commands:
  precheck <path>              Verify the file is anonymized. Exit 1 + reason when not.
  summary  <path>              details.json + per-file stats + top errors/warnings/HTTP failures (JSON).
  overview <path>              Log lines grouped by module target, error/warn counts per subtree.
  spans    <path>              SDK log lines grouped by span chain (operation view).
  grep     <path> <pattern>    Lines matching pattern (case-insensitive substring).
  slice    <path>              All lines in a time window (use with --last/--since/--from).
  http     <path>              HTTP requests: time, method, uri, status, duration.
  cycles   <path>              App lifecycle: cold starts, foreground/background, crashes.

Time window (grep, slice, http, overview, spans, cycles):
  --from <ISO>                 Start timestamp, e.g. 2026-01-15T10:00:00Z
  --to <ISO>                   End timestamp
  --since <anchor|ISO>         last-cold-start | last-foreground | last-background, or an ISO timestamp
  --last <dur>                 Window ending at the last log line, e.g. 10m, 1h, 30s

Filters:
  --level <LEVEL>              Minimum level: TRACE|DEBUG|INFO|WARN|ERROR (grep, slice)
  --around <N>                 Context lines around each match (grep, default 0)
  --file <name>                Only lines from this source log file (grep, slice)
  --errors                     Only failed requests: HTTP >= 400 or transport error (http)
  --slowest <N>                N slowest requests, sorted by duration (http)
  --top <N|all>                Per-file table: N noisiest files or "all" (summary, default 20)

Pagination (all line/tree output is capped, never unbounded):
  --limit <N>                  Max lines / tree nodes (default 200 lines, 100 nodes)
  --offset <N>                 Skip N output entries (cycles pages back from the newest; footer shows the next offset)
  --depth <N>                  Max tree depth (overview, spans; default 3)`;

// ---------------------------------------------------------------------------
// Ingest
// ---------------------------------------------------------------------------

interface TextEntry {
  readonly name: string;
  readonly text: string;
}

export interface Ingest {
  /** Parsed analyzable log files, chronological order. */
  readonly files: readonly NamedLogParserResult[];
  /** All files merged into one timeline. */
  readonly merged: LogParserResult;
  /** Parsed details.json when the archive has one. */
  readonly details: ReturnType<typeof parseDetailsJson>;
  /** Every decodable text entry (for precheck). */
  readonly textEntries: readonly TextEntry[];
}

function isTarBytes(bytes: Uint8Array): boolean {
  // 'ustar' magic at offset 257
  return bytes.length > 262 && bytes[257] === 0x75 && bytes[258] === 0x73
    && bytes[259] === 0x74 && bytes[260] === 0x61 && bytes[261] === 0x72;
}

/**
 * Validate bytes as text and decode with the detected encoding (UTF-8, or the
 * ISO-8859-1 fallback the rest of the app uses). Returns null for binary /
 * null-byte content so callers can skip or reject it.
 */
function decodeIfText(data: Uint8Array): string | null {
  const validation = isValidTextContent(data);
  if (!validation.isValid) return null;
  return decodeTextBytes(data, validation.metadata?.encoding as string | undefined);
}

/** Ingest raw file bytes: decompress, unpack, parse, merge. */
export function ingest(rawBytes: Uint8Array, name: string): Ingest {
  const bytes = isValidGzipHeader(rawBytes) ? gunzipSync(rawBytes) : rawBytes;
  const textEntries: TextEntry[] = [];
  let details: Ingest['details'] = null;

  // Trust the archive extension first (parseTar handles non-ustar tars the magic
  // check would miss); fall back to the ustar magic for extensionless input.
  const nameIsTar = /\.tar$|\.tar\.gz$|\.tgz$/i.test(name);
  if (nameIsTar || isTarBytes(bytes)) {
    for (const entry of parseTar(bytes)) {
      // A log file or details.json that can't be read is a broken archive, not
      // an unrelated binary member — fail loudly rather than analyse a partial
      // view. Other members (images, etc.) are skipped silently.
      const important = isAnalyzableEntry(entry.name) || basename(entry.name) === 'details.json';
      let data = entry.data;
      if (entry.name.toLowerCase().endsWith('.gz')) {
        if (!isValidGzipHeader(data)) {
          if (important) throw new Error(`${entry.name} is not valid gzip — cannot analyse this archive`);
          continue;
        }
        data = gunzipSync(data);
      }
      const text = decodeIfText(data);
      if (text === null) {
        if (important) throw new Error(`${entry.name} is not valid text — cannot analyse this archive`);
        continue;
      }
      textEntries.push({ name: entry.name, text });
      if (basename(entry.name) === 'details.json') details = parseDetailsJson(text);
    }
  } else {
    const text = decodeIfText(bytes);
    if (text === null) throw new Error(`${name} is not a valid text log file (binary or unsupported encoding)`);
    textEntries.push({ name, text });
  }

  const logs = textEntries
    .filter((t) => isAnalyzableEntry(t.name) || textEntries.length === 1)
    .sort((a, b) =>
      (extractDateKey(a.name) ?? a.name).localeCompare(extractDateKey(b.name) ?? b.name)
      || a.name.localeCompare(b.name));
  // Pass the raw text: parseLogFile detects and strips the anonymization marker
  // itself and sets isAnonymized — pre-stripping here would hide that signal.
  const files = logs.map((t) => ({ name: t.name, result: parseLogFile(t.text) }));
  return { files, merged: mergeLogParserResults(files), details, textEntries };
}

function loadInput(path: string): Ingest {
  return ingest(new Uint8Array(readFileSync(path)), basename(path));
}

// ---------------------------------------------------------------------------
// Shared flags: time window, pagination
// ---------------------------------------------------------------------------

interface Flags {
  from?: string;
  to?: string;
  since?: string;
  last?: string;
  level?: string;
  around?: string;
  file?: string;
  limit?: string;
  offset?: string;
  depth?: string;
  errors?: boolean;
  slowest?: string;
  top?: string;
}

const DUR_RE = /^(\d+)(s|m|h|d)$/;
const DUR_US: Record<string, number> = { s: 1e6, m: 60e6, h: 3600e6, d: 86400e6 };

interface Range {
  startUs: number;
  endUs: number;
}

/**
 * Parse an ISO timestamp flag to µs, throwing on malformed input. `isoToMicros`
 * returns 0 for anything it can't parse (and for the epoch), so a 0 here means
 * the flag was malformed — no rageshake log line is at epoch.
 */
function parseIsoFlag(iso: string, flag: string): number {
  const us = isoToMicros(iso as ISODateTimeString);
  if (us === 0) throw new Error(`invalid ${flag} timestamp "${iso}"; use full ISO, e.g. 2026-01-15T10:00:00Z`);
  return us;
}

/** Resolve --from/--to/--since/--last into a µs range; null = whole log. */
export function resolveRange(merged: LogParserResult, flags: Flags, warn: (msg: string) => void): Range | null {
  const { min, max } = getMinMaxTimestamps(merged.rawLogLines);
  // A log with no parseable timestamps yields {min:0,max:0}; every time flag
  // resolves against that and produces a meaningless [0,0] window, so reject
  // them up front rather than silently filtering everything out.
  if ((flags.from || flags.to || flags.since || flags.last) && max === 0) {
    throw new Error('cannot apply a time window: the log has no parseable timestamps');
  }
  let startUs: number | null = null;
  let endUs: number | null = null;

  if (flags.from) startUs = parseIsoFlag(flags.from, '--from');
  if (flags.to) endUs = parseIsoFlag(flags.to, '--to');

  if (flags.since) {
    const events = merged.lifecycleEvents ?? [];
    let anchor: TimestampMicros | null = null;
    if (flags.since === 'last-cold-start') anchor = lastColdStartUs(events);
    else if (flags.since === 'last-foreground') anchor = lastForegroundUs(events);
    else if (flags.since === 'last-background') {
      for (const e of events) if (e.kind === 'background' && (anchor === null || e.timestampUs > anchor)) anchor = e.timestampUs;
    } else {
      // Accept an absolute ISO timestamp too (equivalent to --from), so an
      // explicit time doesn't force the caller to switch flags.
      const us = isoToMicros(flags.since as ISODateTimeString);
      if (us !== 0) anchor = us as TimestampMicros;
      else throw new Error(`invalid --since "${flags.since}" — use an anchor (last-cold-start | last-foreground | last-background) or an ISO timestamp like 2026-01-15T10:00:00Z`);
    }
    if (anchor === null) {
      warn(`# warning: no "${flags.since}" event found — ignoring --since; run "cycles" to see what exists`);
    } else {
      startUs = Math.max(startUs ?? 0, anchor);
    }
  }

  if (flags.last) {
    const m = flags.last.match(DUR_RE);
    if (!m) throw new Error(`invalid --last duration "${flags.last}" (e.g. 30s, 10m, 1h, 2d)`);
    const durUs = Number(m[1]) * DUR_US[m[2]];
    // Clamp to the first log timestamp (min), not epoch, so a duration longer
    // than the log span doesn't render a misleading 1970 range header. An
    // explicit --from still wins via its own startUs.
    startUs = Math.max(startUs ?? min, (endUs ?? max) - durUs);
  }

  if (startUs === null && endUs === null) return null;
  const range = { startUs: startUs ?? min, endUs: endUs ?? max };
  if (range.startUs > range.endUs) {
    throw new Error(`empty time window: start ${microsToISO(range.startUs as TimestampMicros)} is after end ${microsToISO(range.endUs as TimestampMicros)}`);
  }
  return range;
}

function intFlag(v: string | undefined, def: number): number {
  if (v === undefined) return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`invalid numeric flag value "${v}"`);
  return n;
}

/**
 * Page a list from the end: --offset 0 shows the last `limit` items, higher
 * offsets step further back. Returns the page and how many older items precede
 * it. Used by `cycles`, where the newest activity is what matters first.
 */
function tailPage<T>(items: readonly T[], limit: number, offset: number): { page: readonly T[]; older: number } {
  const end = items.length - offset;
  if (end <= 0) return { page: [], older: items.length };
  const start = Math.max(0, end - limit);
  return { page: items.slice(start, end), older: start };
}

// ---------------------------------------------------------------------------
// Line emission: collapse duplicates, gap markers, pagination
// ---------------------------------------------------------------------------

const LEVELS = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR'];

function levelFilter(min: string | undefined): (l: ParsedLogLine) => boolean {
  if (!min) return () => true;
  const idx = LEVELS.indexOf(min.toUpperCase());
  if (idx === -1) throw new Error(`unknown --level "${min}" (use ${LEVELS.join('|')})`);
  return (l) => LEVELS.indexOf(l.level) >= idx;
}

interface DisplayEntry {
  readonly line: ParsedLogLine;
  /** Consecutive following duplicates collapsed into this entry. */
  readonly dupCount: number;
  /** Log lines skipped between the previous entry and this one. */
  readonly gapBefore: number;
}

/** Collapse consecutive same-message lines and record gaps, before pagination. */
function buildDisplayEntries(lines: readonly ParsedLogLine[], selected: readonly number[]): DisplayEntry[] {
  const entries: DisplayEntry[] = [];
  let i = 0;
  while (i < selected.length) {
    const line = lines[selected[i]];
    // Gap = raw lines skipped between the two displayed entries. Measure it from
    // the selected timeline positions, not lineNumber: merged logs are sorted by
    // timestamp (mergeLogParserResults) so lineNumber is not monotonic in array
    // order and its delta would report phantom gaps when processes interleave.
    const gapBefore = i > 0 ? selected[i] - selected[i - 1] - 1 : 0;
    const baseText = stripLogPrefix(line.rawText);
    let dupCount = 0;
    let j = i + 1;
    while (
      j < selected.length
      && selected[j] === selected[j - 1] + 1
      && stripLogPrefix(lines[selected[j]].rawText) === baseText
    ) {
      dupCount++;
      j++;
    }
    entries.push({ line, dupCount, gapBefore });
    i = j;
  }
  return entries;
}

function formatLine(line: ParsedLogLine, multiFile: boolean): string {
  const time = line.displayTime ? line.displayTime.slice(0, 12) : '??:??:??.???';
  const proc = multiFile && line.sourceFile ? `|${extractCategory(line.sourceFile)}` : '';
  return `[${line.lineNumber}${proc}] ${time} ${line.level.padEnd(5)} ${stripLogPrefix(line.rawText)}`;
}

/** Emit display entries with day markers, gap markers and a pagination footer. */
function emitEntries(out: string[], entries: readonly DisplayEntry[], flags: Flags, multiFile: boolean): void {
  const limit = intFlag(flags.limit, 200);
  const offset = intFlag(flags.offset, 0);
  const page = entries.slice(offset, offset + limit);
  let lastDay = '';
  for (const e of page) {
    const day = String(e.line.isoTimestamp).slice(0, 10);
    if (day && day !== lastDay) {
      out.push(`# ${day}`);
      lastDay = day;
    }
    if (e.gapBefore > 0) out.push(`... ${e.gapBefore} lines ...`);
    out.push(formatLine(e.line, multiFile));
    if (e.dupCount > 0) out.push(`... ${e.dupCount} duplicated lines ...`);
  }
  const remaining = entries.length - offset - page.length;
  if (remaining > 0) out.push(`# ${remaining} more entries — next: --offset ${offset + page.length}`);
  if (page.length === 0) {
    out.push(entries.length === 0
      ? '# no matching lines'
      : `# --offset ${offset} is past the end (${entries.length} entries) — lower --offset`);
  }
}

/** Select line indices by range/level/file filters. */
function selectIndices(
  merged: LogParserResult,
  range: Range | null,
  flags: Flags,
): number[] {
  const passLevel = levelFilter(flags.level);
  const fileFilter = flags.file ?? null;
  const selected: number[] = [];
  merged.rawLogLines.forEach((l, idx) => {
    if (range && (l.timestampUs < range.startUs || l.timestampUs > range.endUs)) return;
    if (!passLevel(l)) return;
    if (fileFilter && !(l.sourceFile ?? '').includes(fileFilter)) return;
    selected.push(idx);
  });
  return selected;
}

function rangeHeader(out: string[], range: Range | null, merged: LogParserResult): void {
  if (range) {
    out.push(`# range: ${microsToISO(range.startUs as TimestampMicros)} → ${microsToISO(range.endUs as TimestampMicros)}`);
  } else {
    const { min, max } = getMinMaxTimestamps(merged.rawLogLines);
    if (min > 0) out.push(`# full log: ${microsToISO(min)} → ${microsToISO(max)} (${merged.rawLogLines.length} lines)`);
  }
}

// ---------------------------------------------------------------------------
// precheck
// ---------------------------------------------------------------------------

/** Alias shapes produced by the anonymizer (anonymizeUtils naming scheme). */
const ALIAS_RE = /^(?:@user-[0-9a-f]{12}|#room_alias-[0-9a-f]{12}|!room-[0-9a-f]{12}|\$event-[0-9a-f]{12})(?::domain-[0-9a-f]{8}\.org(?::\d{1,5})?)?$/;
const DOMAIN_ALIAS_RE = /domain-[0-9a-f]{8}\.org/;

export function cmdPrecheck(ing: Ingest): { ok: boolean; report: string } {
  let aliasCount = 0;
  let markerCount = 0;
  const rawByFile = new Map<string, number>();
  const rawByKind = new Map<string, number>();

  for (const { name, text } of ing.textEntries) {
    if (detectAnonymizedLog(text)) markerCount++;
    if (DOMAIN_ALIAS_RE.test(text)) aliasCount++;
    // Preserve the exported regex's own flags (add global for exec-loop scanning)
    // so precheck can't drift from the anonymizer if those flags ever change.
    const flags = MATRIX_IDENTIFIER_RE.flags.includes('g') ? MATRIX_IDENTIFIER_RE.flags : `${MATRIX_IDENTIFIER_RE.flags}g`;
    const re = new RegExp(MATRIX_IDENTIFIER_RE.source, flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (ALIAS_RE.test(m[0])) {
        aliasCount++;
        continue;
      }
      rawByFile.set(name, (rawByFile.get(name) ?? 0) + 1);
      const kind = m[0][0] === '@' ? 'user-id' : m[0][0] === '#' ? 'room-alias' : m[0][0] === '!' ? 'room-id' : 'event-id';
      rawByKind.set(kind, (rawByKind.get(kind) ?? 0) + 1);
    }
  }

  const lines: string[] = [];
  if (rawByFile.size > 0) {
    lines.push('FAIL: raw (non-anonymized) Matrix identifiers found — do NOT analyse this file.');
    lines.push('Anonymize it with shakeview first, then re-run precheck.');
    for (const [kind, count] of rawByKind) lines.push(`  ${kind}: ${count} occurrence(s)`);
    for (const [file, count] of rawByFile) lines.push(`  in ${file}: ${count}`);
    return { ok: false, report: lines.join('\n') };
  }
  if (aliasCount === 0 && markerCount === 0) {
    lines.push('FAIL: no anonymization evidence — no anonymized marker and no alias patterns (@user-…, domain-….org) found.');
    lines.push('Either the file was never anonymized or it contains no Matrix identifiers at all. Verify before analysing.');
    return { ok: false, report: lines.join('\n') };
  }
  lines.push(`PASS: anonymized (${markerCount} marker(s), ${aliasCount} alias signal(s), 0 raw identifiers).`);
  return { ok: true, report: lines.join('\n') };
}

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------

const trim = (s: string, n = 160): string => (s.length > n ? `${s.slice(0, n)}…` : s);

export function cmdSummary(ing: Ingest, flags: Flags = {}): string {
  const { merged, details, files } = ing;
  const lineIndex = new Map(merged.rawLogLines.map((l) => [l.lineNumber, l]));
  const stats = computeSummaryStats(
    merged.rawLogLines, merged.httpRequests, merged.requests, merged.connectionIds,
    merged.sentryEvents, null, null, null, lineIndex, merged.lifecycleEvents ?? [],
  );
  const events = merged.lifecycleEvents ?? [];
  const lifecycleCounts: Record<string, number> = {};
  for (const e of events) lifecycleCounts[e.kind] = (lifecycleCounts[e.kind] ?? 0) + 1;
  const coldStart = lastColdStartUs(events);
  const foreground = lastForegroundUs(events);

  const perFile = files.map(({ name, result }) => {
    let errors = 0;
    let warns = 0;
    for (const l of result.rawLogLines) {
      if (l.level === 'ERROR') errors++;
      else if (l.level === 'WARN') warns++;
    }
    return { name, lines: result.rawLogLines.length, errors, warns, http: result.httpRequests.length, sentry: result.sentryEvents.length };
  });
  // Noisiest files first, capped by default so a 100-file archive's per-file
  // table doesn't dominate the output; --top all restores the full list.
  const sortedFiles = [...perFile].sort((a, b) => (b.errors + b.warns) - (a.errors + a.warns) || b.lines - a.lines);
  const topN = flags.top === 'all' ? sortedFiles.length : intFlag(flags.top, 20);
  const shownFiles = sortedFiles.slice(0, topN);

  return JSON.stringify({
    // Identity fields (user_id, device_id) are deliberately omitted: device_id
    // is not a Matrix identifier so the anonymizer never rewrites it, and precheck
    // doesn't catch it — echoing it would leak a stable id into LLM-bound output.
    // user_id is already an alias in the anonymized log lines, so it adds nothing.
    details: details && {
      userText: details.userText,
      app: details.appId,
      version: details.version,
      sdkSha: details.sdkSha,
      reportUrl: details.reportUrl,
    },
    files: shownFiles,
    ...(sortedFiles.length > shownFiles.length ? { filesOmitted: sortedFiles.length - shownFiles.length } : {}),
    timeSpan: stats.timeSpan,
    totals: {
      lines: stats.totalLogLines,
      errors: stats.errors,
      warnings: stats.warnings,
      httpRequests: stats.httpRequestCount,
      incompleteRequests: stats.incompleteRequestCount,
      sentryEvents: merged.sentryEvents.length,
    },
    errorsByType: stats.errorsByType.map((e) => ({ count: e.count, message: trim(e.type) })),
    warningsByType: stats.warningsByType.map((e) => ({ count: e.count, message: trim(e.type) })),
    httpErrorsByStatus: stats.httpErrorsByStatus,
    topFailedUrls: stats.topFailedUrls.map((u) => ({ ...u, uri: trim(u.uri, 120) })),
    slowestHttpRequests: stats.slowestHttpRequests.slice(0, 5).map((r) => ({
      durationMs: r.duration, method: r.method, status: r.status, uri: trim(r.uri, 120),
    })),
    sentryEvents: merged.sentryEvents.slice(0, 10).map((e) => ({ platform: e.platform, line: e.lineNumber, message: trim(e.message) })),
    lifecycle: {
      counts: lifecycleCounts,
      lastColdStart: coldStart !== null ? microsToISO(coldStart) : null,
      lastForeground: foreground !== null ? microsToISO(foreground) : null,
    },
  }, null, 1);
}

// ---------------------------------------------------------------------------
// overview / spans trees
// ---------------------------------------------------------------------------

/**
 * Paginate pre-rendered tree lines the same way as line output: slice the body
 * by --offset/--limit and emit a footer. The tree is generated in full (bounded
 * by --depth), so --offset can page past the noisiest nodes into the rest.
 */
function emitTreeBody(out: string[], body: readonly string[], flags: Flags): void {
  const limit = intFlag(flags.limit, 100);
  const offset = intFlag(flags.offset, 0);
  const page = body.slice(offset, offset + limit);
  out.push(...page);
  const remaining = body.length - offset - page.length;
  if (remaining > 0) out.push(`# ${remaining} more nodes — next: --offset ${offset + page.length}`);
  if (page.length === 0) {
    out.push(body.length === 0
      ? '# no matching nodes'
      : `# --offset ${offset} is past the end (${body.length} nodes) — lower --offset`);
  }
}

function overviewTotal(node: OverviewNode, memo: Map<OverviewNode, number>): number {
  const cached = memo.get(node);
  if (cached !== undefined) return cached;
  let total = node.leaves.reduce((s, l) => s + l.occurrences.length, 0);
  for (const c of node.children) total += overviewTotal(c, memo);
  memo.set(node, total);
  return total;
}

export function cmdOverview(ing: Ingest, flags: Flags): string {
  const out: string[] = [];
  const range = resolveRange(ing.merged, flags, (m) => out.push(m));
  rangeHeader(out, range, ing.merged);
  const indices = selectIndices(ing.merged, range, flags);
  const root = buildLogOverview(indices.map((i) => ing.merged.rawLogLines[i]));
  const memo = new Map<OverviewNode, number>();
  const depth = intFlag(flags.depth, 3);
  const body: string[] = [];

  const visit = (node: OverviewNode, level: number): void => {
    const children = [...node.children].sort((a, b) =>
      (b.errorCount + b.warnCount) - (a.errorCount + a.warnCount) || overviewTotal(b, memo) - overviewTotal(a, memo));
    for (const child of children) {
      const indent = '  '.repeat(level);
      const marks = child.errorCount || child.warnCount ? ` — ${child.errorCount} err, ${child.warnCount} warn` : '';
      body.push(`${indent}${child.segment} (${overviewTotal(child, memo)})${marks}`);
      if (level + 1 < depth) visit(child, level + 1);
      else if (child.children.length > 0) body.push(`${indent}  … deeper levels hidden — use --depth ${depth + 1}`);
      // Show where errors/warns come from: top offending leaves only.
      const noisyLeaves = child.leaves.filter((l) => l.errorCount + l.warnCount > 0)
        .sort((a, b) => (b.errorCount + b.warnCount) - (a.errorCount + a.warnCount)).slice(0, 5);
      for (const leaf of noisyLeaves) {
        body.push(`${indent}  @ ${leaf.location} — ${leaf.errorCount} err, ${leaf.warnCount} warn (${leaf.occurrences.length} lines)`);
      }
    }
  };
  visit(root, 0);
  emitTreeBody(out, body, flags);
  return out.join('\n');
}

export function cmdSpans(ing: Ingest, flags: Flags): string {
  const out: string[] = [];
  const range = resolveRange(ing.merged, flags, (m) => out.push(m));
  rangeHeader(out, range, ing.merged);
  const indices = selectIndices(ing.merged, range, flags);
  const root = buildSpanOverview(indices.map((i) => ing.merged.rawLogLines[i]));
  const depth = intFlag(flags.depth, 3);
  const body: string[] = [];

  // Memoized per node (like overviewTotal): spanTotal is called once per node
  // while rendering, and each call walks the whole subtree, so without a cache
  // the totals are O(n²) on large span trees.
  const spanMemo = new Map<SpanNode, number>();
  const spanTotal = (node: SpanNode): number => {
    const cached = spanMemo.get(node);
    if (cached !== undefined) return cached;
    const total = node.leaves.reduce((s, l) => s + l.occurrences.length, 0)
      + node.children.reduce((s, c) => s + spanTotal(c), 0);
    spanMemo.set(node, total);
    return total;
  };

  const visit = (node: SpanNode, level: number): void => {
    const children = [...node.children].sort((a, b) => (b.errorCount + b.warnCount) - (a.errorCount + a.warnCount));
    for (const child of children) {
      const indent = '  '.repeat(level);
      const fields = child.fields.slice(0, 2)
        // Bound the whole value list: sliding-sync pos= fields carry up to 5
        // distinct tokens of hundreds of chars each and otherwise dominate output.
        .map((f) => {
          const joined = f.values.join('|');
          const shown = trim(joined, 64);
          // trim already appends '…' when it cuts; only add the distinct-values
          // marker when the string wasn't length-trimmed, to avoid '…|…'.
          return `${f.key}=${shown}${f.truncated && shown === joined ? '|…' : ''}`;
        }).join(' ');
      const marks = child.errorCount || child.warnCount ? ` — ${child.errorCount} err, ${child.warnCount} warn` : '';
      body.push(`${indent}${child.name}${fields ? ` {${fields}}` : ''} (${spanTotal(child)})${marks}`);
      if (level + 1 < depth) visit(child, level + 1);
      else if (child.children.length > 0) body.push(`${indent}  … deeper levels hidden — use --depth ${depth + 1}`);
    }
  };
  visit(root, 0);
  emitTreeBody(out, body, flags);
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// grep / slice
// ---------------------------------------------------------------------------

export function cmdGrep(ing: Ingest, pattern: string, flags: Flags): string {
  const out: string[] = [];
  const range = resolveRange(ing.merged, flags, (m) => out.push(m));
  rangeHeader(out, range, ing.merged);
  const indices = selectIndices(ing.merged, range, flags);
  const lines = ing.merged.rawLogLines;
  const query = pattern.toLowerCase();
  const matches = indices.filter((i) => lines[i].rawText.toLowerCase().includes(query));
  out.push(`# ${matches.length} matching lines for "${pattern}"`);

  const around = intFlag(flags.around, 0);
  let selected = matches;
  if (around > 0) {
    // Expand within the filtered index list so context respects level/file/time filters.
    const positions = new Map(indices.map((idx, pos) => [idx, pos]));
    const keep = new Set<number>();
    for (const m of matches) {
      const pos = positions.get(m)!;
      for (let p = Math.max(0, pos - around); p <= Math.min(indices.length - 1, pos + around); p++) keep.add(indices[p]);
    }
    selected = [...keep].sort((a, b) => a - b);
  }
  emitEntries(out, buildDisplayEntries(lines, selected), flags, ing.files.length > 1);
  return out.join('\n');
}

export function cmdSlice(ing: Ingest, flags: Flags): string {
  const out: string[] = [];
  const range = resolveRange(ing.merged, flags, (m) => out.push(m));
  rangeHeader(out, range, ing.merged);
  const indices = selectIndices(ing.merged, range, flags);
  emitEntries(out, buildDisplayEntries(ing.merged.rawLogLines, indices), flags, ing.files.length > 1);
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// http
// ---------------------------------------------------------------------------

function isFailed(r: HttpRequest): boolean {
  // status may carry a reason phrase ("404 Not Found"), so parse the numeric
  // prefix rather than Number(), which returns NaN for the whole string.
  return !!r.clientError || parseInt(r.status, 10) >= 400;
}

export function cmdHttp(ing: Ingest, flags: Flags): string {
  const out: string[] = [];
  const range = resolveRange(ing.merged, flags, (m) => out.push(m));
  rangeHeader(out, range, ing.merged);
  const lineIndex = new Map(ing.merged.rawLogLines.map((l) => [l.lineNumber, l]));
  const timeOf = (r: HttpRequest): number =>
    lineIndex.get(r.sendLineNumber || r.responseLineNumber)?.timestampUs ?? 0;

  let reqs = ing.merged.httpRequests.filter((r) => {
    if (range) {
      const ts = timeOf(r);
      if (ts < range.startUs || ts > range.endUs) return false;
    }
    return flags.errors ? isFailed(r) : true;
  });

  if (flags.slowest !== undefined) {
    reqs = [...reqs].sort((a, b) => b.requestDurationMs - a.requestDurationMs).slice(0, intFlag(flags.slowest, 10));
  }

  out.push(`# ${reqs.length} requests${flags.errors ? ' (failures only)' : ''}`);
  const limit = intFlag(flags.limit, 200);
  const offset = intFlag(flags.offset, 0);
  const page = reqs.slice(offset, offset + limit);
  for (const r of page) {
    const line = lineIndex.get(r.sendLineNumber || r.responseLineNumber);
    const time = line?.displayTime ? line.displayTime.slice(0, 12) : '?';
    const outcome = r.clientError ? `err=${r.clientError}` : (r.status || 'incomplete');
    const retries = (r.numAttempts ?? 1) > 1 ? ` attempts=${r.numAttempts}` : '';
    out.push(`${time} ${r.method} ${trim(r.uri, 120)} → ${outcome} ${r.requestDurationMs}ms up=${r.requestSizeString || '0'} down=${r.responseSizeString || '0'}${retries} [line ${r.sendLineNumber || r.responseLineNumber}]`);
  }
  const remaining = reqs.length - offset - page.length;
  if (remaining > 0) out.push(`# ${remaining} more — next: --offset ${offset + page.length}`);
  if (page.length === 0 && reqs.length > 0) {
    out.push(`# --offset ${offset} is past the end (${reqs.length} requests) — lower --offset`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// cycles
// ---------------------------------------------------------------------------

export function cmdCycles(ing: Ingest, flags: Flags): string {
  const out: string[] = [];
  const range = resolveRange(ing.merged, flags, (m) => out.push(m));
  rangeHeader(out, range, ing.merged);
  const all = (ing.merged.lifecycleEvents ?? []) as readonly LifecycleEvent[];
  const events = range ? all.filter((e) => e.timestampUs >= range.startUs && e.timestampUs <= range.endUs) : all;

  const limit = intFlag(flags.limit, 100);
  const offset = intFlag(flags.offset, 0);
  // Most recent activity matters most, so page backwards from the end.
  const { page: eventsPage, older: olderEvents } = tailPage(events, limit, offset);
  if (events.length === 0) {
    out.push('# no lifecycle events detected');
  } else if (eventsPage.length === 0) {
    out.push(`# --offset ${offset} is past the end (${events.length} events) — lower --offset`);
  } else {
    if (olderEvents > 0) out.push(`# ${olderEvents} earlier events — next: --offset ${offset + eventsPage.length}`);
    for (const e of eventsPage) {
      out.push(`${microsToISO(e.timestampUs)} ${e.kind} (${e.platform}) [line ${e.lineNumber}]`);
    }
  }

  const { min, max } = getMinMaxTimestamps(ing.merged.rawLogLines);
  if (min > 0) {
    const segments = deriveAppStateSegments(all, range?.startUs ?? min, range?.endUs ?? max);
    out.push('# app-state segments:');
    const { page: segPage, older: olderSegs } = tailPage(segments, limit, offset);
    if (segments.length === 0) {
      out.push('  # none');
    } else if (segPage.length === 0) {
      out.push(`  # --offset ${offset} is past the end (${segments.length} segments) — lower --offset`);
    } else {
      if (olderSegs > 0) out.push(`  # ${olderSegs} earlier segments — next: --offset ${offset + segPage.length}`);
      for (const s of segPage) {
        out.push(`  ${s.state} ${microsToISO(s.startUs as TimestampMicros)} → ${microsToISO(s.endUs as TimestampMicros)} (${formatDuration((s.endUs - s.startUs) / 1000)})`);
      }
    }
  }
  const coldStart = lastColdStartUs(all);
  const foreground = lastForegroundUs(all);
  out.push(`# last cold start: ${coldStart !== null ? microsToISO(coldStart) : 'none'}`);
  out.push(`# last foreground: ${foreground !== null ? microsToISO(foreground) : 'none'}`);
  out.push(`# crashes: ${all.filter((e) => e.kind === 'crash').length}`);
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export function run(argv: string[]): { code: number; output: string } {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      from: { type: 'string' },
      to: { type: 'string' },
      since: { type: 'string' },
      last: { type: 'string' },
      level: { type: 'string' },
      around: { type: 'string' },
      file: { type: 'string' },
      limit: { type: 'string' },
      offset: { type: 'string' },
      depth: { type: 'string' },
      errors: { type: 'boolean' },
      slowest: { type: 'string' },
      top: { type: 'string' },
    },
  });
  const [cmd, path, pattern] = positionals;
  if (!cmd || !path) return { code: 2, output: USAGE };
  const flags = values as Flags;

  // Validate the command (and grep's pattern) before touching the filesystem, so
  // a typo'd command surfaces the usage message rather than a parse/IO error.
  const known = ['precheck', 'summary', 'overview', 'spans', 'grep', 'slice', 'http', 'cycles'];
  if (!known.includes(cmd)) return { code: 2, output: `unknown command "${cmd}"\n\n${USAGE}` };
  if (cmd === 'grep' && !pattern) return { code: 2, output: 'grep needs a pattern: rageshake grep <path> <pattern>' };

  const ing = loadInput(path);
  switch (cmd) {
    case 'precheck': {
      const { ok, report } = cmdPrecheck(ing);
      return { code: ok ? 0 : 1, output: report };
    }
    case 'summary': return { code: 0, output: cmdSummary(ing, flags) };
    case 'overview': return { code: 0, output: cmdOverview(ing, flags) };
    case 'spans': return { code: 0, output: cmdSpans(ing, flags) };
    case 'grep': return { code: 0, output: cmdGrep(ing, pattern as string, flags) };
    case 'slice': return { code: 0, output: cmdSlice(ing, flags) };
    case 'http': return { code: 0, output: cmdHttp(ing, flags) };
    default: return { code: 0, output: cmdCycles(ing, flags) };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { code, output } = run(process.argv.slice(2));
    process.stdout.write(`${output}\n`);
    process.exit(code);
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
}
