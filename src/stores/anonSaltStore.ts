import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Generate a fresh random salt. A per-install random salt makes anonymisation
 * private by default: aliases are opaque and unique to this install. To share
 * aliases across installs (site, a teammate, the extension), copy the salt
 * string into the other install's salt dialog.
 */
export function generateAnonSalt(): string {
  // crypto.randomUUID is secure-context-only and can be missing/throw in
  // restricted environments; fall back to getRandomValues, then Math.random,
  // so store init never crashes.
  try {
    return crypto.randomUUID();
  } catch {
    try {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return `salt-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
    }
  }
}

interface AnonSaltStore {
  salt: string;
  setSalt: (salt: string) => void;
  resetSalt: () => void;
}

export const useAnonSaltStore = create<AnonSaltStore>()(
  persist(
    (set) => ({
      salt: generateAnonSalt(),
      setSalt: (salt) => set({ salt }),
      resetSalt: () => set({ salt: generateAnonSalt() }),
    }),
    { name: 'anon-salt-storage' }
  )
);

// ponytail: persist doesn't write the initial state until a `set` occurs, so a
// freshly generated salt would regenerate on every reload and break same-machine
// alias stability. Force one write of the rehydrated-or-generated salt at load.
// Guarded: localStorage can throw (blocked/quota) — the salt then stays in memory.
try {
  useAnonSaltStore.setState((s) => ({ salt: s.salt }));
} catch {
  // localStorage unavailable; per-session salt is fine.
}
