import type {
  LogParserResult,
  ParsedLogLine,
  SyncRequest,
  HttpRequest,
  SentryEvent,
} from '../types/log.types';

/** A parsed log file paired with the source-file name it came from. */
export interface NamedLogParserResult {
  readonly name: string;
  readonly result: LogParserResult;
}

/**
 * Merge several parsed log files into one continuous dataset.
 *
 * Logs rotate into separate hourly files, and the app emits a separate stream
 * per process (`console`, `nse`, `shareextension`, …). Opening files together
 * lets the user follow activity across hour boundaries and correlate processes
 * on one timeline.
 *
 * Lines (and the request arrays) are **sorted by timestamp**, not concatenated
 * in file order. Same-process hourly files are already time-ordered, but two
 * processes share the same wall-clock hours, so a plain concat would jump
 * backwards in time whenever the process changes. A global timestamp sort fixes
 * both cases (all processes share the device clock). The sort is stable, so
 * lines with identical timestamps keep file order.
 *
 * Each file's line numbers restart at 1, so they are rebased with a cumulative
 * offset. This keeps `lineNumberIndex` collision-free and keeps every line
 * reference (`sendLineNumber`, `responseLineNumber`, `SentryEvent.lineNumber`)
 * pointing at the right line. Every line is tagged with `sourceFile` so the UI
 * can colour it by its originating process.
 */
export function mergeLogParserResults(files: readonly NamedLogParserResult[]): LogParserResult {
  if (files.length === 0) {
    return { requests: [], httpRequests: [], connectionIds: [], rawLogLines: [], sentryEvents: [] };
  }
  if (files.length === 1) {
    // Tag the single file too, so the source-file column is consistent.
    const { name, result } = files[0];
    return { ...result, rawLogLines: result.rawLogLines.map((l) => ({ ...l, sourceFile: name })) };
  }

  const rawLogLines: ParsedLogLine[] = [];
  const requests: SyncRequest[] = [];
  const httpRequests: HttpRequest[] = [];
  const sentryEvents: SentryEvent[] = [];
  const connectionIds = new Set<string>();

  let offset = 0;
  for (const { name, result } of files) {
    for (const line of result.rawLogLines) {
      rawLogLines.push({ ...line, lineNumber: line.lineNumber + offset, sourceFile: name });
    }
    for (const r of result.requests) {
      requests.push({
        ...r,
        sendLineNumber: r.sendLineNumber !== 0 ? r.sendLineNumber + offset : 0,
        responseLineNumber: r.responseLineNumber !== 0 ? r.responseLineNumber + offset : 0,
      });
    }
    for (const r of result.httpRequests) {
      httpRequests.push({
        ...r,
        sendLineNumber: r.sendLineNumber !== 0 ? r.sendLineNumber + offset : 0,
        responseLineNumber: r.responseLineNumber !== 0 ? r.responseLineNumber + offset : 0,
      });
    }
    for (const e of result.sentryEvents) {
      sentryEvents.push({ ...e, lineNumber: e.lineNumber + offset });
    }
    for (const id of result.connectionIds) connectionIds.add(id);
    offset += result.rawLogLines.length;
  }

  // Interleave by time. Array.sort is stable, so equal-timestamp lines keep the
  // file order they were pushed in (e.g. console before nse for the same µs).
  rawLogLines.sort((a, b) => (a.timestampUs as number) - (b.timestampUs as number));

  // Requests render in array order in the tables, so sort them by send time too.
  // Use the merged line index to resolve each request's timestamp.
  const tsByLine = new Map<number, number>();
  for (const line of rawLogLines) tsByLine.set(line.lineNumber, line.timestampUs as number);
  const sendTime = (r: HttpRequest) => tsByLine.get(r.sendLineNumber) ?? tsByLine.get(r.responseLineNumber) ?? 0;
  requests.sort((a, b) => sendTime(a) - sendTime(b));
  httpRequests.sort((a, b) => sendTime(a) - sendTime(b));
  sentryEvents.sort((a, b) => (tsByLine.get(a.lineNumber) ?? 0) - (tsByLine.get(b.lineNumber) ?? 0));

  return {
    requests,
    httpRequests,
    connectionIds: [...connectionIds],
    rawLogLines,
    sentryEvents,
    // Only flag the merged log as anonymized when every part is.
    isAnonymized: files.every((f) => f.result.isAnonymized),
  };
}
