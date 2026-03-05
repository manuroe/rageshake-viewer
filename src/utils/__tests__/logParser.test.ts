/**
 * Unit tests for logParser.ts
 * Tests parsing correctness, edge cases, and error handling.
 */
import { describe, it, expect } from 'vitest';
import { parseAllHttpRequests, parseLogFile } from '../logParser';
import { ParsingError } from '../errorHandling';

// Sample log line formats from real Matrix Rust SDK logs
const SEND_LINE = '2026-01-26T17:02:25.042916Z DEBUG matrix_sdk::http_client::native: Sending request num_attempt=1 | crates/matrix-sdk/src/http_client/native.rs:78 | spans: root > sync_once{conn_id="room-list"} > send{request_id="REQ-62" method=POST uri="https://matrix-client.matrix.org/_matrix/client/unstable/org.matrix.simplified_msc3575/sync" request_size="5.9k"}';
const SEND_LINE_WITH_TIMEOUT = SEND_LINE.replace('sync_once{conn_id="room-list"}', 'sync_once{conn_id="room-list" timeout=0}');
const SEND_LINE_WITH_URI_TIMEOUT = SEND_LINE.replace(
  'org.matrix.simplified_msc3575/sync"',
  'org.matrix.simplified_msc3575/sync?timeout=30000"'
);

const RESPONSE_LINE = '2026-01-26T17:02:25.416416Z DEBUG matrix_sdk::http_client: Got response | crates/matrix-sdk/src/http_client/mod.rs:210 | spans: root > next_sync_with_lock{store_generation=55} > sync_once{conn_id="encryption"} > send{request_id="REQ-63" method=POST uri="https://matrix-client.matrix.org/_matrix/client/unstable/org.matrix.simplified_msc3575/sync" request_size="113B" status=200 response_size="7.4k" request_duration=359.998542ms}';

const INFO_LINE = '2026-01-26T17:02:25.038968Z  INFO elementx: Received sync service update: running | ClientProxy.swift:1055 | spans: root';

