import { describe, it, expect } from 'vitest';
import { parseTar, type TarEntry } from '../tarParser';

// ── Helpers ────────────────────────────────────────────────────────────────

const encoder = new TextEncoder();

/**
 * Builds a 512-byte POSIX tar header block for a single entry.
 * Only the fields relevant to our parser (name, size, typeflag, prefix) are
 * populated; the rest are zero.
 */
function makeTarHeader(
  name: string,
  dataLength: number,
  typeflag: string = '0',
  prefix: string = ''
): Uint8Array {
  const header = new Uint8Array(512);
  // Name: bytes 0–99
  header.set(encoder.encode(name).slice(0, 100), 0);
  // File size as 11-digit octal + NUL: bytes 124–135
  const sizeOctal = dataLength.toString(8).padStart(11, '0');
  header.set(encoder.encode(sizeOctal), 124);
  // Typeflag: byte 156
  header[156] = typeflag.charCodeAt(0);
  // Prefix: bytes 345–499
  if (prefix.length > 0) {
    header.set(encoder.encode(prefix).slice(0, 155), 345);
  }
  return header;
}

/**
 * Pads `data` up to the nearest 512-byte boundary.
 */
function padToBlock(data: Uint8Array): Uint8Array {
  const blocks = Math.ceil(data.length / 512);
  const padded = new Uint8Array(blocks * 512);
  padded.set(data);
  return padded;
}

/**
 * Concatenates multiple Uint8Array segments into one buffer.
 */
function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/**
 * Builds a complete tar archive buffer from a list of entries.
 * Appends two 512-byte zero blocks (end-of-archive).
 */
function buildTar(
  entries: Array<{ name: string; data: Uint8Array; typeflag?: string; prefix?: string }>
): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const e of entries) {
    parts.push(makeTarHeader(e.name, e.data.length, e.typeflag ?? '0', e.prefix ?? ''));
    parts.push(padToBlock(e.data));
  }
  // End-of-archive: two zero blocks
  parts.push(new Uint8Array(1024));
  return concat(...parts);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('parseTar', () => {
  it('returns an empty array for an empty archive', () => {
    // Two zero blocks only
    const archive = new Uint8Array(1024);
    const entries = parseTar(archive);
    expect(entries).toHaveLength(0);
  });

  it('parses a single regular file entry', () => {
    const content = encoder.encode('hello world');
    const archive = buildTar([{ name: 'hello.txt', data: content }]);

    const entries = parseTar(archive);
    expect(entries).toHaveLength(1);

    const entry: TarEntry = entries[0];
    expect(entry.name).toBe('hello.txt');
    expect(entry.size).toBe(content.length);
    expect(new TextDecoder().decode(entry.data)).toBe('hello world');
  });

  it('parses two entries and preserves order', () => {
    const a = encoder.encode('file A content');
    const b = encoder.encode('file B content');
    const archive = buildTar([
      { name: 'a.log', data: a },
      { name: 'b.log', data: b },
    ]);

    const entries = parseTar(archive);
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toBe('a.log');
    expect(new TextDecoder().decode(entries[0].data)).toBe('file A content');
    expect(entries[1].name).toBe('b.log');
    expect(new TextDecoder().decode(entries[1].data)).toBe('file B content');
  });

  it('skips directory entries (typeflag "5")', () => {
    const dir = new Uint8Array(0);
    const file = encoder.encode('data');
    const archive = buildTar([
      { name: 'somedir/', data: dir, typeflag: '5' },
      { name: 'somedir/file.log', data: file },
    ]);

    const entries = parseTar(archive);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('somedir/file.log');
  });

  it('constructs full path from ustar prefix + name fields', () => {
    const content = encoder.encode('log line');
    const archive = buildTar([
      { name: 'file.log.gz', data: content, prefix: '2026-04-14_ID' }
    ]);

    const entries = parseTar(archive);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('2026-04-14_ID/file.log.gz');
  });

  it('handles GNU long-name extension (typeflag "L")', () => {
    const longName = 'very/long/path/that/exceeds/100/characters/'.padEnd(110, 'x') + '.log.gz';
    const longNameBytes = encoder.encode(longName + '\0');
    const fileContent = encoder.encode('log content');

    const archive = buildTar([
      // 'L' entry: data is the long name
      { name: '././@LongLink', data: longNameBytes, typeflag: 'L' },
      // Regular entry: name field is ignored; long name applies
      { name: 'short.log.gz', data: fileContent },
    ]);

    const entries = parseTar(archive);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe(longName);
    expect(new TextDecoder().decode(entries[0].data)).toBe('log content');
  });

  it('handles entries with zero-length data', () => {
    const archive = buildTar([{ name: 'empty.txt', data: new Uint8Array(0) }]);
    const entries = parseTar(archive);
    expect(entries).toHaveLength(1);
    expect(entries[0].size).toBe(0);
    expect(entries[0].data).toHaveLength(0);
  });

  it('stops at the first zero block (single zero-block terminator)', () => {
    const content = encoder.encode('data');
    // Build a valid entry + one zero block (not two)
    const parts = concat(
      makeTarHeader('a.log', content.length),
      padToBlock(content),
      new Uint8Array(512) // single zero block
    );

    const entries = parseTar(parts);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('a.log');
  });
});
