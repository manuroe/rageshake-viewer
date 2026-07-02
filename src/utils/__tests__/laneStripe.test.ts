import { describe, it, expect } from 'vitest';
import { makeRowStripeColorer } from '../laneStripe';
import { appStateColors, type AppStateSegment } from '../lifecycleEvents';
import { APP_LANE_COLOR } from '../processColors';

const SHADES = appStateColors(APP_LANE_COLOR);
const segments: AppStateSegment[] = [
  { startUs: 0, endUs: 100, state: 'foreground' },
  { startUs: 100, endUs: 200, state: 'background' },
];

describe('makeRowStripeColorer', () => {
  it('stripes the console stream by app-state shade (multi-process)', () => {
    const color = makeRowStripeColorer({
      processColorMap: new Map([['console', '#3b82f6'], ['nse', '#10b981']]),
      showProcessColors: true,
      stateSegments: segments,
    });
    expect(color('console.x.log', 50)).toBe(SHADES.foreground);
    expect(color('console.x.log', 150)).toBe(SHADES.background);
    // Non-app process keeps its flat palette colour.
    expect(color('nse.x.log', 50)).toBe('#10b981');
  });

  it('stripes the sole process by state for a single-process log', () => {
    const color = makeRowStripeColorer({
      processColorMap: new Map([['demo', '#3b82f6']]),
      showProcessColors: false, // single process → no process stripes...
      stateSegments: segments,
    });
    // ...but the app stream still gets its state shade.
    expect(color('demo.log', 50)).toBe(SHADES.foreground);
  });

  it('falls back to the base app colour where the state is undetermined', () => {
    const color = makeRowStripeColorer({
      processColorMap: new Map([['console', '#3b82f6']]),
      showProcessColors: false,
      stateSegments: segments,
    });
    expect(color('console.x.log', 500)).toBe(APP_LANE_COLOR); // past all segments
  });

  it('returns undefined for a non-app process in a single-colour context', () => {
    const color = makeRowStripeColorer({
      processColorMap: new Map([['console', '#3b82f6'], ['nse', '#10b981']]),
      showProcessColors: false,
      stateSegments: [],
    });
    expect(color('nse.x.log', 50)).toBeUndefined();
  });

  it('returns undefined for the app stream when its timestamp is missing or non-positive', () => {
    const color = makeRowStripeColorer({
      processColorMap: new Map([['console', '#3b82f6']]),
      showProcessColors: false,
      stateSegments: segments,
    });
    // Send line missing (no timestamp at all).
    expect(color('console.x.log', undefined)).toBeUndefined();
    // Unparseable timestamp — the parser uses <= 0 for "absent".
    expect(color('console.x.log', 0)).toBeUndefined();
  });
});
