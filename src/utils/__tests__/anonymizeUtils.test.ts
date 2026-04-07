import { describe, it, expect } from 'vitest';
import {
  ANONYMIZED_LOG_MARKER,
  buildAnonymizationDictionary,
  applyAnonymization,
  applyUnanonymization,
  anonymizeLogLine,
  unanonymizeLogLine,
  detectAnonymizedLog,
  stripAnonymizedMarker,
} from '../anonymizeUtils';
import { createParsedLogLine } from '../../test/fixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal ParsedLogLine whose rawText contains the given message. */
function makeLine(lineNumber: number, message: string) {
  return createParsedLogLine({
    lineNumber,
    rawText: `2024-01-15T10:00:00.000000Z INFO ${message}`,
    message: `2024-01-15T10:00:00.000000Z INFO ${message}`,
    strippedMessage: message,
  });
}

// ---------------------------------------------------------------------------
// buildAnonymizationDictionary — identifier detection
// ---------------------------------------------------------------------------

describe('buildAnonymizationDictionary', () => {
  it('produces empty maps for logs with no Matrix identifiers', () => {
    const dict = buildAnonymizationDictionary([makeLine(0, 'hello world no ids here')]);
    expect(dict.forward).toEqual({});
    expect(dict.reverse).toEqual({});
  });

  it('replaces a user ID consistently with @userN:domainN.org', () => {
    const dict = buildAnonymizationDictionary([makeLine(0, '@alice:matrix.example.org joined')]);
    expect(dict.forward['@alice:matrix.example.org']).toBe('@user0:domain0.org');
    expect(dict.reverse['@user0:domain0.org']).toBe('@alice:matrix.example.org');
  });

  it('assigns the same alias when the same user ID appears multiple times', () => {
    const dict = buildAnonymizationDictionary([
      makeLine(0, '@alice:example.org sent a message'),
      makeLine(1, '@alice:example.org sent another message'),
    ]);
    const userAliases = Object.values(dict.forward).filter((v) => v.startsWith('@user'));
    expect(userAliases.length).toBe(1);
    expect(userAliases[0]).toBe('@user0:domain0.org');
  });

  it('assigns different aliases for different user IDs', () => {
    const dict = buildAnonymizationDictionary([
      makeLine(0, '@alice:example.org and @bob:example.org'),
    ]);
    expect(dict.forward['@alice:example.org']).toBe('@user0:domain0.org');
    expect(dict.forward['@bob:example.org']).toBe('@user1:domain0.org');
  });

  it('replaces a room alias with #room_alias_N:domainN.org', () => {
    const dict = buildAnonymizationDictionary([makeLine(0, '#general:example.org')]);
    expect(dict.forward['#general:example.org']).toBe('#room_alias_0:domain0.org');
    expect(dict.reverse['#room_alias_0:domain0.org']).toBe('#general:example.org');
  });

  it('replaces a room ID (with domain) with !roomN:domainN.org', () => {
    const dict = buildAnonymizationDictionary([makeLine(0, '!abc123:example.org')]);
    expect(dict.forward['!abc123:example.org']).toBe('!room0:domain0.org');
    expect(dict.reverse['!room0:domain0.org']).toBe('!abc123:example.org');
  });

  it('replaces a modern room ID (no domain, min 10 chars) with !roomN', () => {
    const dict = buildAnonymizationDictionary([makeLine(0, '!VkdmKnrz9stD0mzv2QrS3sP joined')]);
    expect(dict.forward['!VkdmKnrz9stD0mzv2QrS3sP']).toBe('!room0');
    expect(dict.reverse['!room0']).toBe('!VkdmKnrz9stD0mzv2QrS3sP');
  });

  it('replaces an event ID (with domain) with $eventN:domainN.org', () => {
    const dict = buildAnonymizationDictionary([makeLine(0, '$ev1:example.org')]);
    expect(dict.forward['$ev1:example.org']).toBe('$event0:domain0.org');
    expect(dict.reverse['$event0:domain0.org']).toBe('$ev1:example.org');
  });

  it('replaces a modern event ID (no domain, min 10 chars) with $eventN', () => {
    const dict = buildAnonymizationDictionary([makeLine(0, '$VkdmKnrz9stD0mzv2QrS3sP redacted')]);
    expect(dict.forward['$VkdmKnrz9stD0mzv2QrS3sP']).toBe('$event0');
    expect(dict.reverse['$event0']).toBe('$VkdmKnrz9stD0mzv2QrS3sP');
  });

  it('shares the same domain alias across different identifier types', () => {
    const dict = buildAnonymizationDictionary([
      makeLine(0, '@alice:example.org in !room1:example.org'),
    ]);
    // Both @alice and !room1 reference example.org → same domain alias
    expect(dict.forward['example.org']).toBe('domain0.org');
    expect(dict.forward['@alice:example.org']).toBe('@user0:domain0.org');
    expect(dict.forward['!room1:example.org']).toBe('!room0:domain0.org');
  });

  it('registers the bare domain so standalone occurrences are replaced', () => {
    const dict = buildAnonymizationDictionary([
      makeLine(0, '@alice:matrix.example.org did something on matrix.example.org'),
    ]);
    expect(dict.forward['matrix.example.org']).toBe('domain0.org');
  });

  it('handles port-bearing server names with bijective dictionary', () => {
    const dict = buildAnonymizationDictionary([makeLine(0, '@alice:example.org:8448')]);
    // Port-bearing variant gets its own forward + reverse entry for bijectivity
    expect(dict.forward['example.org:8448']).toBe('domain0.org:8448');
    expect(dict.reverse['domain0.org:8448']).toBe('example.org:8448');
    // The user ID also gets the port alias
    expect(dict.forward['@alice:example.org:8448']).toBe('@user0:domain0.org:8448');
    expect(dict.reverse['@user0:domain0.org:8448']).toBe('@alice:example.org:8448');
    // The bare domain alias is registered too
    expect(dict.forward['example.org']).toBe('domain0.org');
  });

  it('handles user IDs with uppercase letters in the localpart (legacy servers)', () => {
    const dict = buildAnonymizationDictionary([makeLine(0, '@Bob:matrix.org and @ALICE:matrix.org')]);
    expect(dict.forward['@Bob:matrix.org']).toBe('@user0:domain0.org');
    expect(dict.forward['@ALICE:matrix.org']).toBe('@user1:domain0.org');
  });

  it('scans continuation lines for identifiers', () => {
    const line = createParsedLogLine({
      lineNumber: 0,
      rawText: '2024-01-15T10:00:00.000000Z ERROR error detail',
      message: '2024-01-15T10:00:00.000000Z ERROR error detail',
      strippedMessage: 'error detail',
      continuationLines: ['  user @alice:example.org was involved'],
    });
    const dict = buildAnonymizationDictionary([line]);
    expect(dict.forward['@alice:example.org']).toBe('@user0:domain0.org');
  });
});

