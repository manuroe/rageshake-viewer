import { describe, it, expect, vi, afterEach } from 'vitest';
import { useAnonSaltStore, generateAnonSalt } from '../anonSaltStore';

describe('anonSaltStore', () => {
  it('has a non-empty salt by default', () => {
    expect(useAnonSaltStore.getState().salt).not.toBe('');
  });

  it('setSalt sets the salt', () => {
    useAnonSaltStore.getState().setSalt('my-secret');
    expect(useAnonSaltStore.getState().salt).toBe('my-secret');
  });

  it('resetSalt replaces the salt with a different random value', () => {
    useAnonSaltStore.getState().setSalt('fixed');
    useAnonSaltStore.getState().resetSalt();
    const { salt } = useAnonSaltStore.getState();
    expect(salt).not.toBe('fixed');
    expect(salt).not.toBe('');
  });

  it('generateAnonSalt returns distinct values', () => {
    expect(generateAnonSalt()).not.toBe(generateAnonSalt());
  });

  describe('generateAnonSalt fallbacks', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('falls back to getRandomValues when randomUUID throws (insecure context)', () => {
      vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
        throw new Error('randomUUID unavailable');
      });
      const salt = generateAnonSalt();
      expect(salt).not.toBe('');
      expect(generateAnonSalt()).not.toBe(salt);
    });

    it('falls back to Math.random when both crypto sources throw', () => {
      vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
        throw new Error('no randomUUID');
      });
      vi.spyOn(crypto, 'getRandomValues').mockImplementation(() => {
        throw new Error('no getRandomValues');
      });
      const salt = generateAnonSalt();
      expect(salt).toMatch(/^salt-/);
    });
  });
});
