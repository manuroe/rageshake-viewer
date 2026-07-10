import { describe, it, expect } from 'vitest';
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
});
