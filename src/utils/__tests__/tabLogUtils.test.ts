import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { storeTabLog, loadAndClearTabLog } from '../tabLogUtils';

/**
 * Minimal localStorage stub backed by a plain Map so we get full control
 * (including `.clear()`) regardless of what the jsdom environment exposes.
 * Restored via `vi.unstubAllGlobals()` in afterEach.
 */
function makeLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
  };
}

describe('tabLogUtils', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeLocalStorageStub());
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => '12345678-1234-4234-9234-123456789abc'),
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe('storeTabLog', () => {
    it('returns a UUID and persists the entry in localStorage', () => {
      const uuid = storeTabLog('hello log');
      expect(uuid).toBeTypeOf('string');
      expect(uuid).toMatch(/^[0-9a-f-]{36}$/);
      const raw = localStorage.getItem(`rageshake-tablog-${uuid}`);
      expect(raw).not.toBeNull();
      const entry = JSON.parse(raw!);
      expect(entry.text).toBe('hello log');
      expect(typeof entry.createdAt).toBe('number');
    });

    it('returns null when localStorage throws QuotaExceededError', () => {
      // Spy on the stub object itself (not Storage.prototype) since the stub
      // is a plain object, not a Storage instance.
      const setItemSpy = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError');
      });
      const uuid = storeTabLog('big log');
      expect(uuid).toBeNull();
      setItemSpy.mockRestore();
    });

    it('returns null when crypto.randomUUID is unavailable', () => {
      vi.stubGlobal('crypto', {});
      expect(storeTabLog('any text')).toBeNull();
    });
  });

  describe('loadAndClearTabLog', () => {
    it('returns the stored text and removes the key', () => {
      const uuid = storeTabLog('my log text');
      expect(uuid).not.toBeNull();
      const entry = loadAndClearTabLog(uuid!);
      expect(entry).not.toBeNull();
      expect(entry!.text).toBe('my log text');
      expect(entry!.fileName).toBeNull();
      // Key must be deleted after reading
      expect(localStorage.getItem(`rageshake-tablog-${uuid}`)).toBeNull();
    });

    it('returns the stored fileName when one was provided', () => {
      const uuid = storeTabLog('log text', 'my-log.log');
      expect(uuid).not.toBeNull();
      const entry = loadAndClearTabLog(uuid!);
      expect(entry).not.toBeNull();
      expect(entry!.text).toBe('log text');
      expect(entry!.fileName).toBe('my-log.log');
    });

    it('returns null and deletes the key when the entry is older than 10 minutes', () => {
      const uuid = storeTabLog('old log');
      // Advance time beyond the 10-minute expiry
      vi.advanceTimersByTime(10 * 60 * 1000 + 1);
      const entry = loadAndClearTabLog(uuid!);
      expect(entry).toBeNull();
      expect(localStorage.getItem(`rageshake-tablog-${uuid}`)).toBeNull();
    });

    it('returns null for an unknown UUID', () => {
      const entry = loadAndClearTabLog('00000000-0000-0000-0000-000000000000');
      expect(entry).toBeNull();
    });

    it('returns null when localStorage throws a SecurityError', () => {
      vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
        throw new DOMException('SecurityError');
      });
      expect(loadAndClearTabLog('12345678-1234-4234-9234-123456789abc')).toBeNull();
    });

    it('returns null and deletes the key when the stored JSON is malformed', () => {
      const uuid = '11111111-1111-1111-1111-111111111111';
      localStorage.setItem(`rageshake-tablog-${uuid}`, '{not valid json}');
      const entry = loadAndClearTabLog(uuid);
      expect(entry).toBeNull();
      expect(localStorage.getItem(`rageshake-tablog-${uuid}`)).toBeNull();
    });
  });
});
