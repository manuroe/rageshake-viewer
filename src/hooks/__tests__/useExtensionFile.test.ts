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

/** Representative rageshake log URL used across tests. */
const TEST_FILE_URL = 'https://rageshakes.example.com/api/listing/2024/abc/console.log.gz';
const TEST_FILE_NAME = 'console.log.gz';

/**
 * Build a minimal fake `chrome` global with a stubbed `runtime.sendMessage`.
 *
 * @param sendMessageImpl - Resolves to the background response for each call.
 */
function makeChrome(
  sendMessageImpl: (...args: unknown[]) => Promise<unknown>
): typeof chrome {
  return {
    runtime: { sendMessage: sendMessageImpl },
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

  it('is a no-op when the extensionFileUrl param is absent', async () => {
    // No ?extensionFileUrl in URL, chrome not defined
    renderHook(() => useExtensionFile());
    await Promise.resolve(); // flush microtasks
    expect(mockLoadLogParserResult).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('is a no-op when chrome is not defined', async () => {
    mockSearchParams = new URLSearchParams(`extensionFileUrl=${encodeURIComponent(TEST_FILE_URL)}`);
    // chrome is deliberately absent from globalThis (cleared in afterEach)
    renderHook(() => useExtensionFile());
    await Promise.resolve();
    expect(mockLoadLogParserResult).not.toHaveBeenCalled();
  });

  it('is a no-op when chrome.runtime.sendMessage is undefined', async () => {
    mockSearchParams = new URLSearchParams(`extensionFileUrl=${encodeURIComponent(TEST_FILE_URL)}`);
    // @ts-expect-error — injecting partial chrome without runtime.sendMessage
    globalThis.chrome = {};
    renderHook(() => useExtensionFile());
    await Promise.resolve();
    expect(mockLoadLogParserResult).not.toHaveBeenCalled();
  });

  it('derives fileName using split fallback when URL constructor throws', async () => {
    // A URL string containing a null byte causes new URL() to throw, exercising
    // the catch fallback that uses split('/').pop() instead.
    const invalidUrl = 'https://example.com/logs/\x00bad.log.gz';
    mockSearchParams = new URLSearchParams(
      `extensionFileUrl=${encodeURIComponent(invalidUrl)}`
    );
    const base64 = btoa('\x00\x01');
    const mockSendMessage = vi.fn().mockResolvedValue({ ok: true, base64, fileName: TEST_FILE_NAME });
    globalThis.chrome = makeChrome(mockSendMessage);

    renderHook(() => useExtensionFile());
    await new Promise((r) => setTimeout(r, 10));
    // The split fallback produces 'bad.log.gz' so sendMessage is called with that name
    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'fetchForViewer' })
    );
    expect(mockLoadLogParserResult).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when fetchForViewer returns ok: false', async () => {
    mockSearchParams = new URLSearchParams(`extensionFileUrl=${encodeURIComponent(TEST_FILE_URL)}&extensionFileName=${TEST_FILE_NAME}`);
    globalThis.chrome = makeChrome(() =>
      Promise.resolve({ ok: false, error: 'fetch failed' })
    );
    renderHook(() => useExtensionFile());
    await new Promise((r) => setTimeout(r, 0));
    expect(mockLoadLogParserResult).not.toHaveBeenCalled();
  });

  it('navigates back to "/" when fetchForViewer returns ok: true but no base64', async () => {
    mockSearchParams = new URLSearchParams(
      `extensionFileUrl=${encodeURIComponent(TEST_FILE_URL)}&extensionFileName=${TEST_FILE_NAME}`
    );
    globalThis.chrome = makeChrome(() =>
      Promise.resolve({ ok: true, base64: undefined, fileName: TEST_FILE_NAME })
    );
    renderHook(() => useExtensionFile());
    await new Promise((r) => setTimeout(r, 0));
    expect(mockLoadLogParserResult).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/' }),
      { replace: true }
    );
  });

  it('decompresses gzip bytes, parses, and navigates on the happy path', async () => {
    mockSearchParams = new URLSearchParams(
      `extensionFileUrl=${encodeURIComponent(TEST_FILE_URL)}&extensionFileName=${TEST_FILE_NAME}`
    );

    // Encode a tiny valid base64 payload ("AB" → 2 bytes)
    const base64 = btoa('\x00\x01');
    globalThis.chrome = makeChrome(() =>
      Promise.resolve({ ok: true, base64, fileName: TEST_FILE_NAME })
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
    expect(mockGunzipSync).toHaveBeenCalledWith(expect.any(Uint8Array));
    // decodeTextBytes was called with the decompressed result
    expect(mockDecodeTextBytes).toHaveBeenCalledWith(expect.any(Uint8Array));
    // parseLogFile was called with the decoded text
    expect(mockParseLogFile).toHaveBeenCalledWith('log text');
    // loadLogParserResult was called with the parsed result
    expect(mockLoadLogParserResult).toHaveBeenCalledWith({ logs: [], requests: [] });
    // navigate was called to remove the params and go to /summary
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/summary' }),
      { replace: true }
    );
    // The extensionFile params should be removed from the search string
    const navArg = mockNavigate.mock.calls[0][0] as { search: string };
    expect(navArg.search).not.toContain('extensionFileUrl');
    expect(navArg.search).not.toContain('extensionFileName');
  });

  it('derives fileName from URL when extensionFileName param is absent', async () => {
    // Only extensionFileUrl is set; hook derives fileName from URL
    mockSearchParams = new URLSearchParams(
      `extensionFileUrl=${encodeURIComponent(TEST_FILE_URL)}`
    );
    const base64 = btoa('\x00\x01');
    const mockSendMessage = vi.fn().mockResolvedValue({ ok: true, base64, fileName: TEST_FILE_NAME });
    globalThis.chrome = makeChrome(mockSendMessage);

    renderHook(() => useExtensionFile());
    await new Promise((r) => setTimeout(r, 10));

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'fetchForViewer', fileName: TEST_FILE_NAME })
    );
    expect(mockLoadLogParserResult).toHaveBeenCalledTimes(1);
  });

  it('skips gunzip and decodes directly when bytes are plain text (server already decompressed)', async () => {
    mockSearchParams = new URLSearchParams(
      `extensionFileUrl=${encodeURIComponent(TEST_FILE_URL)}&extensionFileName=${TEST_FILE_NAME}`
    );
    mockIsValidGzipHeader.mockReturnValue(false); // fetch transparently decompressed

    const base64 = btoa('plain log text here');
    globalThis.chrome = makeChrome(() =>
      Promise.resolve({ ok: true, base64, fileName: TEST_FILE_NAME })
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

  it('navigates back to "/" on sendMessage rejection', async () => {
    mockSearchParams = new URLSearchParams(
      `extensionFileUrl=${encodeURIComponent(TEST_FILE_URL)}&extensionFileName=${TEST_FILE_NAME}`
    );
    globalThis.chrome = makeChrome(() => Promise.reject(new Error('service worker terminated')));

    // Should not throw
    renderHook(() => useExtensionFile());
    await new Promise((r) => setTimeout(r, 0));
    expect(mockLoadLogParserResult).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/' }),
      { replace: true }
    );
  });

  it('navigates back to "/" on errors from gunzipSync', async () => {
    mockSearchParams = new URLSearchParams(
      `extensionFileUrl=${encodeURIComponent(TEST_FILE_URL)}&extensionFileName=${TEST_FILE_NAME}`
    );
    // isValidGzipHeader returns true so we reach gunzipSync
    mockIsValidGzipHeader.mockReturnValue(true);
    globalThis.chrome = makeChrome(() =>
      Promise.resolve({ ok: true, base64: btoa('\x00'), fileName: 'bad.log.gz' })
    );
    mockGunzipSync.mockImplementation(() => { throw new Error('invalid gzip'); });

    renderHook(() => useExtensionFile());
    await new Promise((r) => setTimeout(r, 0));
    expect(mockLoadLogParserResult).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/' }),
      { replace: true }
    );
  });

  it('cleanup sets cancelled flag so a slow sendMessage response is ignored', async () => {
    // A hanging sendMessage promise whose resolution arrives after unmount.
    let resolveSend!: (v: unknown) => void;
    const hangingPromise = new Promise((res) => { resolveSend = res; });

    mockSearchParams = new URLSearchParams(
      `extensionFileUrl=${encodeURIComponent(TEST_FILE_URL)}&extensionFileName=${TEST_FILE_NAME}`
    );
    globalThis.chrome = makeChrome(() => hangingPromise);

    const { unmount } = renderHook(() => useExtensionFile());

    // Unmount before the promise resolves → effect cleanup runs
    unmount();

    // Now resolve the promise with a valid response
    resolveSend({ ok: true, base64: btoa('\x00\x01'), fileName: TEST_FILE_NAME });
    await new Promise((r) => setTimeout(r, 0));

    // cancelled was true, so nothing should have been called
    expect(mockLoadLogParserResult).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('does not navigate on fetch error if cancelled before sendMessage rejects', async () => {
    // A hanging sendMessage promise that rejects after unmount — covers the
    // if (!cancelled) guard in the catch block.
    let rejectSend!: (err: Error) => void;
    const hangingPromise = new Promise<never>((_, rej) => { rejectSend = rej; });

    mockSearchParams = new URLSearchParams(
      `extensionFileUrl=${encodeURIComponent(TEST_FILE_URL)}&extensionFileName=${TEST_FILE_NAME}`
    );
    globalThis.chrome = makeChrome(() => hangingPromise);

    const { unmount } = renderHook(() => useExtensionFile());

    // Unmount before the rejection → cancelled = true
    unmount();

    // Now reject the sendMessage promise
    rejectSend(new Error('service worker terminated'));
    await new Promise((r) => setTimeout(r, 0));

    // cancelled was true when catch fired, so navigate should NOT have been called
    expect(mockLoadLogParserResult).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
