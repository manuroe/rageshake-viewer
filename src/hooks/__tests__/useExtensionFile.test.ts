/**
 * Unit tests for useExtensionFile hook.
 *
 * The hook is a no-op in non-extension contexts, so most tests mock the
 * `chrome` global and module dependencies (fflate, logParser, logStore)
 * to keep tests fast and deterministic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// vi.mock factories are hoisted above imports, so we must use vi.hoisted()
// to declare the mock fns before they are referenced in the factories.
const {
  mockGunzipSync,
  mockIsValidGzipHeader,
  mockDecodeTextBytes,
  mockParseLogFile,
  mockLoadLogParserResult,
  mockNavigate,
} = vi.hoisted(() => ({
  mockGunzipSync: vi.fn(),
  mockIsValidGzipHeader: vi.fn(),
  mockDecodeTextBytes: vi.fn(),
  mockParseLogFile: vi.fn(),
  mockLoadLogParserResult: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock('fflate', () => ({ gunzipSync: mockGunzipSync }));
vi.mock('../../utils/fileValidator', () => ({
  decodeTextBytes: mockDecodeTextBytes,
  isValidGzipHeader: mockIsValidGzipHeader,
}));
vi.mock('../../utils/logParser', () => ({ parseLogFile: mockParseLogFile }));
vi.mock('../../stores/logStore', () => ({
  useLogStore: Object.assign(
    (selector: (state: { loadLogParserResult: typeof mockLoadLogParserResult }) => unknown) =>
      selector({ loadLogParserResult: mockLoadLogParserResult }),
    { getState: () => ({ clearData: vi.fn(), loadLogParserResult: mockLoadLogParserResult }) }
  ),
}));
vi.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams, vi.fn()],
  useNavigate: () => mockNavigate,
}));

// Mutable search params instance shared by all tests; reset in beforeEach.
let mockSearchParams: URLSearchParams;

import { useExtensionFile } from '../useExtensionFile';

// Helper: build a minimal fake chrome.storage.session
function makeChromeSession(
  getImpl: (key: string) => Promise<Record<string, unknown>>,
  removeImpl: (key: string) => Promise<void> = () => Promise.resolve()
): typeof chrome {
  return {
    storage: {
      session: { get: (key: string) => getImpl(key), remove: removeImpl },
    },
  } as unknown as typeof chrome;
}

describe('useExtensionFile', () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    vi.clearAllMocks();
    // Default mock returns: gzip header detected → gunzipSync → text → parsed result
    mockIsValidGzipHeader.mockReturnValue(true);
    mockGunzipSync.mockReturnValue(new Uint8Array([104, 105])); // "hi"
    mockDecodeTextBytes.mockReturnValue('log text');
    mockParseLogFile.mockReturnValue({ logs: [], requests: [] });
  });

  afterEach(() => {
    // Remove any chrome global left by individual tests
    if ('chrome' in globalThis) {
      // @ts-expect-error — intentionally deleting injected global
      delete globalThis.chrome;
    }
  });

  it('is a no-op when the extensionFile param is absent', async () => {
    // No ?extensionFile in URL, chrome not defined
    renderHook(() => useExtensionFile());
    await Promise.resolve(); // flush microtasks
    expect(mockLoadLogParserResult).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('is a no-op when chrome is not defined', async () => {
    mockSearchParams = new URLSearchParams('extensionFile=mykey');
    // chrome is deliberately absent from globalThis (cleared in afterEach)
    renderHook(() => useExtensionFile());
    await Promise.resolve();
    expect(mockLoadLogParserResult).not.toHaveBeenCalled();
  });

  it('is a no-op when chrome.storage.session is undefined', async () => {
    mockSearchParams = new URLSearchParams('extensionFile=mykey');
    // @ts-expect-error — injecting partial chrome without storage.session
    globalThis.chrome = {};
    renderHook(() => useExtensionFile());
    await Promise.resolve();
    expect(mockLoadLogParserResult).not.toHaveBeenCalled();
  });

  it('is a no-op when the storage entry is missing', async () => {
    mockSearchParams = new URLSearchParams('extensionFile=missingkey');
    // session.get returns an empty object (key not found)
    globalThis.chrome = makeChromeSession(() => Promise.resolve({}));
    renderHook(() => useExtensionFile());
    // Flush the async effect
    await new Promise((r) => setTimeout(r, 0));
    expect(mockLoadLogParserResult).not.toHaveBeenCalled();
  });

  it('decompresses gzip bytes, parses, and navigates on the happy path', async () => {
    const key = 'ext-key-001';
    mockSearchParams = new URLSearchParams(`extensionFile=${key}`);

    // Encode a tiny valid base64 payload ("AB" → 2 bytes)
    const base64 = btoa('\x00\x01');
    globalThis.chrome = makeChromeSession(() =>
      Promise.resolve({ [key]: { base64, fileName: 'test.log.gz' } })
    );

    renderHook(() => useExtensionFile());
    // Flush multiple microtask/macrotask rounds to let the async IIFE complete.
    await new Promise((r) => setTimeout(r, 10));

    // Verify the full call chain
    expect(mockGunzipSync).toHaveBeenCalledTimes(1);
    expect(mockDecodeTextBytes).toHaveBeenCalledTimes(1);
    expect(mockParseLogFile).toHaveBeenCalledTimes(1);
    expect(mockLoadLogParserResult).toHaveBeenCalledTimes(1);

    // gunzipSync was called with the decoded bytes
    expect(mockGunzipSync).toHaveBeenCalledWith(
      expect.any(Uint8Array)
    );
    // decodeTextBytes was called with the decompressed result
    expect(mockDecodeTextBytes).toHaveBeenCalledWith(expect.any(Uint8Array));
    // parseLogFile was called with the decoded text
    expect(mockParseLogFile).toHaveBeenCalledWith('log text');
    // loadLogParserResult was called with the parsed result
    expect(mockLoadLogParserResult).toHaveBeenCalledWith({ logs: [], requests: [] });
    // navigate was called to remove the param and go to /summary
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/summary' }),
      { replace: true }
    );
    // The extensionFile param should be removed from the search string
    const navArg = mockNavigate.mock.calls[0][0] as { search: string };
    expect(navArg.search).not.toContain('extensionFile');
  });

  it('skips gunzip and decodes directly when bytes are plain text (server already decompressed)', async () => {
    const key = 'plain-key-001';
    mockSearchParams = new URLSearchParams(`extensionFile=${key}`);
    mockIsValidGzipHeader.mockReturnValue(false); // fetch transparently decompressed

    const base64 = btoa('plain log text here');
    globalThis.chrome = makeChromeSession(() =>
      Promise.resolve({ [key]: { base64, fileName: 'console.log.gz' } })
    );

    renderHook(() => useExtensionFile());
    await new Promise((r) => setTimeout(r, 10));

    // gunzipSync must NOT have been called
    expect(mockGunzipSync).not.toHaveBeenCalled();
    // decodeTextBytes called with the raw decoded bytes
    expect(mockDecodeTextBytes).toHaveBeenCalledTimes(1);
    expect(mockParseLogFile).toHaveBeenCalledTimes(1);
    expect(mockLoadLogParserResult).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/summary' }),
      { replace: true }
    );
  });

  it('silently swallows errors from session.get', async () => {
    mockSearchParams = new URLSearchParams('extensionFile=badkey');
    globalThis.chrome = makeChromeSession(() => Promise.reject(new Error('quota exceeded')));

    // Should not throw
    renderHook(() => useExtensionFile());
    await new Promise((r) => setTimeout(r, 0));
    expect(mockLoadLogParserResult).not.toHaveBeenCalled();
  });

  it('continues to parse and navigate even when session.remove rejects', async () => {
    // session.remove is best-effort — a rejection must not abort parsing.
    const key = 'remove-err-key';
    mockSearchParams = new URLSearchParams(`extensionFile=${key}`);
    const base64 = btoa('a');
    globalThis.chrome = makeChromeSession(
      () => Promise.resolve({ [key]: { base64, fileName: 'test.log.gz' } }),
      () => Promise.reject(new Error('quota exceeded'))
    );

    renderHook(() => useExtensionFile());
    await new Promise((r) => setTimeout(r, 10));

    // Parse and navigate must still have been called
    expect(mockParseLogFile).toHaveBeenCalledTimes(1);
    expect(mockLoadLogParserResult).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/summary' }),
      { replace: true }
    );
  });

  it('silently swallows errors from gunzipSync', async () => {
    const key = 'decomp-err-key';
    mockSearchParams = new URLSearchParams(`extensionFile=${key}`);
    // isValidGzipHeader returns true so we reach gunzipSync
    mockIsValidGzipHeader.mockReturnValue(true);
    globalThis.chrome = makeChromeSession(() =>
      Promise.resolve({ [key]: { base64: btoa('\x00'), fileName: 'bad.log.gz' } })
    );
    mockGunzipSync.mockImplementation(() => { throw new Error('invalid gzip'); });

    renderHook(() => useExtensionFile());
    await new Promise((r) => setTimeout(r, 0));
    expect(mockLoadLogParserResult).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('cleanup sets cancelled flag so a slow async path is ignored', async () => {
    // A hanging session.get promise whose resolution arrives after unmount.
    let resolveGet!: (v: Record<string, unknown>) => void;
    const hangingPromise = new Promise<Record<string, unknown>>((res) => { resolveGet = res; });

    const key = 'slow-key';
    mockSearchParams = new URLSearchParams(`extensionFile=${key}`);
    globalThis.chrome = makeChromeSession(() => hangingPromise);

    const { unmount } = renderHook(() => useExtensionFile());

    // Unmount before the promise resolves → effect cleanup runs
    unmount();

    // Now resolve the promise with a valid entry
    resolveGet({ [key]: { base64: btoa('\x00'), fileName: 'slow.log.gz' } });
    await new Promise((r) => setTimeout(r, 0));

    // cancelled was true, so nothing should have been called
    expect(mockLoadLogParserResult).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