describe('logParser', () => {
  describe('parseAllHttpRequests', () => {
    describe('basic parsing', () => {
      it('parses a complete request-response pair', () => {
        const logContent = `${SEND_LINE}\n${RESPONSE_LINE.replace('REQ-63', 'REQ-62')}`;
        const result = parseAllHttpRequests(logContent);

        expect(result.httpRequests).toHaveLength(1);
        expect(result.httpRequests[0]).toMatchObject({
          requestId: 'REQ-62',
          method: 'POST',
          uri: expect.stringContaining('/sync'),
          status: '200',
          requestSizeString: '5.9k',
          responseSizeString: '7.4k',
          requestSize: Math.round(5.9 * 1024),  // 6042
          responseSize: Math.round(7.4 * 1024), // 7578
          sendLineNumber: 1,
          responseLineNumber: 2,
        });
        expect(result.httpRequests[0].requestDurationMs).toBe(360); // 359.998542ms rounded
      });

      it('parses send-only requests (incomplete)', () => {
        const result = parseAllHttpRequests(SEND_LINE);

        expect(result.httpRequests).toHaveLength(1);
        expect(result.httpRequests[0]).toMatchObject({
          requestId: 'REQ-62',
          method: 'POST',
          uri: expect.stringContaining('/sync'),
          status: '',
          sendLineNumber: 1,
          responseLineNumber: 0,
        });
      });

      it('parses response-only entries (late join)', () => {
        const result = parseAllHttpRequests(RESPONSE_LINE);

        expect(result.httpRequests).toHaveLength(1);
        expect(result.httpRequests[0]).toMatchObject({
          requestId: 'REQ-63',
          status: '200',
          sendLineNumber: 0,
          responseLineNumber: 1,
        });
      });

      it('matches send and response by request_id', () => {
        // Send first, then response
        const content = [
          SEND_LINE.replace('REQ-62', 'REQ-100'),
          INFO_LINE, // Non-HTTP line in between
          RESPONSE_LINE.replace('REQ-63', 'REQ-100'),
        ].join('\n');

        const result = parseAllHttpRequests(content);

        expect(result.httpRequests).toHaveLength(1);
        expect(result.httpRequests[0].sendLineNumber).toBe(1);
        expect(result.httpRequests[0].responseLineNumber).toBe(3);
      });
    });

    describe('rawLogLines parsing', () => {
      it('parses all non-empty lines into rawLogLines', () => {
        const content = `${INFO_LINE}\n\n${SEND_LINE}`;
        const result = parseAllHttpRequests(content);

        expect(result.rawLogLines).toHaveLength(2);
        expect(result.rawLogLines[0].lineNumber).toBe(1);
        expect(result.rawLogLines[1].lineNumber).toBe(3);
      });

      it('extracts ISO timestamps correctly', () => {
        const result = parseAllHttpRequests(INFO_LINE);

        expect(result.rawLogLines).toHaveLength(1);
        expect(result.rawLogLines[0].isoTimestamp).toBe('2026-01-26T17:02:25.038968Z');
      });

      it('extracts log level correctly', () => {
        const logLines = [
          '2026-01-01T00:00:00.000000Z TRACE message',
          '2026-01-01T00:00:00.000000Z DEBUG message',
          '2026-01-01T00:00:00.000000Z  INFO message',
          '2026-01-01T00:00:00.000000Z  WARN message',
          '2026-01-01T00:00:00.000000Z ERROR message',
        ].join('\n');

        const result = parseAllHttpRequests(logLines);

        expect(result.rawLogLines[0].level).toBe('TRACE');
        expect(result.rawLogLines[1].level).toBe('DEBUG');
        expect(result.rawLogLines[2].level).toBe('INFO');
        expect(result.rawLogLines[3].level).toBe('WARN');
        expect(result.rawLogLines[4].level).toBe('ERROR');
      });

      it('returns UNKNOWN for unrecognized log levels', () => {
        const result = parseAllHttpRequests('2026-01-01T00:00:00.000000Z CUSTOM message');

        expect(result.rawLogLines[0].level).toBe('UNKNOWN');
      });

      it('calculates timestampUs in microseconds', () => {
        const result = parseAllHttpRequests(INFO_LINE);

        expect(result.rawLogLines[0].timestampUs).toBeGreaterThan(0);
        // 2026-01-26T17:02:25.038968Z should be in the ballpark of ~1769 trillion microseconds
        expect(result.rawLogLines[0].timestampUs).toBeGreaterThan(1_700_000_000_000_000);
      });

      it('extracts displayTime (time-only portion)', () => {
        const result = parseAllHttpRequests(INFO_LINE);

        expect(result.rawLogLines[0].displayTime).toBe('17:02:25.038968');
      });

      it('strips message prefix correctly', () => {
        const result = parseAllHttpRequests(INFO_LINE);

        // Should have the timestamp and INFO stripped
        expect(result.rawLogLines[0].strippedMessage).not.toMatch(/^2026-01-26T/);
        expect(result.rawLogLines[0].strippedMessage).toContain('elementx');
      });
    });

    describe('duration parsing', () => {
      it('parses millisecond durations', () => {
        const line = RESPONSE_LINE.replace('359.998542ms', '100.5ms');
        const result = parseAllHttpRequests(line);

        expect(result.httpRequests[0].requestDurationMs).toBe(101); // Rounded
      });

      it('parses second durations', () => {
        const line = RESPONSE_LINE.replace('359.998542ms', '2.5s');
        const result = parseAllHttpRequests(line);

        expect(result.httpRequests[0].requestDurationMs).toBe(2500);
      });

      it('handles sub-millisecond durations', () => {
        const line = RESPONSE_LINE.replace('359.998542ms', '0.5ms');
        const result = parseAllHttpRequests(line);

        expect(result.httpRequests[0].requestDurationMs).toBe(1); // Rounded up
      });
    });

    describe('multiple requests', () => {
      it('parses multiple concurrent requests', () => {
        const content = [
          SEND_LINE.replace('REQ-62', 'REQ-1'),
          SEND_LINE.replace('REQ-62', 'REQ-2'),
          RESPONSE_LINE.replace('REQ-63', 'REQ-1'),
          RESPONSE_LINE.replace('REQ-63', 'REQ-2'),
        ].join('\n');

        const result = parseAllHttpRequests(content);

        expect(result.httpRequests).toHaveLength(2);
        expect(result.httpRequests.map(r => r.requestId).sort()).toEqual(['REQ-1', 'REQ-2']);
      });

      it('sorts requests by sendLineNumber, not by Map insertion order', () => {
        // REQ-B response appears first (line 1) → inserted into Map first.
        // REQ-A and REQ-C sends follow (lines 2-3).
        // REQ-B send appears last (line 4), so its sendLineNumber is the highest.
        //
        // Map insertion order:         B, A, C
        // Expected after sort by sendLineNumber: A(2), C(3), B(4)
        //
        // If the sort were absent the result would be [B, A, C], not [A, C, B].
        const content = [
          RESPONSE_LINE.replace('REQ-63', 'REQ-B'),  // line 1 — response only for B
          SEND_LINE.replace('REQ-62', 'REQ-A'),      // line 2 — send for A
          SEND_LINE.replace('REQ-62', 'REQ-C'),      // line 3 — send for C
          SEND_LINE.replace('REQ-62', 'REQ-B'),      // line 4 — send for B (late)
        ].join('\n');

        const result = parseAllHttpRequests(content);

        expect(result.httpRequests).toHaveLength(3);
        expect(result.httpRequests[0].requestId).toBe('REQ-A'); // sendLineNumber=2
        expect(result.httpRequests[1].requestId).toBe('REQ-C'); // sendLineNumber=3
        expect(result.httpRequests[2].requestId).toBe('REQ-B'); // sendLineNumber=4
      });
    });

    describe('regression: response before send (late-arriving send)', () => {
      it('correctly pairs response-first with its subsequent send line', () => {
        // In real logs the response occasionally appears before the send
        // (e.g. when log buffering flushes out of order). The parser must
        // handle this: the request should have both sendLineNumber and responseLineNumber.
        const responseFirst = RESPONSE_LINE.replace('REQ-63', 'REQ-X');
        const sendLater = SEND_LINE.replace('REQ-62', 'REQ-X');
        const content = [responseFirst, sendLater].join('\n');

        const result = parseAllHttpRequests(content);

        expect(result.httpRequests).toHaveLength(1);
        expect(result.httpRequests[0].requestId).toBe('REQ-X');
        // Response at line 1, send at line 2
        expect(result.httpRequests[0].responseLineNumber).toBe(1);
        expect(result.httpRequests[0].sendLineNumber).toBe(2);
        // Status and method are populated from the first seen line (response)
        expect(result.httpRequests[0].status).toBe('200');
        expect(result.httpRequests[0].method).toBe('POST');
      });

      it('does not duplicate the request when paired in reverse order', () => {
        const responseFirst = RESPONSE_LINE.replace('REQ-63', 'REQ-Y');
        const sendLater = SEND_LINE.replace('REQ-62', 'REQ-Y');
        const content = [responseFirst, sendLater].join('\n');

        const result = parseAllHttpRequests(content);

        expect(result.httpRequests).toHaveLength(1);
      });
    });

    describe('regression: duplicate request_id', () => {
      it('creates a separate record for each request when the same request_id is sent twice', () => {
        // When the client reuses the same request_id for two distinct requests,
        // both should appear as independent records in the parsed output.
        const send1 = SEND_LINE.replace('REQ-62', 'DUPE');
        const send2 = SEND_LINE.replace('REQ-62', 'DUPE');
        const content = [send1, send2].join('\n');

        const result = parseAllHttpRequests(content);

        // Both records should appear
        expect(result.httpRequests).toHaveLength(2);
        // Chronological order: first send at line 1, second at line 2
        expect(result.httpRequests[0].sendLineNumber).toBe(1);
        expect(result.httpRequests[1].sendLineNumber).toBe(2);
      });
    });

    describe('error handling', () => {
      it('throws ParsingError for empty input', () => {
        expect(() => parseAllHttpRequests('')).toThrow(ParsingError);
        expect(() => parseAllHttpRequests('   ')).toThrow(ParsingError);
      });

      it('throws ParsingError for file with no timestamps', () => {
        const noTimestamps = Array(150).fill('some random text without timestamps').join('\n');
        
        expect(() => parseAllHttpRequests(noTimestamps)).toThrow(ParsingError);
      });

      it('accepts file with mostly valid timestamps', () => {
        const lines = [
          ...Array(50).fill('no timestamp line'),
          ...Array(100).fill('2026-01-01T00:00:00.000000Z INFO valid line'),
        ];
        
        // Should not throw because >10% have timestamps
        const result = parseAllHttpRequests(lines.join('\n'));
        expect(result.rawLogLines.length).toBeGreaterThan(0);
      });
    });

    describe('edge cases', () => {
      it('handles lines without send{ pattern efficiently', () => {
        const content = Array(1000).fill(INFO_LINE).join('\n');
        const result = parseAllHttpRequests(content);

        expect(result.httpRequests).toHaveLength(0);
        expect(result.rawLogLines).toHaveLength(1000);
      });

      it('handles malformed request lines gracefully', () => {
        const malformed = '2026-01-01T00:00:00.000000Z DEBUG send{request_id="REQ-1" method=';
        
        const result = parseAllHttpRequests(`${INFO_LINE}\n${malformed}`);
        expect(result.httpRequests).toHaveLength(0); // Malformed should not match
      });

      it('handles special characters in URI', () => {
        const lineWithParams = SEND_LINE.replace(
          'uri="https://matrix-client.matrix.org/_matrix/client/unstable/org.matrix.simplified_msc3575/sync"',
          'uri="https://example.com/path?foo=bar&baz=qux%20encoded"'
        );
        
        const result = parseAllHttpRequests(lineWithParams);
        expect(result.httpRequests[0].uri).toContain('foo=bar');
      });
    });
  });

  describe('parseLogFile', () => {
    it('extracts sync requests with connId', () => {
      // Both lines must have the same conn_id for consistent extraction
      const sendLine = SEND_LINE;
      const responseLine = RESPONSE_LINE.replace('REQ-63', 'REQ-62').replace('conn_id="encryption"', 'conn_id="room-list"');
      const content = [sendLine, responseLine].join('\n');

      const result = parseLogFile(content);

      expect(result.requests).toHaveLength(1);
      expect(result.requests[0].connId).toBe('room-list');
    });

    it('extracts unique connectionIds', () => {
      // Two different sync requests with different connIds
      const roomListSend = SEND_LINE.replace('REQ-62', 'REQ-1');
      const roomListResponse = RESPONSE_LINE.replace('REQ-63', 'REQ-1').replace('conn_id="encryption"', 'conn_id="room-list"');
      const encryptionSend = SEND_LINE.replace('REQ-62', 'REQ-2').replace('conn_id="room-list"', 'conn_id="encryption"');
      const encryptionResponse = RESPONSE_LINE.replace('REQ-63', 'REQ-2');
      
      const content = [roomListSend, roomListResponse, encryptionSend, encryptionResponse].join('\n');

      const result = parseLogFile(content);

      expect(result.connectionIds).toContain('room-list');
      expect(result.connectionIds).toContain('encryption');
    });

    it('filters to only sync URIs', () => {
      const nonSyncLine = SEND_LINE.replace('/sync', '/rooms/123/messages');
      const content = [
        SEND_LINE,
        nonSyncLine.replace('REQ-62', 'REQ-99'),
      ].join('\n');

      const result = parseLogFile(content);

      // Only the sync request should be in requests
      expect(result.requests).toHaveLength(1);
      expect(result.requests[0].uri).toContain('/sync');
    });

    it('passes through rawLogLines from parseAllHttpRequests', () => {
      const content = [INFO_LINE, SEND_LINE].join('\n');
      const result = parseLogFile(content);

      expect(result.rawLogLines).toHaveLength(2);
    });

    it('extracts sync timeout when present', () => {
      const responseLine = RESPONSE_LINE.replace('REQ-63', 'REQ-62').replace('conn_id="encryption"', 'conn_id="room-list"');
      const content = [SEND_LINE_WITH_TIMEOUT, responseLine].join('\n');

      const result = parseLogFile(content);

      expect(result.requests).toHaveLength(1);
      expect(result.requests[0].timeout).toBe(0);
    });

    it('extracts sync timeout from URI query param when not in span attributes', () => {
      const responseLine = RESPONSE_LINE.replace('REQ-63', 'REQ-62').replace('conn_id="encryption"', 'conn_id="room-list"');
      const content = [SEND_LINE_WITH_URI_TIMEOUT, responseLine].join('\n');

      const result = parseLogFile(content);

      expect(result.requests).toHaveLength(1);
      expect(result.requests[0].timeout).toBe(30000);
    });

    it('keeps sync timeout undefined when not present', () => {
      const responseLine = RESPONSE_LINE.replace('REQ-63', 'REQ-62').replace('conn_id="encryption"', 'conn_id="room-list"');
      const content = [SEND_LINE, responseLine].join('\n');

      const result = parseLogFile(content);

      expect(result.requests).toHaveLength(1);
      expect(result.requests[0].timeout).toBeUndefined();
    });
  });
});
