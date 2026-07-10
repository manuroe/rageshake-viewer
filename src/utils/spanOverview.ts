import type { ParsedLogLine } from '../types/log.types';
import { parseSpans } from './spansParser';

/**
 * Builds the data model behind the `/spans` tree: SDK log lines grouped by
 * their `spans:` chain (the execution-context hierarchy) into a nested tree,
 * with error/warn counts aggregated over each subtree. It's the operation-view
 * counterpart to `logOverview.ts`, which groups the same lines by module.
 *
 * Grouping key is the span NAME per depth (not name+fields): fields are
 * recorded progressively across lines, so keying on them would split one span
 * instance into several nodes. The distinct low-cardinality field values seen
 * at each node are surfaced separately (see `fields`), which is enough to tell
 * e.g. the `encryption` sync_once from the `room-list` one.
 */

const NO_SPAN = '(no span)';

/** Distinct values kept per field key; beyond this the key is marked high-cardinality. */
const MAX_FIELD_VALUES = 5;

/** Distinct values recorded for one field key at a span node. */
export interface SpanFieldSummary {
  readonly key: string;
  /** Up to MAX_FIELD_VALUES distinct values seen. */
  readonly values: readonly string[];
  /** True when more distinct values existed than are listed in `values`. */
  readonly truncated: boolean;
}

/**
 * A source location (file:line) that logged under a given span path, holding
 * every occurrence. Mirrors `OverviewLeaf` so the drilldown wiring is shared.
 */
export interface SpanLeaf {
  readonly location: string;
  readonly occurrences: readonly ParsedLogLine[];
  readonly errorCount: number;
  readonly warnCount: number;
}

/** A node in the span tree. Branch nodes are span names in a chain. */
export interface SpanNode {
  /** This level's span name, e.g. "sync_once". Empty at the root. */
  readonly name: string;
  /** Full ` > `-joined span path to this node — stable and unique per node. */
  readonly path: string;
  /** Distinct field values recorded at this span level. */
  readonly fields: readonly SpanFieldSummary[];
  readonly children: readonly SpanNode[];
  /** Log locations directly under this span path. */
  readonly leaves: readonly SpanLeaf[];
  /** Aggregated over this node's whole subtree. */
  readonly errorCount: number;
  readonly warnCount: number;
}

interface BuildLeaf {
  location: string;
  occurrences: ParsedLogLine[];
  errorCount: number;
  warnCount: number;
}
interface BuildNode {
  name: string;
  path: string;
  fields: Map<string, Set<string>>;
  children: Map<string, BuildNode>;
  leaves: Map<string, BuildLeaf>;
}

function makeBuildNode(name: string, path: string): BuildNode {
  return { name, path, fields: new Map(), children: new Map(), leaves: new Map() };
}

function mergeFields(target: Map<string, Set<string>>, fields: Readonly<Record<string, string>>): void {
  for (const [key, value] of Object.entries(fields)) {
    let set = target.get(key);
    if (!set) {
      set = new Set();
      target.set(key, set);
    }
    // Keep at most MAX_FIELD_VALUES+1 so `truncated` is detectable without
    // holding every distinct value of a high-cardinality field (request_id…).
    if (set.size <= MAX_FIELD_VALUES) set.add(value);
  }
}

function summarizeFields(fields: Map<string, Set<string>>): SpanFieldSummary[] {
  return [...fields].map(([key, set]) => ({
    key,
    values: [...set].slice(0, MAX_FIELD_VALUES),
    truncated: set.size > MAX_FIELD_VALUES,
  }));
}

function leafKey(line: ParsedLogLine, fallback: string): string {
  // Full path — two different files can share a basename (mod.rs, lib.rs) at the
  // same line under the same span, so keying on the basename would merge their
  // occurrences. The view shortens it to the basename for display.
  if (line.filePath) {
    return line.sourceLineNumber !== undefined ? `${line.filePath}:${line.sourceLineNumber}` : line.filePath;
  }
  return fallback;
}

/** Materialize a build node into the public shape, rolling counts up bottom-up. */
function finalize(node: BuildNode): SpanNode {
  const children = [...node.children.values()].map(finalize);
  const leaves = [...node.leaves.values()];
  let errorCount = 0;
  let warnCount = 0;
  for (const leaf of leaves) {
    errorCount += leaf.errorCount;
    warnCount += leaf.warnCount;
  }
  for (const child of children) {
    errorCount += child.errorCount;
    warnCount += child.warnCount;
  }
  return {
    name: node.name,
    path: node.path,
    fields: summarizeFields(node.fields),
    children,
    leaves,
    errorCount,
    warnCount,
  };
}

/**
 * Group log lines by their span chain into a nested tree. Lines with no
 * `spans:` suffix collect under a single "(no span)" node. Node/leaf grouping
 * is O(1) per line via Maps.
 *
 * @example
 * const root = buildSpanOverview(rawLogLines);
 * root.children[0].name;   // e.g. 'root'
 * root.errorCount;         // total ERRORs across the whole tree
 */
export function buildSpanOverview(rawLogLines: readonly ParsedLogLine[]): SpanNode {
  const root = makeBuildNode('', '');

  for (const line of rawLogLines) {
    const segments = parseSpans(line.rawText);
    const names = segments.length > 0 ? segments.map((s) => s.name) : [NO_SPAN];

    let node = root;
    let path = '';
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      path = path ? `${path} > ${name}` : name;
      let child = node.children.get(name);
      if (!child) {
        child = makeBuildNode(name, path);
        node.children.set(name, child);
      }
      if (segments[i]) mergeFields(child.fields, segments[i].fields);
      node = child;
    }

    // Attach the occurrence at the deepest span, keyed by source location.
    const key = leafKey(line, names[names.length - 1]);
    let leaf = node.leaves.get(key);
    if (!leaf) {
      leaf = { location: key, occurrences: [], errorCount: 0, warnCount: 0 };
      node.leaves.set(key, leaf);
    }
    leaf.occurrences.push(line);
    if (line.level === 'ERROR') leaf.errorCount++;
    else if (line.level === 'WARN') leaf.warnCount++;
  }

  return finalize(root);
}