// ---------------------------------------------------------------------------
// applyAnonymization / applyUnanonymization
// ---------------------------------------------------------------------------

describe('applyAnonymization', () => {
  it('replaces known identifiers in text', () => {
    const dict = buildAnonymizationDictionary([makeLine(0, '@alice:example.org')]);
    const result = applyAnonymization('user @alice:example.org logged in', dict);
    expect(result).toBe('user @user0:domain0.org logged in');
  });

  it('replaces all occurrences in a single string', () => {
    const dict = buildAnonymizationDictionary([makeLine(0, '@alice:example.org')]);
    const result = applyAnonymization('@alice:example.org and @alice:example.org', dict);
    expect(result).toBe('@user0:domain0.org and @user0:domain0.org');
  });

  it('replaces standalone domain when it was seen inside a Matrix identifier', () => {
    const dict = buildAnonymizationDictionary([makeLine(0, '@alice:example.org')]);
    const result = applyAnonymization('connected to example.org server', dict);
    expect(result).toBe('connected to domain0.org server');
  });

  it('does not modify text with no known identifiers', () => {
    const dict = buildAnonymizationDictionary([makeLine(0, '@alice:example.org')]);
    const result = applyAnonymization('nothing relevant here', dict);
    expect(result).toBe('nothing relevant here');
  });

  it('handles empty text', () => {
    const dict = buildAnonymizationDictionary([makeLine(0, '@alice:example.org')]);
    expect(applyAnonymization('', dict)).toBe('');
  });
});

