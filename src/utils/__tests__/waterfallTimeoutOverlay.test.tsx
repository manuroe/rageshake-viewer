import { describe, expect, it } from 'vitest';
import { isValidElement } from 'react';
import { renderTimeoutExceededOverlay } from '../waterfallTimeoutOverlay';
import type { HttpRequest } from '../../types/log.types';

function createRequest(overrides: Partial<HttpRequest> = {}): HttpRequest {
  return {
    requestId: 'req-1',
    method: 'GET',
    uri: '/_matrix/client/v3/sync',
    status: '200',
    requestSizeString: '1KB',
    responseSizeString: '2KB',
    requestSize: 1024,
    responseSize: 2048,
    requestDurationMs: 0,
    sendLineNumber: 1,
    responseLineNumber: 2,
    ...overrides,
  };
}

describe('renderTimeoutExceededOverlay', () => {
  it('returns null when timeout is missing', () => {
    const req = createRequest({ requestDurationMs: 35_000 });

    const result = renderTimeoutExceededOverlay(
      req,
      350,
      100,
      (d) => Math.max(1, d / 100),
      () => undefined,
    );

    expect(result).toBeNull();
  });

  it('returns null when request duration does not exceed timeout', () => {
    const req = createRequest({ requestDurationMs: 30_000 });

    const result = renderTimeoutExceededOverlay(
      req,
      300,
      100,
      (d) => Math.max(1, d / 100),
      () => 30_000,
    );

    expect(result).toBeNull();
  });

  it('renders overflow segment only after timeout boundary', () => {
    const req = createRequest({ requestDurationMs: 50_000 });

    const result = renderTimeoutExceededOverlay(
      req,
      500,
      100,
      (d) => Math.max(1, d / 100),
      () => 30_000,
    );

    expect(isValidElement(result)).toBe(true);
    if (!isValidElement<{ style: Record<string, string> }>(result)) {
      return;
    }

    expect(result.props.style.left).toBe('300px');
    expect(result.props.style.width).toBe('200px');
    expect(result.props.style.background).toBe('var(--waterfall-timeout-exceeded)');
  });

  it('returns null for timeout=0 (catchup requests always use their status color)', () => {
    const req = createRequest({ requestDurationMs: 15_000 });

    const result = renderTimeoutExceededOverlay(
      req,
      150,
      100,
      (d) => Math.max(1, d / 100),
      () => 0,
    );

    expect(result).toBeNull();
  });
});
