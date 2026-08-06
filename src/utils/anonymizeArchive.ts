import { decompressSync, gzipSync, strToU8 } from 'fflate';
import type { AnonymizationDictionary } from '../types/log.types';
import { buildAnonymizationDictionaryFromTexts, buildCompiledAnonymizer } from './anonymizeUtils';
import { decodeTextBytes, isValidGzipHeader, isValidTextContent } from './fileValidator';
import { buildTar, canEncodeUstarName, type TarFile } from './tarWriter';

/**
 * Anonymise every text file in an archive and repack as a gzipped tar.
 *
 * A single dictionary is built across all text files (with the given salt) so
 * aliases are consistent across the whole archive and match the per-log save.
 * Text file names are preserved exactly; they are decoded, anonymised, and
 * re-gzipped when their name ends in `.gz`. A file that cannot be decoded as
 * text cannot be anonymised either, so it is dropped and replaced by a
 * `<name>.removed` marker rather than shipped raw.
 */

/**
 * Extensions treated as anonymisable text. `.gz` covers inner gzipped logs
 * (e.g. `console.log.gz`). Everything else — notably images — is dropped and
 * replaced by a `.removed` marker, so binary content is neither corrupted nor
 * leaked unanonymised.
 *
 * ponytail: extension whitelist is the ceiling. An unknown type without a listed
 * text extension is dropped with a marker; add its extension here to anonymise it
 * instead.
 */
const TEXT_EXTENSIONS = ['.log', '.txt', '.json', '.csv', '.xml', '.yaml', '.yml', '.ndjson', '.gz'];

function isTextEntry(name: string): boolean {
  const lower = name.toLowerCase();
  if (TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext))) return true;
  // Extensionless members (e.g. "logs") are treated as text.
  return !lower.slice(lower.lastIndexOf('/') + 1).includes('.');
}

/**
 * Body of a `<name>.removed` marker. An entry the anonymiser cannot decode as text
 * cannot be anonymised either, so it is dropped rather than passed through raw —
 * the marker keeps the fact that it existed, which is what a reader needs in order
 * to ask for it out of band.
 */
const REMOVED_NOTE = 'Removed by shakeview anonymization: this file could not be anonymized.\n'
  + 'If its contents matter, ask the reporter to describe it or share it separately.\n';

/**
 * Decode a text entry to a string (gunzipping `.gz`), or null when it cannot be
 * anonymised and must be dropped: a binary member, a `.gz` that is not actually
 * gzip (corrupt/mislabelled), or any member that fails to decompress. Returning
 * null replaces the entry with a marker instead of throwing and aborting the export.
 */
function decodeEntryText(entry: { name: string; data: Uint8Array }): string | null {
  if (!isTextEntry(entry.name)) return null;
  // An empty member is empty text, not undecodable: an empty `.gz` would otherwise
  // fail the gzip-header check below and be replaced by a marker telling the reader
  // to chase content that never existed.
  if (entry.data.length === 0) return '';
  try {
    const isGz = entry.name.toLowerCase().endsWith('.gz');
    if (isGz && !isValidGzipHeader(entry.data)) return null;
    const bytes = isGz ? decompressSync(entry.data) : entry.data;
    // Guard the lenient decode: binary payloads (null bytes / undecodable) would
    // otherwise decode to a lossy string and be re-encoded, corrupting the file.
    // This matters most for extensionless and gzipped-binary members.
    if (!isValidTextContent(bytes).isValid) return null;
    return decodeTextBytes(bytes);
  } catch {
    return null;
  }
}

/**
 * Name of the marker that replaces a dropped entry. An entry already named
 * `<name>.removed` is a marker from an earlier pass and keeps its name, so
 * re-anonymising an anonymised archive doesn't stack suffixes. When the suffix
 * would push the name past what ustar can encode (a 93+ char member with no '/'
 * to split on), the tail of the name is dropped to make room — the marker has to
 * fit, or that one entry aborts the whole export.
 */