describe('applyUnanonymization', () => {
  it('restores original identifiers from aliases', () => {
    const dict = buildAnonymizationDictionary([makeLine(0, '@alice:example.org')]);
    const anonymized = applyAnonymization('@alice:example.org', dict);
    const restored = applyUnanonymization(anonymized, dict);
    expect(restored).toBe('@alice:example.org');
  });

  it('restores multiple different identifiers', () => {
    const dict = buildAnonymizationDictionary([
      makeLine(0, '@alice:example.org in !room1:example.org'),
    ]);
    const text = '@alice:example.org joined !room1:example.org';
    const anonymized = applyAnonymization(text, dict);
    const restored = applyUnanonymization(anonymized, dict);
    expect(restored).toBe(text);
  });

  it('does not consume URI path when restoring identifiers embedded in URLs', () => {
    // Regression: the old regex `(?::[^\s]+)?` consumed the `/messages` suffix,
    // so `!room0:domain0.org/messages` was treated as one token and not found
    // in reverse[]. The fixed regex stops at `/`.
    const dict = buildAnonymizationDictionary([makeLine(0, '!room1:example.org')]);
    const uri = '/_matrix/client/v3/rooms/!room1:example.org/messages';
    const anonymized = applyAnonymization(uri, dict);
    const restored = applyUnanonymization(anonymized, dict);
    expect(restored).toBe(uri);
  });

  it('round-trips port-bearing server names', () => {
    const dict = buildAnonymizationDictionary([makeLine(0, '@alice:example.org:8448')]);
    const text = 'connect to @alice:example.org:8448';
    const anonymized = applyAnonymization(text, dict);
    const restored = applyUnanonymization(anonymized, dict);
    expect(restored).toBe(text);
  });
});

// ---------------------------------------------------------------------------
// anonymizeLogLine / unanonymizeLogLine
// ---------------------------------------------------------------------------

describe('anonymizeLogLine', () => {
  it('anonymizes rawText, message, and strippedMessage', () => {
    const line = makeLine(1, '@alice:example.org joined !room1:example.org');
    const dict = buildAnonymizationDictionary([line]);
    const result = anonymizeLogLine(line, dict);

    expect(result.rawText).toContain('@user0:domain0.org');
    expect(result.message).toContain('@user0:domain0.org');
    expect(result.strippedMessage).toContain('@user0:domain0.org');
    expect(result.strippedMessage).not.toContain('@alice:example.org');
  });

  it('anonymizes continuation lines', () => {
    const line = createParsedLogLine({
      lineNumber: 0,
      rawText: '2024-01-15T10:00:00.000000Z ERROR error',
      message: '2024-01-15T10:00:00.000000Z ERROR error',
      strippedMessage: 'error',
      continuationLines: ['  user @alice:example.org'],
    });
    const dict = buildAnonymizationDictionary([line]);
    const result = anonymizeLogLine(line, dict);
    expect(result.continuationLines?.[0]).toBe('  user @user0:domain0.org');
  });

  it('preserves lineNumber, timestamps, level, filePath, sourceLineNumber unchanged', () => {
    const line = createParsedLogLine({
      lineNumber: 42,
      isoTimestamp: '2024-01-15T10:00:00.000000Z',
      displayTime: '10:00:00.000000',
      level: 'WARN',
      filePath: 'src/client.rs',
      sourceLineNumber: 99,
      rawText: '2024-01-15T10:00:00.000000Z WARN @alice:example.org thing',
      message: '2024-01-15T10:00:00.000000Z WARN @alice:example.org thing',
      strippedMessage: '@alice:example.org thing',
    });
    const dict = buildAnonymizationDictionary([line]);
    const result = anonymizeLogLine(line, dict);

    expect(result.lineNumber).toBe(42);
    expect(result.isoTimestamp).toBe('2024-01-15T10:00:00.000000Z');
    expect(result.displayTime).toBe('10:00:00.000000');
    expect(result.level).toBe('WARN');
    expect(result.filePath).toBe('src/client.rs');
    expect(result.sourceLineNumber).toBe(99);
  });
});

describe('unanonymizeLogLine', () => {
  it('restores all text fields round-trip', () => {
    const original = makeLine(0, '@alice:example.org in !room1:example.org');
    const dict = buildAnonymizationDictionary([original]);
    const anonymized = anonymizeLogLine(original, dict);
    const restored = unanonymizeLogLine(anonymized, dict);

    expect(restored.rawText).toBe(original.rawText);
    expect(restored.message).toBe(original.message);
    expect(restored.strippedMessage).toBe(original.strippedMessage);
  });
});

