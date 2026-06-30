import { describe, it, expect } from 'vitest';
import { buildProcessColorMap, processOf } from '../processColors';

describe('processOf', () => {
  it('returns the leading filename token as the process name', () => {
    expect(processOf('console.2026-04-14-08.log.gz')).toBe('console');
    expect(processOf('nse.2026-04-14-08.log.gz')).toBe('nse');
    expect(processOf('shareextension.2026-04-11-18.log.gz')).toBe('shareextension');
    expect(processOf('dir/nse.2026-04-14-08.log.gz')).toBe('nse');
  });
});

describe('buildProcessColorMap', () => {
  it('assigns one distinct colour per process', () => {
    const map = buildProcessColorMap([
      'console.2026-04-14-08.log.gz',
      'console.2026-04-14-09.log.gz',
      'nse.2026-04-14-08.log.gz',
    ]);
    expect([...map.keys()].sort()).toEqual(['console', 'nse']);
    expect(map.get('console')).not.toBe(map.get('nse'));
  });

  it('is deterministic regardless of input order', () => {
    const a = buildProcessColorMap(['nse.x.log', 'console.x.log']);
    const b = buildProcessColorMap(['console.x.log', 'nse.x.log']);
    expect(a.get('console')).toBe(b.get('console'));
    expect(a.get('nse')).toBe(b.get('nse'));
  });
});
