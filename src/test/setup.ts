import '@testing-library/jest-dom';
import { vi, afterEach } from 'vitest';

// Ensure a functional localStorage is available before any module code runs.
// Zustand's `persist` middleware calls `createJSONStorage(() => localStorage)`
// at store initialisation time; if localStorage is missing or non-functional at
// that moment the tests will throw "storage.setItem is not a function".
if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.setItem !== 'function') {
  const _store: Record<string, string> = {};
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key: string) => _store[key] ?? null,
      setItem: (key: string, value: string) => { _store[key] = value; },
      removeItem: (key: string) => { delete _store[key]; },
      clear: () => { Object.keys(_store).forEach((k) => delete _store[k]); },
    },
    writable: true,
  });
}

// Auto-reset logStore after each test to ensure test isolation
afterEach(async () => {
  // Dynamic import to avoid circular dependencies during setup
  const { useLogStore } = await import('../stores/logStore');
  useLogStore.getState().clearData();
  vi.clearAllMocks();
});

// Optional: mock matchMedia if used
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      media: query,
      matches: false,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// Mock ResizeObserver
globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock scrollIntoView for tests
if (typeof Element !== 'undefined') {
  Element.prototype.scrollIntoView = vi.fn();
}

if (typeof HTMLElement !== 'undefined') {
  HTMLElement.prototype.scrollIntoView = vi.fn();
}
