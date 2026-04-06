/**
 * Unit tests for the useTabLog hook.
 *
 * The hook is a no-op when the `tabLog` param is absent, and otherwise reads
 * log text from localStorage, parses it, loads it into the store, and removes
 * the param from the URL (always, even when the entry is stale or missing).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// vi.mock factories are hoisted above imports, so declare mock fns via vi.hoisted().
const {
  mockLoadAndClearTabLog,
  mockParseLogFile,
  mockLoadLogParserResult,
  mockSetSearchParams,
} = vi.hoisted(() => ({
  mockLoadAndClearTabLog: vi.fn<(uuid: string) => string | null>(),
  mockParseLogFile: vi.fn(),
  mockLoadLogParserResult: vi.fn(),
  mockSetSearchParams: vi.fn(),
}));

vi.mock('../../utils/tabLogUtils', () => ({
  loadAndClearTabLog: mockLoadAndClearTabLog,
}));

vi.mock('../../utils/logParser', () => ({
  parseLogFile: mockParseLogFile,
}));

vi.mock('../../stores/logStore', () => ({
  useLogStore: Object.assign(
    (selector: (state: { loadLogParserResult: typeof mockLoadLogParserResult }) => unknown) =>
      selector({ loadLogParserResult: mockLoadLogParserResult }),
    { getState: () => ({ clearData: vi.fn(), loadLogParserResult: mockLoadLogParserResult }) },
  ),
}));

// Mock react-router-dom so we can control searchParams and capture setSearchParams calls.
let mockSearchParams: URLSearchParams;
vi.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams, mockSetSearchParams],
}));

import { useTabLog } from '../useTabLog';
import { TAB_LOG_PARAM } from '../useTabLog';

const FAKE_UUID_A = '00000000-0000-0000-0000-000000000001';
const FAKE_UUID_B = '00000000-0000-0000-0000-000000000002';
const PARSED_RESULT = { rawLogLines: [], allRequests: [], allHttpRequests: [] };

describe('useTabLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    mockParseLogFile.mockReturnValue(PARSED_RESULT);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('is a no-op when the tabLog param is absent', () => {
    renderHook(() => useTabLog());
    expect(mockLoadAndClearTabLog).not.toHaveBeenCalled();
    expect(mockParseLogFile).not.toHaveBeenCalled();
    expect(mockLoadLogParserResult).not.toHaveBeenCalled();
    expect(mockSetSearchParams).not.toHaveBeenCalled();
  });

  it('loads and parses log text when tabLog param and localStorage entry are present', async () => {
    const logText = 'some log content';
    mockLoadAndClearTabLog.mockReturnValue(logText);
    mockSearchParams = new URLSearchParams(`?${TAB_LOG_PARAM}=${FAKE_UUID_A}`);

    renderHook(() => useTabLog());

    await waitFor(() => {
      expect(mockLoadAndClearTabLog).toHaveBeenCalledWith(FAKE_UUID_A);
      expect(mockParseLogFile).toHaveBeenCalledWith(logText);
      expect(mockLoadLogParserResult).toHaveBeenCalledWith(PARSED_RESULT);
    });
  });

  it('always removes the tabLog param from the URL, even when the localStorage entry is missing', async () => {
    // loadAndClearTabLog returns null — stale/missing entry.
    mockLoadAndClearTabLog.mockReturnValue(null);
    mockSearchParams = new URLSearchParams(`?${TAB_LOG_PARAM}=${FAKE_UUID_A}&filter=foo`);

    renderHook(() => useTabLog());

    await waitFor(() => {
      expect(mockSetSearchParams).toHaveBeenCalled();
    });

    // The updater must remove tabLog while preserving other params.
    const updaterArg = mockSetSearchParams.mock.calls[0][0] as (prev: URLSearchParams) => URLSearchParams;
    const prev = new URLSearchParams(`?${TAB_LOG_PARAM}=${FAKE_UUID_A}&filter=foo`);
    const next = updaterArg(prev);
    expect(next.has(TAB_LOG_PARAM)).toBe(false);
    expect(next.get('filter')).toBe('foo');

    // Should not attempt to parse or load into the store when the text is absent.
    expect(mockParseLogFile).not.toHaveBeenCalled();
    expect(mockLoadLogParserResult).not.toHaveBeenCalled();
  });

  it('processes a second distinct UUID when tabLogId changes', async () => {
    const logText = 'log for A';
    mockLoadAndClearTabLog.mockReturnValue(logText);
    mockSearchParams = new URLSearchParams(`?${TAB_LOG_PARAM}=${FAKE_UUID_A}`);

    const { rerender } = renderHook(() => useTabLog());
    await waitFor(() => expect(mockLoadLogParserResult).toHaveBeenCalledTimes(1));

    // Switch to a different UUID — the hook should process it even though it ran before.
    act(() => {
      mockSearchParams = new URLSearchParams(`?${TAB_LOG_PARAM}=${FAKE_UUID_B}`);
    });
    rerender();

    await waitFor(() => expect(mockLoadLogParserResult).toHaveBeenCalledTimes(2));
    expect(mockLoadAndClearTabLog).toHaveBeenNthCalledWith(2, FAKE_UUID_B);
  });
});
