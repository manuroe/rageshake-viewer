/**
 * Minimal POSIX/ustar tar parser for reading rageshake log archives.
 *
 * Supports:
 * - POSIX ustar regular file entries (typeflag '0' or '\0')
 * - GNU long-name extension (typeflag 'L') — long paths stored in adjacent entry data
 * - End-of-archive detection via two consecutive all-zero 512-byte blocks
 *
 * Directory entries, symlinks, device nodes, and PAX headers are silently
 * skipped. No external dependencies — uses only `Uint8Array` manipulation.
 *
 * @example
 * import { decompressSync } from 'fflate';
 * const tarBytes = decompressSync(gzipBytes);
 * const entries = parseTar(tarBytes);
 * const logEntry = entries.find(e => e.name.endsWith('.log.gz'));
 */

const BLOCK_SIZE = 512;

/** Byte offsets within a 512-byte POSIX tar header block. */
const NAME_OFFSET = 0;
const NAME_LEN = 100;
const SIZE_OFFSET = 124;
const SIZE_LEN = 12;
const TYPEFLAG_OFFSET = 156;
/** ustar prefix field — prepended to name with '/' when non-empty. */
const PREFIX_OFFSET = 345;
const PREFIX_LEN = 155;

/**
 * A single file extracted from a tar archive.
 * Data is a zero-copy slice of the original buffer.
 */
export interface TarEntry {
  /** Full path as stored in the archive header (may include directory prefix). */
  readonly name: string;
  /**
   * Raw bytes of the entry — may be gzip-compressed for `.log.gz` entries.
   * This is a view into the original buffer, not a copy.
   */
  readonly data: Uint8Array;
  /** Byte size of the entry data as declared in the tar header. */
  readonly size: number;
}

/**
 * Reads a null-terminated C string from a fixed-width field in the header.
 */
function readCString(buf: Uint8Array, offset: number, length: number): string {
  let end = offset + length;
  for (let i = offset; i < end; i++) {
    if (buf[i] === 0) {
      end = i;
      break;
    }
  }
  // Use TextDecoder only if available (always true in browsers), otherwise fall back.
  return new TextDecoder('latin1').decode(buf.slice(offset, end));
}

/**
 * Parses a null-terminated octal ASCII string from the header and returns its
 * numeric value. Returns 0 for empty or all-null fields.
 */
function readOctal(buf: Uint8Array, offset: number, length: number): number {
  const str = readCString(buf, offset, length).trim();
  return str.length === 0 ? 0 : parseInt(str, 8);
}

/**
 * Returns true when the 512-byte block starting at `offset` is all zeros.
 * Two consecutive zero blocks mark the end of a tar archive.
 */
function isZeroBlock(buf: Uint8Array, offset: number): boolean {
  const end = offset + BLOCK_SIZE;
  for (let i = offset; i < end; i++) {
    if (buf[i] !== 0) return false;
  }
  return true;
}

/**
 * Parses a POSIX/ustar or GNU tar byte stream and returns all regular-file entries.
 *
 * The returned entries share memory with the input buffer (zero-copy slices).
 * GNU long-name extension (typeflag `'L'`) is handled: the long filename from
 * the extension entry is applied to the immediately following regular-file entry.
 *
 * @example
 * import { decompressSync } from 'fflate';
 * const entries = parseTar(decompressSync(gzipBytes));
 * console.log(entries.map(e => e.name));
 */
export function parseTar(data: Uint8Array): readonly TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;
  /** Name carried forward by a GNU long-name ('L') entry for the next file. */
  let pendingLongName: string | null = null;

  while (offset + BLOCK_SIZE <= data.length) {
    // Two consecutive all-zero 512-byte blocks mark the end of a tar archive.
    // A single zero block is treated conservatively as end-of-archive to avoid
    // spinning over padding in truncated or concatenated archives.
    if (isZeroBlock(data, offset)) {
      if (offset + 2 * BLOCK_SIZE <= data.length && isZeroBlock(data, offset + BLOCK_SIZE)) {
        break;
      }
      break;
    }

    const typeflag = String.fromCharCode(data[offset + TYPEFLAG_OFFSET]);
    const size = readOctal(data, offset + SIZE_OFFSET, SIZE_LEN);
    const dataStart = offset + BLOCK_SIZE;

    if (typeflag === 'L') {
      // GNU long-name: data holds the name for the next entry (null-terminated).
      const nameBytes = data.slice(dataStart, dataStart + size);
      pendingLongName = readCString(nameBytes, 0, nameBytes.length);
    } else if (typeflag === '0' || typeflag === '\0') {
      // Regular file entry
      let name: string;
      if (pendingLongName !== null) {
        name = pendingLongName;
        pendingLongName = null;
      } else {
        const prefix = readCString(data, offset + PREFIX_OFFSET, PREFIX_LEN);
        const base = readCString(data, offset + NAME_OFFSET, NAME_LEN);
        name = prefix.length > 0 ? `${prefix}/${base}` : base;
      }

      // Bounds check: a corrupt or truncated archive may declare a size that
      // extends past the end of the buffer. Stop parsing rather than yielding
      // an incomplete entry.
      if (dataStart + size > data.length) break;
      // subarray() creates a zero-copy view into the same backing buffer —
      // entries are held in memory by the store, so the buffer stays alive.
      const entryData = data.subarray(dataStart, dataStart + size);
      entries.push({ name, data: entryData, size });
    } else {
      // Directories ('5'), symlinks ('2'), PAX headers ('x'/'g'), etc.
      // A non-'L' non-file entry consumes and discards any pending long name.
      pendingLongName = null;
    }

    // Advance past the header block and the data (rounded up to 512-byte boundary)
    const dataBlockCount = Math.ceil(size / BLOCK_SIZE);
    offset += BLOCK_SIZE + dataBlockCount * BLOCK_SIZE;
  }

  return entries;
}
