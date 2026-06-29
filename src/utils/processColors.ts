import { extractCategory } from './listingEntries';

/**
 * Maps each process (log stream) to a colour so merged multi-process logs can
 * be told apart at a glance. The process name is the filename's leading token
 * (`console`, `nse`, `shareextension`, …) — see {@link extractCategory}.
 */

// ponytail: fixed palette, distinct hues that read on both the light and dark
// log backgrounds. Wraps if there are ever more processes than colours.
const PALETTE = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ec4899', // pink
  '#8b5cf6', // violet
  '#14b8a6', // teal
  '#ef4444', // red
  '#a3a30a', // olive
];

/** The process name for a source file (its leading filename token). */
export function processOf(sourceFile: string): string {
  return extractCategory(sourceFile);
}

/**
 * Builds a stable process → colour map from the given source-file names.
 * Processes are sorted by name so colour assignment is deterministic regardless
 * of load order.
 */
export function buildProcessColorMap(sourceFiles: readonly string[]): Map<string, string> {
  const processes = [...new Set(sourceFiles.map(processOf))].sort();
  const map = new Map<string, string>();
  processes.forEach((process, i) => map.set(process, PALETTE[i % PALETTE.length]));
  return map;
}