// ---------------------------------------------------------------------------
// detectAnonymizedLog / stripAnonymizedMarker
// ---------------------------------------------------------------------------

describe('detectAnonymizedLog', () => {
  it('returns true when marker is the first non-empty line', () => {
    const content = `${ANONYMIZED_LOG_MARKER}\n2024-01-15T10:00:00Z INFO hello`;
    expect(detectAnonymizedLog(content)).toBe(true);
  });

  it('returns true even with leading blank lines', () => {
    const content = `\n  \n${ANONYMIZED_LOG_MARKER}\n2024-01-15T10:00:00Z INFO hello`;
    expect(detectAnonymizedLog(content)).toBe(true);
  });

  it('returns false for a normal log without marker', () => {
    expect(detectAnonymizedLog('2024-01-15T10:00:00Z INFO hello')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(detectAnonymizedLog('')).toBe(false);
  });

  it('returns false when marker appears on a non-first line', () => {
    const content = `2024-01-15T10:00:00Z INFO hello\n${ANONYMIZED_LOG_MARKER}`;
    expect(detectAnonymizedLog(content)).toBe(false);
  });
});

describe('stripAnonymizedMarker', () => {
  it('removes the marker and following LF', () => {
    const rest = '2024-01-15T10:00:00Z INFO hello\n';
    expect(stripAnonymizedMarker(`${ANONYMIZED_LOG_MARKER}\n${rest}`)).toBe(rest);
  });

  it('removes CRLF variant', () => {
    const rest = '2024-01-15T10:00:00Z INFO hello\r\n';
    expect(stripAnonymizedMarker(`${ANONYMIZED_LOG_MARKER}\r\n${rest}`)).toBe(rest);
  });

  it('leaves content unchanged when marker is absent', () => {
    const content = '2024-01-15T10:00:00Z INFO normal log';
    expect(stripAnonymizedMarker(content)).toBe(content);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: anonymize → unanonymize → original
// ---------------------------------------------------------------------------

describe('round-trip anonymization', () => {
  it('recovers identical text after anonymize + unanonymize using backup lines', () => {
    const lines = [
      makeLine(0, '@alice:matrix.org joined !room1:matrix.org via #general:matrix.org'),
      makeLine(1, '$VkdmKnrz9stD0mzv2QrS3sP was sent in !room1:matrix.org by @alice:matrix.org'),
    ];
    const dict = buildAnonymizationDictionary(lines);
    const anonymized = lines.map((l) => anonymizeLogLine(l, dict));
    // Restore using the reverse dict (simulating loaded-from-file scenario)
    const restored = anonymized.map((l) => unanonymizeLogLine(l, dict));

    restored.forEach((r, i) => {
      expect(r.rawText).toBe(lines[i].rawText);
      expect(r.strippedMessage).toBe(lines[i].strippedMessage);
    });
  });

  it('different domains get different numbered aliases', () => {
    const lines = [
      makeLine(0, '@alice:server-a.org and @bob:server-b.org'),
    ];
    const dict = buildAnonymizationDictionary(lines);
    expect(dict.forward['server-a.org']).toBe('domain0.org');
    expect(dict.forward['server-b.org']).toBe('domain1.org');
    expect(dict.forward['@alice:server-a.org']).toBe('@user0:domain0.org');
    expect(dict.forward['@bob:server-b.org']).toBe('@user1:domain1.org');
  });

  it('does not treat single-char or no-dot hostnames as Matrix server names', () => {
    // Identifiers where the server part is a bare digit or single label (no dot)
    // should NOT be recognized as Matrix IDs. Without this guard, a log line
    // containing e.g. "#channel:0" would put "0" into the dictionary as a bare
    // domain, causing every "0" digit in every other line (e.g. timestamps) to
    // be replaced with a domain alias.
    const lines = [
      makeLine(0, '#channel:0 @service:1 !room_id:localhost something'),
    ];
    const dict = buildAnonymizationDictionary(lines);
    expect(dict.forward['0']).toBeUndefined();
    expect(dict.forward['1']).toBeUndefined();
    expect(dict.forward['localhost']).toBeUndefined();
    // Timestamps must not be corrupted
    const timestamp = '2026-03-19T15:00:06.547102Z';
    expect(applyAnonymization(timestamp, dict)).toBe(timestamp);
  });
});
