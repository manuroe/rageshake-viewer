/**
 * Unit tests for the useArchiveUrl hook.
 *
 * The hook is a no-op without the `archive` param. With it, it fetches the
 * archive, unpacks it, opens every analyzable entry as one merged timeline, and
 * navigates to /logs with the param dropped and the rest (line, filter, start,
 * end) preserved. Any failure lands on the landing page instead.
 */
import { StrictMode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const { mockParseTarGzArchive, mockLoadArchive, mockOpenMergedEntries, mockNavigate } = vi.hoisted(() => ({
  mockParseTarGzArchive: vi.fn(),
  mockLoadArchive: vi.fn(),
  mockOpenMergedEntries: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock('../../utils/tarGzArchive', () => ({
  parseTarGzArchive: mockParseTarGzArchive,
}));

vi.mock('../../utils/openMergedLogs', () => ({
  openMergedEntries: mockOpenMergedEntries,
}));

vi.mock('../../stores/archiveStore', () => ({
  useArchiveStore: { getState: () => ({ loadArchive: mockLoadArchive }) },
}));

let mockSearchParams: URLSearchParams;
vi.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams, vi.fn()],
  useNavigate: () => mockNavigate,
}));

import { useArchiveUrl, ARCHIVE_URL_PARAM } from '../useArchiveUrl';

const ARCHIVE_URL = 'http://127.0.0.1:7357/cases/ios-1-slug/shakes/2026-07-22_112505-FG4DKXZW.tar.gz';
const ENTRIES = [
  { name: 'details.json', data: new Uint8Array() },
  { name: 'console.2026-07-22-11.log.gz', data: new Uint8Array() },
  { name: 'crash.png', data: new Uint8Array() },
];

function mockFetchOk(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })
  );
}

describe('useArchiveUrl', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSearchParams = new URLSearchParams();
    mockParseTarGzArchive.mockReturnValue(ENTRIES);
    mockOpenMergedEntries.mockResolvedValue('/summary');
  });

  it('is a no-op when the archive param is absent', () => {
    mockFetchOk();
    renderHook(() => useArchiveUrl());
    expect(fetch).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('fetches the archive, opens the analyzable entries merged, and lands on /logs', async () => {
    mockFetchOk();
    mockSearchParams = new URLSearchParams(`?${ARCHIVE_URL_PARAM}=${ARCHIVE_URL}&line=1234&filter=sync`);

    renderHook(() => useArchiveUrl());

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect(fetch).toHaveBeenCalledWith(ARCHIVE_URL);
    // Store name is the URL's last segment, not the whole URL.
    expect(mockLoadArchive).toHaveBeenCalledWith('2026-07-22_112505-FG4DKXZW.tar.gz', ENTRIES);
    // details.json and the screenshot are not logs; only the log file is opened.
    expect(mockOpenMergedEntries).toHaveBeenCalledWith(['console.2026-07-22-11.log.gz']);
    // /logs regardless of the route openMergedEntries returned ('/summary' here):
    // the link is pointing at a log line.
    const [{ pathname, search }] = mockNavigate.mock.calls[0] as [{ pathname: string; search: string }];
    expect(pathname).toBe('/logs');
    const nextParams = new URLSearchParams(search);
    expect(nextParams.has(ARCHIVE_URL_PARAM)).toBe(false);
    expect(nextParams.get('line')).toBe('1234');
    expect(nextParams.get('filter')).toBe('sync');
  });

  it('falls back to the landing page when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    mockSearchParams = new URLSearchParams(`?${ARCHIVE_URL_PARAM}=${ARCHIVE_URL}&line=1234`);

    renderHook(() => useArchiveUrl());

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    const [{ pathname, search }] = mockNavigate.mock.calls[0] as [{ pathname: string; search: string }];
    expect(pathname).toBe('/');
    expect(new URLSearchParams(search).has(ARCHIVE_URL_PARAM)).toBe(false);
    expect(mockOpenMergedEntries).not.toHaveBeenCalled();
  });

  it('falls back to the landing page when the archive holds no analyzable log', async () => {
    mockFetchOk();
    mockOpenMergedEntries.mockResolvedValue(null);
    mockSearchParams = new URLSearchParams(`?${ARCHIVE_URL_PARAM}=${ARCHIVE_URL}`);

    renderHook(() => useArchiveUrl());

    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
    expect((mockNavigate.mock.calls[0][0] as { pathname: string }).pathname).toBe('/');
  });

  it('still loads the archive under StrictMode, exactly once', async () => {
    // The app runs inside StrictMode, so effects go mount → cleanup → mount in
    // dev. Cancelling the first run's fetch on that cleanup would strand the app
    // on the loading screen, because the second run skips the fetch entirely.
    mockFetchOk();
    mockSearchParams = new URLSearchParams(`?${ARCHIVE_URL_PARAM}=${ARCHIVE_URL}&line=1234`);

    renderHook(() => useArchiveUrl(), { wrapper: StrictMode });

    await waitFor(() => expect(mockLoadArchive).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((mockNavigate.mock.calls[0][0] as { pathname: string }).pathname).toBe('/logs');
  });

  it('drops the param without re-fetching when a second link names the archive already open', async () => {
    // A report cites several lines in one rageshake. Following the second link
    // must not leave the app on the loading screen waiting for a fetch that
    // already happened — the param has to be dropped either way.
    mockFetchOk();
    mockSearchParams = new URLSearchParams(`?${ARCHIVE_URL_PARAM}=${ARCHIVE_URL}&line=1234`);

    const { rerender } = renderHook(() => useArchiveUrl());
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));

    act(() => {
      mockSearchParams = new URLSearchParams(`?${ARCHIVE_URL_PARAM}=${ARCHIVE_URL}&line=5678`);
    });
    rerender();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(2));
    expect(fetch).toHaveBeenCalledTimes(1);
    const [{ pathname, search }] = mockNavigate.mock.calls[1] as [{ pathname: string; search: string }];
    expect(pathname).toBe('/logs');
    const nextParams = new URLSearchParams(search);
    expect(nextParams.has(ARCHIVE_URL_PARAM)).toBe(false);
    expect(nextParams.get('line')).toBe('5678');
  });

  it('does not re-fetch the same archive on re-render, but does process a different one', async () => {
    mockFetchOk();
    mockSearchParams = new URLSearchParams(`?${ARCHIVE_URL_PARAM}=${ARCHIVE_URL}`);

    const { rerender } = renderHook(() => useArchiveUrl());
    await waitFor(() => expect(mockLoadArchive).toHaveBeenCalledTimes(1));
    rerender();
    expect(fetch).toHaveBeenCalledTimes(1);

    act(() => {
      mockSearchParams = new URLSearchParams(`?${ARCHIVE_URL_PARAM}=${ARCHIVE_URL}.other`);
    });
    rerender();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
  });
});
