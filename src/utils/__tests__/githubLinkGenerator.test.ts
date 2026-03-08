import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateGitHubSourceUrl, resolveSwiftFilenameToBlobUrl, resetSwiftPathCacheForTests, SWIFT_PATH_SESSION_STORAGE_KEY } from '../githubLinkGenerator';

describe('githubLinkGenerator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetSwiftPathCacheForTests();
  });

  it('builds element-x-ios links for swift files', () => {
    const url = generateGitHubSourceUrl('ElementX/Sources/Services/Client/ClientProxy.swift', 1092);
    expect(url).toBe('https://github.com/element-hq/element-x-ios/blob/main/ElementX/Sources/Services/Client/ClientProxy.swift#L1092');
  });

  it('falls back to code search for short swift filenames', () => {
    const url = generateGitHubSourceUrl('ClientProxy.swift', 1092);
    expect(url).toBe('https://github.com/element-hq/element-x-ios/search?q=ClientProxy.swift%20repo%3Aelement-hq%2Felement-x-ios&type=code');
  });

  it('builds matrix-rust-sdk links for rust files', () => {
    const url = generateGitHubSourceUrl('crates/matrix-sdk/src/http_client/native.rs', 78);
    expect(url).toBe('https://github.com/matrix-org/matrix-rust-sdk/blob/main/crates/matrix-sdk/src/http_client/native.rs#L78');
  });

  it('returns undefined for unsupported extensions', () => {
    const url = generateGitHubSourceUrl('foo/bar.ts', 12);
    expect(url).toBeUndefined();
  });

  it('returns undefined when filePath or lineNumber is missing', () => {
    expect(generateGitHubSourceUrl(undefined, 12)).toBeUndefined();
    expect(generateGitHubSourceUrl('foo.rs', undefined)).toBeUndefined();
  });

  it('resolves filename-only swift links to blob URL at line number', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        tree: [
          { path: 'ElementX/Sources/Services/Client/ClientProxy.swift', type: 'blob' },
        ],
      }),
    } as Response);

    const url = await resolveSwiftFilenameToBlobUrl('ClientProxy.swift', 1092);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/element-hq/element-x-ios/git/trees/main?recursive=1',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(url).toBe('https://github.com/element-hq/element-x-ios/blob/main/ElementX/Sources/Services/Client/ClientProxy.swift#L1092');
  });

  it('returns undefined when the tree fetch fails and allows a retry', async () => {
    // First call fails.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    } as Response);

    const first = await resolveSwiftFilenameToBlobUrl('Unknown.swift', 99);
    expect(first).toBeUndefined();

    // After failure treeFetchPromise is reset; second call retries and succeeds.
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        tree: [{ path: 'ElementX/Sources/Unknown.swift', type: 'blob' }],
      }),
    } as Response);

    const second = await resolveSwiftFilenameToBlobUrl('Unknown.swift', 99);
    expect(second).toBe('https://github.com/element-hq/element-x-ios/blob/main/ElementX/Sources/Unknown.swift#L99');
  });

  it('returns undefined when file is not found in the tree', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ tree: [] }),
    } as Response);

    const url = await resolveSwiftFilenameToBlobUrl('Unknown.swift', 99);

    expect(url).toBeUndefined();
  });

  it('fetches the tree only once for multiple swift filename resolutions', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        tree: [
          { path: 'ElementX/Sources/Services/Client/ClientProxy.swift', type: 'blob' },
          { path: 'ElementX/Sources/Other/OtherFile.swift', type: 'blob' },
        ],
      }),
    } as Response);

    const first = await resolveSwiftFilenameToBlobUrl('ClientProxy.swift', 100);
    const second = await resolveSwiftFilenameToBlobUrl('ClientProxy.swift', 101);
    const third = await resolveSwiftFilenameToBlobUrl('OtherFile.swift', 5);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first).toBe('https://github.com/element-hq/element-x-ios/blob/main/ElementX/Sources/Services/Client/ClientProxy.swift#L100');
    expect(second).toBe('https://github.com/element-hq/element-x-ios/blob/main/ElementX/Sources/Services/Client/ClientProxy.swift#L101');
    expect(third).toBe('https://github.com/element-hq/element-x-ios/blob/main/ElementX/Sources/Other/OtherFile.swift#L5');
  });

  it('hydrates path cache from sessionStorage on the second resolve call', async () => {
    // Seed sessionStorage directly (as if a previous page load had populated it).
    sessionStorage.setItem(
      SWIFT_PATH_SESSION_STORAGE_KEY,
      JSON.stringify({ 'ClientProxy.swift': 'ElementX/Sources/Services/Client/ClientProxy.swift' })
    );

    // resolveSwiftFilenameToBlobUrl should hydrate from sessionStorage without fetching.
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const url = await resolveSwiftFilenameToBlobUrl('ClientProxy.swift', 1092);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(url).toBe('https://github.com/element-hq/element-x-ios/blob/main/ElementX/Sources/Services/Client/ClientProxy.swift#L1092');
  });
});

