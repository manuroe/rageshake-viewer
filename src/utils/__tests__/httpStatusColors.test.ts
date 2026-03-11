import { describe, it, expect } from 'vitest';
import {
  getHttpStatusColorVar,
  getHttpStatusColor,
  getHttpStatusCategory,
  getStatusCodeLegend,
  getHttpStatusBadgeClass,
} from '../httpStatusColors';

describe('getHttpStatusColorVar', () => {
  it('returns specific CSS variable for known codes', () => {
    expect(getHttpStatusColorVar(200)).toBe('--http-200');
    expect(getHttpStatusColorVar(404)).toBe('--http-404');
    expect(getHttpStatusColorVar(500)).toBe('--http-500');
  });

  it('accepts string input', () => {
    expect(getHttpStatusColorVar('200')).toBe('--http-200');
    expect(getHttpStatusColorVar('404')).toBe('--http-404');
  });

  it('falls back to category for unknown 2xx codes', () => {
    expect(getHttpStatusColorVar(299)).toBe('--http-2xx');
    expect(getHttpStatusColorVar(210)).toBe('--http-2xx');
  });

  it('falls back to category for unknown 3xx codes', () => {
    expect(getHttpStatusColorVar(399)).toBe('--http-3xx');
    expect(getHttpStatusColorVar(305)).toBe('--http-3xx');
  });

  it('falls back to category for unknown 4xx codes', () => {
    expect(getHttpStatusColorVar(499)).toBe('--http-4xx');
    expect(getHttpStatusColorVar(420)).toBe('--http-4xx');
  });

  it('falls back to category for unknown 5xx codes', () => {
    expect(getHttpStatusColorVar(599)).toBe('--http-5xx');
    expect(getHttpStatusColorVar(505)).toBe('--http-5xx');
  });

  it('returns incomplete for NaN', () => {
    expect(getHttpStatusColorVar('abc')).toBe('--http-incomplete');
    expect(getHttpStatusColorVar(NaN)).toBe('--http-incomplete');
  });

  it('returns incomplete for sub-200 codes', () => {
    expect(getHttpStatusColorVar(100)).toBe('--http-incomplete');
    expect(getHttpStatusColorVar(0)).toBe('--http-incomplete');
  });

  it('handles all known codes', () => {
    const knownCodes = [200, 201, 202, 204, 301, 302, 304, 307, 308, 400, 401, 403, 404, 405, 408, 409, 410, 422, 429, 500, 501, 502, 503, 504];
    for (const code of knownCodes) {
      expect(getHttpStatusColorVar(code)).toBe(`--http-${code}`);
    }
  });
});

describe('getHttpStatusColor', () => {
  it('returns CSS variable reference in browser environment', () => {
    const color = getHttpStatusColor(200);
    expect(color).toBe('var(--http-200)');
  });

  it('returns CSS variable reference for unknown codes in browser', () => {
    expect(getHttpStatusColor(299)).toBe('var(--http-2xx)');
  });

  it('returns CSS variable for string input', () => {
    expect(getHttpStatusColor('404')).toBe('var(--http-404)');
  });

  it('returns CSS variable for NaN input', () => {
    expect(getHttpStatusColor('notACode')).toBe('var(--http-incomplete)');
  });
});

