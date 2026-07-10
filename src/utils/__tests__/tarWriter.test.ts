import { describe, it, expect } from 'vitest';
import { buildTar } from '../tarWriter';
import { parseTar } from '../tarParser';

const enc = new TextEncoder();
const dec = new TextDecoder();

describe('buildTar', () => {
  it('round-trips names and bytes through parseTar', () => {
    const files = [
      { name: 'a.log', data: enc.encode('hello') },
      { name: 'dir/b.json', data: enc.encode('{"x":1}') },
      { name: 'empty.txt', data: new Uint8Array(0) },
    ];
    const entries = parseTar(buildTar(files));
    expect(entries.map((e) => e.name)).toEqual(['a.log', 'dir/b.json', 'empty.txt']);
    expect(dec.decode(entries[0].data)).toBe('hello');
    expect(dec.decode(entries[1].data)).toBe('{"x":1}');
    expect(entries[2].data.length).toBe(0);
  });

  it('preserves arbitrary binary bytes exactly', () => {
    const data = new Uint8Array([0, 1, 2, 255, 254, 128, 0, 42]);
    const [entry] = parseTar(buildTar([{ name: 'x.bin', data }]));
    expect(Array.from(entry.data)).toEqual(Array.from(data));
  });

  it('splits long paths via the ustar prefix field', () => {
    const name = `${'d'.repeat(120)}/file.log`;
    const [entry] = parseTar(buildTar([{ name, data: enc.encode('x') }]));
    expect(entry.name).toBe(name);
  });

  it('round-trips latin1 (non-ASCII) names through parseTar', () => {
    const name = 'café-log.txt';
    const [entry] = parseTar(buildTar([{ name, data: enc.encode('x') }]));
    expect(entry.name).toBe(name);
  });

  it('writes a self-consistent ustar checksum', () => {
    const header = buildTar([{ name: 'a.log', data: enc.encode('hello') }]).subarray(0, 512);
    const stored = parseInt(dec.decode(header.subarray(148, 154)).trim(), 8);
    const copy = header.slice();
    for (let i = 148; i < 156; i++) copy[i] = 0x20;
    let sum = 0;
    for (const b of copy) sum += b;
    expect(stored).toBe(sum);
  });
});
