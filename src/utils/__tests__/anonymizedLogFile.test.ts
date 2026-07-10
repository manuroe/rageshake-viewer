import { describe, it, expect } from 'vitest';
import { serializeLogLines, buildAnonymizedFileText, deriveAnonymizedFilename } from '../anonymizedLogFile';
import { ANONYMIZED_LOG_MARKER } from '../anonymizeUtils';
import { createParsedLogLine } from '../../test/fixtures';

describe('serializeLogLines', () => {
  it('joins primary text and continuation lines in order', () => {
    const lines = [
      createParsedLogLine({ lineNumber: 0, rawText: 'first' }),
      createParsedLogLine({ lineNumber: 1, rawText: 'second', continuationLines: ['  cont a', '  cont b'] }),
      createParsedLogLine({ lineNumber: 2, rawText: 'third' }),
    ];
    expect(serializeLogLines(lines)).toBe('first\nsecond\n  cont a\n  cont b\nthird');
  });
});

describe('buildAnonymizedFileText', () => {
  it('prepends the marker and ends with a newline', () => {
    const text = buildAnonymizedFileText([createParsedLogLine({ lineNumber: 0, rawText: 'x' })]);
    expect(text).toBe(`${ANONYMIZED_LOG_MARKER}\nx\n`);
  });
});

describe('deriveAnonymizedFilename', () => {
  it('inserts -anonym before the extension', () => {
    expect(deriveAnonymizedFilename('console.log')).toBe('console-anonym.log');
  });

  it('drops a trailing .gz (content is decompressed)', () => {
    expect(deriveAnonymizedFilename('logs.2026-04-14-08.log.gz')).toBe('logs.2026-04-14-08-anonym.log');
  });

  it('appends -anonym.log when there is no extension', () => {
    expect(deriveAnonymizedFilename('3 files')).toBe('3 files-anonym.log');
  });

  it('falls back to logs-anonym.log for null / empty', () => {
    expect(deriveAnonymizedFilename(null)).toBe('logs-anonym.log');
    expect(deriveAnonymizedFilename('   ')).toBe('logs-anonym.log');
  });
});
