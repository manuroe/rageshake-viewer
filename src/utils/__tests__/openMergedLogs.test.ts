import { describe, it, expect, beforeEach, vi } from 'vitest';
import { orderChronologically, openMergedEntries } from '../openMergedLogs';
import { useArchiveStore } from '../../stores/archiveStore';
import { useListingStore } from '../../stores/listingStore';
import { useLogStore } from '../../stores/logStore';
import type { LogParserResult } from '../../types/log.types';

const { mockFetchExtensionFileBytes } = vi.hoisted(() => ({ mockFetchExtensionFileBytes: vi.fn() }));
vi.mock('../extensionFileLoader', () => ({ fetchExtensionFileBytes: mockFetchExtensionFileBytes }));

// parseLogFile is heavy and content-sensitive; stub it so the test exercises the
// dispatch/merge/visited glue, not the parser.
vi.mock('../logParser', () => ({
  parseLogFile: (): LogParserResult => ({
    requests: [], httpRequests: [], connectionIds: [],
    rawLogLines: [
      {
        lineNumber: 1, rawText: 'x', isoTimestamp: '2026-04-14T08:00:00.000000Z',
        timestampUs: 0, displayTime: '08:00:00', level: 'INFO', message: 'x', strippedMessage: 'x',
      },
    ],
    sentryEvents: [],
  }) as LogParserResult,
}));

describe('orderChronologically', () => {
  it('sorts by embedded date oldest-first', () => {
    expect(
      orderChronologically(['logs.2026-04-14-10.log.gz', 'logs.2026-04-14-08.log.gz', 'logs.2026-04-14-09.log.gz'])
    ).toEqual(['logs.2026-04-14-08.log.gz', 'logs.2026-04-14-09.log.gz', 'logs.2026-04-14-10.log.gz']);
  });
});

describe('openMergedEntries (archive source)', () => {
  beforeEach(() => {
    useLogStore.getState().clearData();
    useArchiveStore.getState().clearArchive();
  });

  it('merges selected archive entries, loads them, and marks them visited', async () => {
    const data = new TextEncoder().encode('raw log text');
    useArchiveStore.getState().loadArchive('test.tar.gz', [
      { name: 'logs.2026-04-14-09.log', data },
      { name: 'logs.2026-04-14-08.log', data },
    ]);

    const route = await openMergedEntries(['logs.2026-04-14-09.log', 'logs.2026-04-14-08.log']);

    expect(route).toBe('/summary');
    // loaded in chronological order (08 before 09)
    expect(useLogStore.getState().loadedEntryNames).toEqual([
      'logs.2026-04-14-08.log',
      'logs.2026-04-14-09.log',
    ]);
    expect(useArchiveStore.getState().visitedEntries.has('logs.2026-04-14-08.log')).toBe(true);
    expect(useArchiveStore.getState().visitedEntries.has('logs.2026-04-14-09.log')).toBe(true);
  });

  it('returns null when no name resolves to a known source', async () => {
    const route = await openMergedEntries(['nope.log']);
    expect(route).toBe(null);
    expect(useLogStore.getState().loadedEntryNames).toEqual([]);
  });
});

describe('openMergedEntries (listing source)', () => {
  beforeEach(() => {
    useLogStore.getState().clearData();
    useArchiveStore.getState().clearArchive();
    useListingStore.getState().clearListing();
    mockFetchExtensionFileBytes.mockReset().mockResolvedValue(new TextEncoder().encode('raw log text'));
  });

  it('fetches listing entries through the extension, merges, and marks visited', async () => {
    useListingStore.getState().loadListing('https://rs.example/api/listing/X/', [
      { name: 'console.2026-04-14-09.log', url: 'https://rs.example/api/listing/X/console.2026-04-14-09.log' },
      { name: 'console.2026-04-14-08.log', url: 'https://rs.example/api/listing/X/console.2026-04-14-08.log' },
    ]);

    const route = await openMergedEntries(['console.2026-04-14-09.log', 'console.2026-04-14-08.log']);

    expect(route).toBe('/summary');
    expect(mockFetchExtensionFileBytes).toHaveBeenCalledTimes(2);
    expect(useLogStore.getState().loadedEntryNames).toEqual([
      'console.2026-04-14-08.log',
      'console.2026-04-14-09.log',
    ]);
    expect(useListingStore.getState().visitedEntries.has('console.2026-04-14-08.log')).toBe(true);
  });

  it('skips a listing entry whose fetch returns nothing', async () => {
    mockFetchExtensionFileBytes.mockResolvedValue(null);
    useListingStore.getState().loadListing('https://rs.example/api/listing/X/', [
      { name: 'console.2026-04-14-08.log', url: 'https://rs.example/api/listing/X/console.2026-04-14-08.log' },
    ]);

    const route = await openMergedEntries(['console.2026-04-14-08.log']);
    expect(route).toBe(null);
  });
});
