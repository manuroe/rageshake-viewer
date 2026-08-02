/**
 * Decompress and unpack `.tar.gz` rageshake archive bytes.
 *
 * Shared by the drop-zone (`FileUpload`) and the `?archive=<url>` loader
 * (`useArchiveUrl`) so both reject oversized and empty archives with the same
 * user-facing message.
 */
import { decompressSync } from 'fflate';
import { parseTar } from './tarParser';
import { FileError, formatFileSize } from './errorHandling';
import type { ArchiveEntry } from '../stores/archiveStore';

/**
 * Hard limit on the compressed archive: `decompressSync` locks the main thread,
 * so anything larger is refused rather than hanging the tab. Mirrors the gzip
 * path in `fileValidator.ts`.
 */
export const MAX_TAR_GZ_SIZE = 500 * 1024 * 1024; // 500 MB

/**
 * @throws {FileError} when a compressed archive of `byteLength` is over the limit.
 *
 * Callable before the bytes are in memory — the drop zone checks `File.size` up
 * front so an oversized archive is never read at all.
 */
export function assertArchiveSizeOk(byteLength: number): void {
  if (byteLength > MAX_TAR_GZ_SIZE) {
    throw new FileError(
      `Archive is too large (${formatFileSize(byteLength)}). Maximum supported size is ${formatFileSize(MAX_TAR_GZ_SIZE)}.`
    );
  }
}

/**
 * @throws {FileError} when the archive is over `MAX_TAR_GZ_SIZE` or holds no files.
 * @throws Whatever `decompressSync`/`parseTar` throw on malformed input — callers
 *   wrap it into a "not a valid .tar.gz" message.
 */
export function parseTarGzArchive(bytes: Uint8Array): readonly ArchiveEntry[] {
  assertArchiveSizeOk(bytes.byteLength);
  const entries = parseTar(decompressSync(bytes));
  if (entries.length === 0) {
    throw new FileError('The archive contains no files.');
  }
  return entries;
}
