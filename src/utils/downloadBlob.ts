/**
 * Trigger a browser download of in-memory data via a temporary object URL.
 *
 * Uses the blob + anchor pattern: the anchor is appended to the DOM before the
 * click so all browsers can find it, and the object URL is revoked on the next
 * tick so the download has started first.
 */
export function downloadBlob(data: Uint8Array | string, filename: string, mime: string): void {
  // fflate returns Uint8Array<ArrayBufferLike>, which the DOM lib's BlobPart type
  // doesn't accept directly; the cast is safe (it is a valid BlobPart).
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