function markerName(name: string): string {
  if (name.endsWith('.removed')) return name;
  const withSuffix = `${name}.removed`;
  return canEncodeUstarName(withSuffix) ? withSuffix : `${name.slice(0, -'.removed'.length)}.removed`;
}

/**
 * Build the anonymisation dictionary that `buildAnonymisedArchiveGz` would apply
 * to these entries — one dictionary across all text files. Used to preview the
 * mapping before saving.
 */
export async function buildArchiveDictionary(
  entries: readonly { name: string; data: Uint8Array }[],
  salt: string,
  onProgress?: ArchiveProgress,
): Promise<AnonymizationDictionary> {
  const total = entries.length;
  const maybeYield = makeYielder();
  const texts: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const text = decodeEntryText(entries[i]);
    if (text !== null) texts.push(text);
    onProgress?.('Reading files', i + 1, total);
    await maybeYield();
  }
  onProgress?.('Building mapping', 0, 0);
  return buildAnonymizationDictionaryFromTexts(texts, salt);
}

/** Reports progress of a long archive build. `total === 0` = indeterminate. */
export type ArchiveProgress = (phase: string, current: number, total: number) => void;

/**
 * Returns a `maybeYield()` that hands control back to the event loop at most
 * ~every 50ms, so a progress bar can repaint without a macrotask per file.
 */
function makeYielder(): () => Promise<void> {
  let last = performance.now();
  return async () => {
    if (performance.now() - last <= 50) return;
    await new Promise<void>((r) =>
      typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame(() => r()) : setTimeout(r, 0),
    );
    last = performance.now();
  };
}

/** Derive `<base>-anonym.tar.gz` from an archive name (or a fallback base). */
export function deriveAnonymizedArchiveName(name: string | null): string {
  const raw = (name ?? '').trim() || 'archive';
  const base = raw.replace(/\.tar\.gz$/i, '').replace(/\.tgz$/i, '').replace(/\.tar$/i, '');
  return `${base}-anonym.tar.gz`;
}

/**
 * Build an anonymised `.tar.gz` (returned as bytes) from raw archive entries.
 * Entry order is preserved, as are the names of anonymisable text entries; an
 * entry that cannot be anonymised becomes a `<name>.removed` marker. The work is
 * chunked and yields to the event loop periodically so `onProgress` updates paint.
 */
export async function buildAnonymisedArchiveGz(
  entries: readonly { name: string; data: Uint8Array }[],
  salt: string,
  onProgress?: ArchiveProgress,
): Promise<Uint8Array> {
  const total = entries.length;
  const maybeYield = makeYielder();

  // Phase 1: decode every text entry once (gunzipping inner `.gz` members).
  const decoded: { entry: { name: string; data: Uint8Array }; text: string | null }[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    decoded.push({ entry, text: decodeEntryText(entry) });
    onProgress?.('Reading files', i + 1, total);
    await maybeYield();
  }

  // Phase 2: one dictionary across all text, then anonymise + re-gzip each entry.
  onProgress?.('Anonymising files', 0, total);
  const dict = await buildAnonymizationDictionaryFromTexts(
    decoded.filter((d) => d.text !== null).map((d) => d.text as string),
    salt,
  );
  const apply = buildCompiledAnonymizer(dict);

  const outFiles: TarFile[] = [];
  for (let i = 0; i < decoded.length; i++) {
    const { entry, text } = decoded[i];
    if (text === null) {
      outFiles.push({ name: markerName(entry.name), data: strToU8(REMOVED_NOTE) });
    } else {
      const anonBytes = strToU8(apply(text));
      const data = entry.name.toLowerCase().endsWith('.gz') ? gzipSync(anonBytes) : anonBytes;
      outFiles.push({ name: entry.name, data });
    }
    onProgress?.('Anonymising files', i + 1, total);
    await maybeYield();
  }

  // Phase 3: pack + compress (single blocking step → indeterminate).
  onProgress?.('Compressing', 0, 0);
  await maybeYield();
  return gzipSync(buildTar(outFiles));
}
