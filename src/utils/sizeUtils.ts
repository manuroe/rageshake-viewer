/**
 * Convert a size string from log output to a raw byte count.
 *
 * Parses the compact format emitted by the SDK (e.g. `"48B"`, `"38.8k"`, `"1.2M"`).
 * Uses 1024-based multipliers to stay consistent with {@link formatBytes}.
 *
 * @param sizeStr - The size string to parse. Accepts an optional decimal part and
 *   a unit suffix: `B`/`b` (bytes), `k`/`K` (kibibytes), `m`/`M` (mebibytes),
 *   `g`/`G` (gibibytes). Returns `0` for empty or unrecognised input.
 * @returns The equivalent byte count as an integer, or `0` on parse failure.
 *
 * @example
 * parseSizeString('48B')   // => 48
 * parseSizeString('38.8k') // => 39731
 * parseSizeString('1.2M')  // => 1258291
 * parseSizeString('')      // => 0
 */
export function parseSizeString(sizeStr: string): number {
  if (!sizeStr) return 0;
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*([BbkKmMgG]?)$/);
  if (!match) return 0;
  const value = parseFloat(match[1]);
  if (Number.isNaN(value)) return 0;
  const unit = match[2].toLowerCase();
  switch (unit) {
    case 'k': return Math.round(value * 1_024);
    case 'm': return Math.round(value * 1_048_576);
    case 'g': return Math.round(value * 1_073_741_824);
    default: return Math.round(value); // 'b' or no unit
  }
}

/**
 * Format a raw byte count as a human-readable string.
 *
 * Uses 1024-based (binary) multipliers to stay consistent with
 * {@link parseSizeString}. The result always has one decimal place for
 * units ≥ 1 KB.
 *
 * @param bytes - Non-negative integer byte count.
 * @returns A compact string like `"1.2 MB"`, `"38.8 KB"`, or `"512 B"`.
 *
 * @example
 * formatBytes(512)        // => '512 B'
 * formatBytes(39731)      // => '38.8 KB'
 * formatBytes(1258291)    // => '1.2 MB'
 * formatBytes(1073741824) // => '1.0 GB'
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GB`;
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${bytes} B`;
}