describe('getHttpStatusCategory', () => {
  it('returns success for 2xx codes', () => {
    expect(getHttpStatusCategory(200)).toBe('success');
    expect(getHttpStatusCategory(201)).toBe('success');
    expect(getHttpStatusCategory(299)).toBe('success');
  });

  it('returns redirect for 3xx codes', () => {
    expect(getHttpStatusCategory(301)).toBe('redirect');
    expect(getHttpStatusCategory(302)).toBe('redirect');
    expect(getHttpStatusCategory(399)).toBe('redirect');
  });

  it('returns clientError for 4xx codes', () => {
    expect(getHttpStatusCategory(400)).toBe('clientError');
    expect(getHttpStatusCategory(404)).toBe('clientError');
    expect(getHttpStatusCategory(499)).toBe('clientError');
  });

  it('returns serverError for 5xx codes', () => {
    expect(getHttpStatusCategory(500)).toBe('serverError');
    expect(getHttpStatusCategory(503)).toBe('serverError');
    expect(getHttpStatusCategory(599)).toBe('serverError');
  });

  it('returns incomplete for non-numeric input', () => {
    expect(getHttpStatusCategory('abc')).toBe('incomplete');
    expect(getHttpStatusCategory(NaN)).toBe('incomplete');
  });

  it('returns incomplete for sub-200 codes', () => {
    expect(getHttpStatusCategory(100)).toBe('incomplete');
    expect(getHttpStatusCategory(0)).toBe('incomplete');
  });

  it('accepts string input', () => {
    expect(getHttpStatusCategory('200')).toBe('success');
    expect(getHttpStatusCategory('500')).toBe('serverError');
  });
});

describe('getStatusCodeLegend', () => {
  it('returns unique sorted codes with colors', () => {
    const legend = getStatusCodeLegend(['200', '404', '200', '500']);
    expect(legend).toHaveLength(3);
    expect(legend[0].code).toBe('200');
    expect(legend[1].code).toBe('404');
    expect(legend[2].code).toBe('500');
    expect(legend[0].color).toBeTruthy();
  });

  it('returns empty array for empty input', () => {
    expect(getStatusCodeLegend([])).toEqual([]);
  });

  it('puts non-numeric codes after numeric codes', () => {
    const legend = getStatusCodeLegend(['200', 'incomplete', '404']);
    const codes = legend.map(l => l.code);
    expect(codes.indexOf('200')).toBeLessThan(codes.indexOf('incomplete'));
    expect(codes.indexOf('404')).toBeLessThan(codes.indexOf('incomplete'));
  });

  it('sorts numeric codes in ascending order', () => {
    const legend = getStatusCodeLegend(['500', '200', '404', '301']);
    const codes = legend.map(l => l.code);
    expect(codes).toEqual(['200', '301', '404', '500']);
  });

  it('handles non-numeric codes only', () => {
    const legend = getStatusCodeLegend(['incomplete', 'pending']);
    expect(legend).toHaveLength(2);
  });
});

describe('getHttpStatusBadgeClass', () => {
  it('returns specific class for known codes', () => {
    expect(getHttpStatusBadgeClass(200)).toBe('Http200');
    expect(getHttpStatusBadgeClass(404)).toBe('Http404');
    expect(getHttpStatusBadgeClass(500)).toBe('Http500');
  });

  it('accepts string input', () => {
    expect(getHttpStatusBadgeClass('200')).toBe('Http200');
    expect(getHttpStatusBadgeClass('404')).toBe('Http404');
  });

  it('falls back to category for unknown 2xx codes', () => {
    expect(getHttpStatusBadgeClass(210)).toBe('Http2xx');
  });

  it('falls back to category for unknown 3xx codes', () => {
    expect(getHttpStatusBadgeClass(309)).toBe('Http3xx');
  });

  it('falls back to category for unknown 4xx codes', () => {
    expect(getHttpStatusBadgeClass(420)).toBe('Http4xx');
  });

  it('falls back to category for unknown 5xx codes', () => {
    expect(getHttpStatusBadgeClass(505)).toBe('Http5xx');
  });

  it('returns Incomplete for NaN', () => {
    expect(getHttpStatusBadgeClass('abc')).toBe('Incomplete');
    expect(getHttpStatusBadgeClass(NaN)).toBe('Incomplete');
  });

  it('returns Incomplete for sub-200 codes', () => {
    expect(getHttpStatusBadgeClass(100)).toBe('Incomplete');
    expect(getHttpStatusBadgeClass(0)).toBe('Incomplete');
  });

  it('returns ClientError for Client Error status', () => {
    expect(getHttpStatusBadgeClass('Client Error')).toBe('ClientError');
  });
});
