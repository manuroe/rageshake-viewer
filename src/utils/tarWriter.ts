/**
 * Minimal POSIX/ustar tar writer — the inverse of `parseTar` (`tarParser.ts`).
 *
 * Emits regular-file entries (typeflag '0') with a ustar header, data padded to
 * 512-byte blocks, and two trailing zero blocks. Names longer than 100 chars are
 * split into the ustar `prefix` (155) + `name` (100) fields at a '/' boundary.
 *
 * ponytail: names are written as latin1 (one byte per char) to match parseTar's
 * `TextDecoder('latin1')` reader, so any code point 0x00–0xFF round-trips exactly;
 * code points above 0xFF are truncated (rageshake members are ASCII). No GNU long
 * name support — a path with no usable '/' split under 100/155 throws.
 */

const BLOCK_SIZE = 512;

export interface TarFile {
  readonly name: string;
  readonly data: Uint8Array;
}

/** Write `str` as latin1 bytes (one byte per char) — matches parseTar's reader. */
function writeStr(block: Uint8Array, offset: number, maxLen: number, str: string): void {
  const n = Math.min(str.length, maxLen);
  for (let i = 0; i < n; i++) block[offset + i] = str.charCodeAt(i) & 0xff;
}

/** Write a null-terminated octal number into a fixed-width field. */
function writeOctal(block: Uint8Array, offset: number, len: number, value: number): void {
  writeStr(block, offset, len - 1, value.toString(8).padStart(len - 1, '0'));
  // last byte stays 0 (null terminator)
}

/** Split a path into ustar { name<=100, prefix<=155 } fields. */
function splitName(path: string): { name: string; prefix: string } {
  // latin1: one byte per char, so byte length === string length.
  if (path.length <= 100) return { name: path, prefix: '' };
  for (let idx = path.indexOf('/'); idx !== -1; idx = path.indexOf('/', idx + 1)) {
    const prefix = path.slice(0, idx);
    const name = path.slice(idx + 1);
    if (prefix.length <= 155 && name.length <= 100) {
      return { name, prefix };
    }
  }
  throw new Error(`tarWriter: path too long to encode as ustar: ${path}`);
}

/** True when `path` fits the ustar name/prefix fields, i.e. `buildTar` accepts it. */
export function canEncodeUstarName(path: string): boolean {
  try {
    splitName(path);
    return true;
  } catch {
    return false;
  }
}

function buildHeader(file: TarFile): Uint8Array {
  const h = new Uint8Array(BLOCK_SIZE);
  const { name, prefix } = splitName(file.name);
  writeStr(h, 0, 100, name);
  writeOctal(h, 100, 8, 0o644); // mode
  writeOctal(h, 108, 8, 0); // uid
  writeOctal(h, 116, 8, 0); // gid
  writeOctal(h, 124, 12, file.data.length); // size
  writeOctal(h, 136, 12, 0); // mtime (fixed 0 for determinism)
  h[156] = 0x30; // typeflag '0' (regular file)
  writeStr(h, 257, 5, 'ustar'); // magic 'ustar\0' (byte 262 stays null)
  h[263] = 0x30; // version '0'
  h[264] = 0x30; // version '0'
  if (prefix) writeStr(h, 345, 155, prefix);

  // Checksum: sum of all bytes with the checksum field taken as spaces.
  for (let i = 148; i < 156; i++) h[i] = 0x20;
  let sum = 0;
  for (let i = 0; i < BLOCK_SIZE; i++) sum += h[i];
  writeStr(h, 148, 6, sum.toString(8).padStart(6, '0'));
  h[154] = 0; // null
  h[155] = 0x20; // space
  return h;
}

/** Build an uncompressed tar byte stream from the given files. */
export function buildTar(files: readonly TarFile[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const file of files) {
    blocks.push(buildHeader(file));
    if (file.data.length > 0) {
      // Push the data as-is plus a small trailing zero block for 512 alignment,
      // rather than allocating a full padded copy of every file.
      blocks.push(file.data);
      const remainder = file.data.length % BLOCK_SIZE;
      if (remainder !== 0) blocks.push(new Uint8Array(BLOCK_SIZE - remainder));
    }
  }
  // Two zero blocks mark end-of-archive.
  blocks.push(new Uint8Array(BLOCK_SIZE), new Uint8Array(BLOCK_SIZE));

  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of blocks) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}
