import { describe, it, expect } from 'vitest';
import { stripMatrixClientPath } from '../uriUtils';

describe('uriUtils', () => {
  describe('stripMatrixClientPath', () => {
    it('strips v3 Matrix client path', () => {
      expect(stripMatrixClientPath('https://matrix-client.matrix.org/_matrix/client/v3/keys/query'))
        .toBe('/keys/query');
    });

    it('strips unstable Matrix client path with MSC namespace', () => {
      expect(stripMatrixClientPath('https://matrix-client.matrix.org/_matrix/client/unstable/org.matrix.simplified_msc3575/sync'))
        .toBe('/org.matrix.simplified_msc3575/sync');
    });

    it('strips r0 Matrix client path', () => {
      expect(stripMatrixClientPath('https://matrix.example.com/_matrix/client/r0/sync'))
        .toBe('/sync');
    });

    it('strips stable Matrix client path', () => {
      expect(stripMatrixClientPath('https://matrix.example.com/_matrix/client/stable/login'))
        .toBe('/login');
    });

    it('preserves query string', () => {
      expect(stripMatrixClientPath('https://matrix-client.matrix.org/_matrix/client/v3/sync?timeout=30000&since=s123'))
        .toBe('/sync?timeout=30000&since=s123');
    });

    it('handles deeply nested endpoint paths', () => {
      expect(stripMatrixClientPath('https://matrix.example.com/_matrix/client/v3/rooms/!roomId/messages'))
        .toBe('/rooms/!roomId/messages');
    });

    it('falls back to relative path for non-Matrix URL', () => {
      expect(stripMatrixClientPath('https://example.com/some/path'))
        .toBe('/some/path');
    });

    it('falls back to relative path for non-Matrix URL with query string', () => {
      expect(stripMatrixClientPath('https://example.com/api/endpoint?foo=bar'))
        .toBe('/api/endpoint?foo=bar');
    });

    it('falls back to root for URL without path', () => {
      expect(stripMatrixClientPath('https://example.com'))
        .toBe('/');
    });

    it('returns non-URL string as-is', () => {
      expect(stripMatrixClientPath('not-a-url')).toBe('not-a-url');
    });

    it('handles Matrix URL with different homeserver hosts', () => {
      expect(stripMatrixClientPath('https://homeserver.company.com/_matrix/client/v3/profile/user'))
        .toBe('/profile/user');
    });
  });
});
