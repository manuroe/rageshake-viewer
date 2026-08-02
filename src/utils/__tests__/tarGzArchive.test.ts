/**
 * Unit tests for parseTarGzArchive — the shared `.tar.gz` decode path used by
 * both the drop zone and the `?archive=<url>` loader.
 */
import { describe, it, expect } from 'vitest';
import { gzipSync } from 'fflate';
import { buildTar } from '../tarWriter';
import { parseTarGzArchive, MAX_TAR_GZ_SIZE } from '../tarGzArchive';
import { FileError } from '../errorHandling';

const encoder = new TextEncoder();

describe('parseTarGzArchive', () => {
  it('unpacks entries from a gzipped tar', () => {
    const bytes = gzipSync(
      buildTar([
        { name: 'details.json', data: encoder.encode('{}') },
        { name: 'console.2026-07-29-15.log', data: encoder.encode('hello') },
      ])
    );

    const entries = parseTarGzArchive(bytes);

    expect(entries.map((e) => e.name)).toEqual(['details.json', 'console.2026-07-29-15.log']);
    expect(new TextDecoder().decode(entries[1].data)).toBe('hello');
  });

  it('rejects an archive with no files', () => {
    expect(() => parseTarGzArchive(gzipSync(buildTar([])))).toThrow(FileError);
    expect(() => parseTarGzArchive(gzipSync(buildTar([])))).toThrow(/contains no files/);
  });

  it('rejects an oversized archive before decompressing it', () => {
    // byteLength is all the guard reads, so a stub avoids allocating 500 MB.
    const huge = { byteLength: MAX_TAR_GZ_SIZE + 1 } as unknown as Uint8Array;
    expect(() => parseTarGzArchive(huge)).toThrow(/too large/);
  });

  it('throws on bytes that are not gzip', () => {
    expect(() => parseTarGzArchive(encoder.encode('not gzip at all'))).toThrow();
  });
});
