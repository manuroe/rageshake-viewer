import { describe, it, expect, beforeEach, vi } from 'vitest';
import { orderChronologically, openMergedEntries } from '../openMergedLogs';
import { useArchiveStore } from '../../stores/archiveStore';
import { useListingStore } from '../../stores/listingStore';
import { useLogStore } from '../../stores/logStore';
import type { LogParserResult } from '../../types/log.types';

const { mockFetchExtensionFileBytes, mockParseLogFile } = vi.hoisted(() => ({
  mockFetchExtensionFileBytes: vi.fn(),
  // parseLogFile is heavy and content-sensitive; stub it so the tests exercise the
  // dispatch/merge/visited glue, not the parser. A vi.fn lets a test force a throw.
  mockParseLogFile: vi.fn((): LogParserResult => ({
    requests: [], httpRequests: [], connectionIds: [],
    rawLogLines: [
      {
        lineNumber: 1, rawText: 'x', isoTimestamp: '2026-04-14T08:00:00.000000Z',
        timestampUs: 0, displayTime: '08:00:00', level: 'INFO', message: 'x', strippedMessage: 'x',
      },
    ],
    sentryEvents: [],
  }) as LogParserResult),
}));
vi.mock('../extensionFileLoader', () => ({ fetchExtensionFileBytes: mockFetchExtensionFileBytes }));
vi.mock('../logParser', () => ({ parseLogFile: mockParseLogFile }));

describe('orderChronologically', () => {
  it('sorts by embedded date oldest-first', () => {
    expect(
      orderChronologically(['logs.2026-04-14-10.log.gz', 'logs.2026-04-14-08.log.gz', 'logs.2026-04-14-09.log.gz'])
    ).toEqual(['logs.2026-04-14-08.log.gz', 'logs.2026-04-14-09.log.gz', 'logs.2026-04-14-10.log.gz']);
  });

  it('falls back to the name when an entry has no embedded date', () => {
    // Undated names have no date key, so they sort by name (the `?? name` fallback).
    expect(orderChronologically(['zeta.log', 'alpha.log'])).toEqual(['alpha.log', 'zeta.log']);
  });

  it('breaks same-hour ties deterministically by full name', () => {
    // Same date key (…-08) → ordered by name regardless of input order.
    expect(
      orderChronologically(['nse.2026-04-14-08.log.gz', 'console.2026-04-14-08.log.gz'])
    ).toEqual(['console.2026-04-14-08.log.gz', 'nse.2026-04-14-08.log.gz']);
    expect(
      orderChronologically(['console.2026-04-14-08.log.gz', 'nse.2026-04-14-08.log.gz'])
    ).toEqual(['console.2026-04-14-08.log.gz', 'nse.2026-04-14-08.log.gz']);
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

  it('does not mark an entry visited when parsing fails', async () => {
    // Unique archive + entry name so persisted visit history from other tests
    // can't pre-populate visitedEntries.
    const data = new TextEncoder().encode('raw log text');
    useArchiveStore.getState().loadArchive('parse-fail.tar.gz', [{ name: 'fails.2026-04-14-08.log', data }]);
    mockParseLogFile.mockImplementationOnce(() => { throw new Error('parse failure'); });

    const route = await openMergedEntries(['fails.2026-04-14-08.log']);

    expect(route).toBeNull();
    expect(useArchiveStore.getState().visitedEntries.has('fails.2026-04-14-08.log')).toBe(false);
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
