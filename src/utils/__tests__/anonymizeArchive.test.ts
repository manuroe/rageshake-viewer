import { describe, it, expect } from 'vitest';
import { decompressSync, gzipSync, strToU8, strFromU8 } from 'fflate';
import { parseTar } from '../tarParser';
import { buildAnonymisedArchiveGz, buildArchiveDictionary, deriveAnonymizedArchiveName } from '../anonymizeArchive';

const SALT = 'test-salt';
const USER_RE = /@user-[0-9a-f]{12}:domain-[0-9a-f]{8}\.org/;

describe('deriveAnonymizedArchiveName', () => {
  it('inserts -anonym before the extension and always ends .tar.gz', () => {
    expect(deriveAnonymizedArchiveName('rageshake.tar.gz')).toBe('rageshake-anonym.tar.gz');
    expect(deriveAnonymizedArchiveName('rageshake.tgz')).toBe('rageshake-anonym.tar.gz');
    expect(deriveAnonymizedArchiveName('rageshake.tar')).toBe('rageshake-anonym.tar.gz');
    expect(deriveAnonymizedArchiveName(null)).toBe('archive-anonym.tar.gz');
  });
});

describe('buildAnonymisedArchiveGz', () => {
  it('anonymises text files with cross-file aliases, passes binaries through, keeps names', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 255]);
    const entries = [
      { name: 'console.log.gz', data: gzipSync(strToU8('user @alice:matrix.org joined')) },
      { name: 'details.json', data: strToU8('{"userId":"@alice:matrix.org"}') },
      { name: 'logo.png', data: png },
    ];

    const gz = await buildAnonymisedArchiveGz(entries, SALT);
    const tar = parseTar(decompressSync(gz));
    const byName = Object.fromEntries(tar.map((e) => [e.name, e]));

    // Names unchanged.
    expect(Object.keys(byName).sort()).toEqual(['console.log.gz', 'details.json', 'logo.png']);

    const logText = strFromU8(decompressSync(byName['console.log.gz'].data));
    const jsonText = strFromU8(byName['details.json'].data);

    expect(logText).not.toContain('@alice:matrix.org');
    expect(logText).toMatch(USER_RE);

    // Cross-file consistency: same alias in both text files.
    const alias = logText.match(USER_RE)![0];
    expect(jsonText).toContain(alias);
    expect(jsonText).not.toContain('@alice:matrix.org');

    // Binary passed through byte-for-byte.
    expect(Array.from(byName['logo.png'].data)).toEqual(Array.from(png));
  });

  it('passes a mislabelled/corrupt .gz member through unchanged instead of throwing', async () => {
    const notGz = new Uint8Array([1, 2, 3, 4, 5]); // no gzip header
    const entries = [
      { name: 'a.log', data: strToU8('@alice:matrix.org') },
      { name: 'weird.gz', data: notGz },
    ];
    const tar = parseTar(decompressSync(await buildAnonymisedArchiveGz(entries, SALT)));
    const byName = Object.fromEntries(tar.map((e) => [e.name, e]));
    // Valid text member still anonymised.
    expect(strFromU8(byName['a.log'].data)).not.toContain('@alice:matrix.org');
    // Undecompressable .gz preserved byte-for-byte.
    expect(Array.from(byName['weird.gz'].data)).toEqual(Array.from(notGz));
  });

  it('reports progress reaching the total', async () => {
    const entries = [
      { name: 'a.log', data: strToU8('@alice:matrix.org') },
      { name: 'b.log', data: strToU8('@bob:matrix.org') },
    ];
    const calls: Array<[string, number, number]> = [];
    await buildAnonymisedArchiveGz(entries, SALT, (phase, current, total) => calls.push([phase, current, total]));
    // Anonymising phase reaches current === total (2 files).
    expect(calls).toContainEqual(['Anonymising files', 2, 2]);
    // Final compressing phase is emitted.
    expect(calls.some(([phase]) => phase === 'Compressing')).toBe(true);
  });
});

describe('buildArchiveDictionary', () => {
  it('builds one dictionary across text files and ignores binaries', async () => {
    const dict = await buildArchiveDictionary(
      [
        { name: 'a.log.gz', data: gzipSync(strToU8('@alice:matrix.org')) },
        { name: 'b.json', data: strToU8('@bob:matrix.org') },
        { name: 'c.png', data: new Uint8Array([1, 2, 3]) },
      ],
      SALT,
    );
    expect(dict.forward['@alice:matrix.org']).toMatch(USER_RE);
    expect(dict.forward['@bob:matrix.org']).toMatch(USER_RE);
    // same server → shared domain component
    expect(dict.forward['@alice:matrix.org'].split(':')[1]).toBe(
      dict.forward['@bob:matrix.org'].split(':')[1],
    );
  });
});
