/**
 * Generate a GitHub URL pointing to a specific line in a source file.
 * 
 * @param filePath The file path (e.g., "ClientProxy.swift" or "crates/matrix-sdk/src/http_client/native.rs")
 * @param lineNumber The line number in the source file
 * @returns The GitHub URL, or undefined if the file type is not recognized
 */
export function generateGitHubSourceUrl(
  filePath: string | undefined,
  lineNumber: number | undefined
): string | undefined {
  if (!filePath || !lineNumber) {
    return undefined;
  }

  if (filePath.endsWith('.swift')) {
    // If logs include a full Swift path, link directly to the file+line.
    if (filePath.includes('/')) {
      return `https://github.com/element-hq/element-x-ios/blob/main/${filePath}#L${lineNumber}`;
    }

    // If logs only include a Swift filename, fall back to repo code search.
    // GitHub cannot resolve unknown subdirectories for blob links.
    const query = encodeURIComponent(`${filePath} repo:element-hq/element-x-ios`);
    return `https://github.com/element-hq/element-x-ios/search?q=${query}&type=code`;
  }

  if (filePath.endsWith('.rs')) {
    // Rust files -> matrix-rust-sdk repo
    return `https://github.com/matrix-org/matrix-rust-sdk/blob/main/${filePath}#L${lineNumber}`;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Swift filename → full path resolution
//
// Logs often record only the bare Swift filename (e.g.
// "ClientProxy.swift:1092") without the directory component.  We need the
// full repo-relative path to build a working blob URL such as:
//   https://github.com/element-hq/element-x-ios/blob/main/
//     ElementX/Sources/Services/Client/ClientProxy.swift#L1092
//
// Strategy – GitHub Git Trees API (unauthenticated):
//   The GitHub Code Search API (/search/code) requires authentication and
//   returns HTTP 422 for anonymous requests, so it cannot be used here.
//   Instead we call the Git Trees API once per session:
//     GET /repos/element-hq/element-x-ios/git/trees/main?recursive=1
//   This returns every file path in the repo in a single JSON response and
//   works without any credentials.  We walk the tree, index every .swift
//   blob by its bare filename, and store the result in `swiftPathCache`.
//   Subsequent lookups are instant O(1) map reads.  The fetch is guarded by
//   `treeFetchPromise` so it fires at most once even under concurrent calls.
// ---------------------------------------------------------------------------

interface GitHubTreeItem {
  path?: string;
  type?: string;
}

interface GitHubTreeResponse {
  tree?: GitHubTreeItem[];
  truncated?: boolean;
}

// Maps bare filename (e.g. "ClientProxy.swift") -> full repo path
const swiftPathCache = new Map<string, string>();
// Promise guarding a single in-flight tree fetch
let treeFetchPromise: Promise<void> | null = null;

export function resetSwiftPathCacheForTests(): void {
  swiftPathCache.clear();
  treeFetchPromise = null;
}

async function ensureSwiftTreeLoaded(): Promise<void> {
  if (swiftPathCache.size > 0) return;
  if (!treeFetchPromise) {
    treeFetchPromise = (async () => {
      try {
        const response = await fetch(
          'https://api.github.com/repos/element-hq/element-x-ios/git/trees/main?recursive=1'
        );
        if (!response.ok) return;
        const payload = (await response.json()) as GitHubTreeResponse;
        for (const item of payload.tree ?? []) {
          if (item.type === 'blob' && item.path?.endsWith('.swift')) {
            const name = item.path.split('/').pop();
            // Keep the first occurrence when multiple files share a name.
            if (name && !swiftPathCache.has(name)) {
              swiftPathCache.set(name, item.path);
            }
          }
        }
      } catch {
        // Leave cache empty; caller will fall back to the search URL.
      }
    })();
  }
  return treeFetchPromise;
}

/**
 * Resolve filename-only Swift references (e.g. "ClientProxy.swift") to a concrete
 * repository path, then return a direct blob URL pointing to the given line.
 * Returns undefined if resolution fails.
 */
export async function resolveSwiftFilenameToBlobUrl(
  fileName: string | undefined,
  lineNumber: number | undefined
): Promise<string | undefined> {
  if (!fileName || !lineNumber || !fileName.endsWith('.swift') || fileName.includes('/')) {
    return undefined;
  }

  await ensureSwiftTreeLoaded();

  const path = swiftPathCache.get(fileName);
  if (!path) return undefined;
  return `https://github.com/element-hq/element-x-ios/blob/main/${path}#L${lineNumber}`;
}
