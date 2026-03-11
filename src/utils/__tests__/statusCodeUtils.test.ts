import { describe, it, expect } from 'vitest';
import { extractAvailableStatusCodes, INCOMPLETE_STATUS_KEY, CLIENT_ERROR_STATUS_KEY } from '../statusCodeUtils';

describe('INCOMPLETE_STATUS_KEY', () => {
  it('is the string Incomplete', () => {
    expect(INCOMPLETE_STATUS_KEY).toBe('Incomplete');
  });
});

describe('CLIENT_ERROR_STATUS_KEY', () => {
  it('is the string Client Error', () => {
    expect(CLIENT_ERROR_STATUS_KEY).toBe('Client Error');
  });
});

describe('extractAvailableStatusCodes', () => {
  it('returns empty array for empty input', () => {
    expect(extractAvailableStatusCodes([])).toEqual([]);
  });

  it('extracts unique status codes in sorted numeric order', () => {
    const requests = [
      { status: '500' },
      { status: '200' },
      { status: '404' },
      { status: '200' },
    ];
    expect(extractAvailableStatusCodes(requests)).toEqual(['200', '404', '500']);
  });

  it('appends Incomplete at the end when some requests have no status', () => {
    const requests = [
      { status: '200' },
      {},
      { status: '404' },
    ];
    const result = extractAvailableStatusCodes(requests);
    expect(result).toEqual(['200', '404', INCOMPLETE_STATUS_KEY]);
  });

  it('returns only Incomplete when all requests have no status', () => {
    const requests = [{}, {}, {}];
    expect(extractAvailableStatusCodes(requests)).toEqual([INCOMPLETE_STATUS_KEY]);
  });

  it('handles requests with undefined status', () => {
    const requests = [{ status: undefined }, { status: '200' }];
    const result = extractAvailableStatusCodes(requests);
    expect(result).toContain('200');
    expect(result).toContain(INCOMPLETE_STATUS_KEY);
  });

  it('sorts non-numeric status codes lexicographically after numeric ones', () => {
    const requests = [
      { status: '200' },
      { status: 'custom' },
      { status: '404' },
      { status: 'other' },
    ];
    const result = extractAvailableStatusCodes(requests);
    // Numeric before non-numeric
    expect(result.indexOf('200')).toBeLessThan(result.indexOf('custom'));
    expect(result.indexOf('404')).toBeLessThan(result.indexOf('custom'));
  });

  it('returns single code when only one unique status', () => {
    const requests = [{ status: '200' }, { status: '200' }, { status: '200' }];
    expect(extractAvailableStatusCodes(requests)).toEqual(['200']);
  });

  it('handles a mix of many status codes', () => {
    const requests = [
      { status: '200' },
      { status: '201' },
      { status: '500' },
      { status: '404' },
      { status: '301' },
      {},
    ];
    const result = extractAvailableStatusCodes(requests);
    expect(result[result.length - 1]).toBe(INCOMPLETE_STATUS_KEY);
    // Numeric codes should be sorted
    const numericPart = result.slice(0, -1).map(Number);
    for (let i = 1; i < numericPart.length; i++) {
      expect(numericPart[i]).toBeGreaterThan(numericPart[i - 1]);
    }
  });

  it('includes Client Error key when some requests have clientError set', () => {
    const requests = [
      { status: '200' },
      { status: '', clientError: 'TimedOut' },
      { status: '', clientError: 'ConnectError' },
    ];
    const result = extractAvailableStatusCodes(requests);
    expect(result).toContain(CLIENT_ERROR_STATUS_KEY);
    expect(result).not.toContain(INCOMPLETE_STATUS_KEY);
    expect(result.indexOf('200')).toBeLessThan(result.indexOf(CLIENT_ERROR_STATUS_KEY));
  });

  it('places Client Error before Incomplete when both exist', () => {
    const requests = [
      { status: '200' },
      { status: '', clientError: 'TimedOut' },
      { status: '' },
    ];
    const result = extractAvailableStatusCodes(requests);
    expect(result).toContain(CLIENT_ERROR_STATUS_KEY);
    expect(result).toContain(INCOMPLETE_STATUS_KEY);
    expect(result.indexOf(CLIENT_ERROR_STATUS_KEY)).toBeLessThan(result.indexOf(INCOMPLETE_STATUS_KEY));
  });
});
