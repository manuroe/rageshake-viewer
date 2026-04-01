import { describe, it, expect } from 'vitest';
import {
  SYNC_CATCHUP_KEY,
  SYNC_LONGPOLL_KEY,
  CLIENT_ERROR_KEY,
  getBucketKey,
  getBucketColor,
  getBucketLabel,
  sortStatusCodes,
} from '../httpStatusBuckets';

describe('getBucketKey', () => {
  it('returns "incomplete" for empty status', () => {
    expect(getBucketKey({ status: '' })).toBe('incomplete');
  });

  it('returns the numeric status code for plain 2xx without timeout', () => {
    expect(getBucketKey({ status: '200' })).toBe('200');
  });

  it('returns SYNC_CATCHUP_KEY for status 200 with timeout=0', () => {
    expect(getBucketKey({ status: '200', timeout: 0 })).toBe(SYNC_CATCHUP_KEY);
  });

  it('returns SYNC_LONGPOLL_KEY for status 200 with timeout=30000', () => {
    expect(getBucketKey({ status: '200', timeout: 30_000 })).toBe(SYNC_LONGPOLL_KEY);
  });

  it('returns SYNC_LONGPOLL_KEY for status 200 with timeout>30000', () => {
    expect(getBucketKey({ status: '200', timeout: 60_000 })).toBe(SYNC_LONGPOLL_KEY);
  });

  it('does NOT apply sync classification to 4xx codes', () => {
    expect(getBucketKey({ status: '408', timeout: 0 })).toBe('408');
  });

  it('returns CLIENT_ERROR_KEY when status is already "client-error"', () => {
    expect(getBucketKey({ status: CLIENT_ERROR_KEY })).toBe(CLIENT_ERROR_KEY);
  });

  it('strips trailing reason phrase from status', () => {
    // e.g. status string like "404 Not Found" → bucket key "404"
    expect(getBucketKey({ status: '404 Not Found' })).toBe('404');
  });
});

describe('getBucketColor', () => {
  it('returns sync-catchup CSS var', () => {
    expect(getBucketColor(SYNC_CATCHUP_KEY)).toBe('var(--sync-catchup-success)');
  });

  it('returns sync-longpoll CSS var', () => {
    expect(getBucketColor(SYNC_LONGPOLL_KEY)).toBe('var(--sync-longpoll-success)');
  });

  it('returns client-error CSS var', () => {
    expect(getBucketColor(CLIENT_ERROR_KEY)).toBe('var(--http-client-error)');
  });

  it('delegates numeric codes to getHttpStatusColor', () => {
    // Known HTTP 200 color
    expect(getBucketColor('200')).toBe('var(--http-200)');
    expect(getBucketColor('500')).toBe('var(--http-500)');
  });
});

describe('getBucketLabel', () => {
  it('returns human label for sync-catchup', () => {
    expect(getBucketLabel(SYNC_CATCHUP_KEY)).toBe('sync catchup');
  });

  it('returns human label for sync-longpoll', () => {
    expect(getBucketLabel(SYNC_LONGPOLL_KEY)).toBe('sync long-poll');
  });

  it('returns human label for client-error', () => {
    expect(getBucketLabel(CLIENT_ERROR_KEY)).toBe('Client Error');
  });

  it('returns the code itself for numeric status keys', () => {
    expect(getBucketLabel('404')).toBe('404');
    expect(getBucketLabel('incomplete')).toBe('incomplete');
  });
});

describe('sortStatusCodes', () => {
  it('places sync-catchup at the bottom (index 0)', () => {
    const result = sortStatusCodes(['200', SYNC_CATCHUP_KEY, '500']);
    expect(result[0]).toBe(SYNC_CATCHUP_KEY);
  });

  it('places sync-longpoll above sync-catchup', () => {
    const result = sortStatusCodes([SYNC_LONGPOLL_KEY, SYNC_CATCHUP_KEY]);
    expect(result).toEqual([SYNC_CATCHUP_KEY, SYNC_LONGPOLL_KEY]);
  });

  it('places 5xx above sync but below client-error', () => {
    const result = sortStatusCodes([CLIENT_ERROR_KEY, '500', SYNC_CATCHUP_KEY]);
    expect(result).toEqual([SYNC_CATCHUP_KEY, '500', CLIENT_ERROR_KEY]);
  });

  it('places 4xx above client-error', () => {
    const result = sortStatusCodes(['404', CLIENT_ERROR_KEY]);
    expect(result).toEqual([CLIENT_ERROR_KEY, '404']);
  });

  it('places 2xx above 4xx', () => {
    const result = sortStatusCodes(['404', '200']);
    expect(result).toEqual(['404', '200']);
  });

  it('places "incomplete" at the top', () => {
    const result = sortStatusCodes(['200', 'incomplete', '500']);
    expect(result[result.length - 1]).toBe('incomplete');
  });

  it('does not mutate the input array', () => {
    const codes = ['500', '200'];
    sortStatusCodes(codes);
    expect(codes).toEqual(['500', '200']);
  });

  it('produces a stable full ordering', () => {
    const input = ['incomplete', '200', '404', '500', CLIENT_ERROR_KEY, SYNC_LONGPOLL_KEY, SYNC_CATCHUP_KEY];
    const result = sortStatusCodes(input);
    expect(result).toEqual([SYNC_CATCHUP_KEY, SYNC_LONGPOLL_KEY, '500', CLIENT_ERROR_KEY, '404', '200', 'incomplete']);
  });
});
