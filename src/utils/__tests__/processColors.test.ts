import { describe, it, expect } from 'vitest';
import { buildProcessColorMap, processOf, shadeColor, APP_LANE_COLOR } from '../processColors';

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

  it('gives console (sorted first) the app base colour', () => {
    const map = buildProcessColorMap(['nse.x.log', 'console.x.log', 'shareextension.x.log']);
    expect(map.get('console')).toBe(APP_LANE_COLOR);
  });
});

describe('shadeColor', () => {
  it('returns an hsl() string preserving hue', () => {
    expect(shadeColor('#3b82f6', 0)).toMatch(/^hsl\(21[0-9], \d+%, \d+%\)$/);
  });

  it('lightens for positive deltaL and darkens for negative', () => {
    const l = (c: string) => Number(c.match(/(\d+)%\)$/)![1]);
    expect(l(shadeColor('#3b82f6', 0.2))).toBeGreaterThan(l(shadeColor('#3b82f6', 0)));
    expect(l(shadeColor('#3b82f6', -0.2))).toBeLessThan(l(shadeColor('#3b82f6', 0)));
  });

  it('clamps lightness to a legible range', () => {
    expect(shadeColor('#000000', -1)).toBe('hsl(0, 0%, 12%)');
    expect(shadeColor('#ffffff', 1)).toBe('hsl(0, 0%, 92%)');
  });
});
