import { processOf, APP_LANE_COLOR, CONSOLE_PROCESS } from './processColors';
import { appStateColors, appStateAt, type AppStateSegment } from './lifecycleEvents';

interface RowStripeInput {
  /** Process → colour map (from `buildProcessColorMap`). */
  readonly processColorMap: ReadonlyMap<string, string>;
  /** Whether non-app process stripes should show (true only for multi-process). */
  readonly showProcessColors: boolean;
  /** App-state spans over the full log (from `deriveAppStateSegments`). */
  readonly stateSegments: readonly AppStateSegment[];
}

/**
 * Build the per-row lane-stripe colourer for the logs / http_requests tables,
 * so those screens share the `/summary` app-lane colour language.
 *
 * The **app (console) stream** is striped by its app-state shade at the row's
 * timestamp (foreground / background / backgroundWorking — see
 * `appStateColors`), whenever lifecycle data exists — even for a single-process
 * log. Other processes keep their flat palette colour, shown only in
 * multi-process logs (unchanged). Returns `undefined` for no stripe.
 *
 * @returns `(sourceFile, timestampUs) => color | undefined`
 */
export function makeRowStripeColorer({
  processColorMap,
  showProcessColors,
  stateSegments,
}: RowStripeInput): (sourceFile: string | undefined, timestampUs: number | undefined) => string | undefined {
  const stateColors = appStateColors(APP_LANE_COLOR);
  const hasState = stateSegments.length > 0;
  // The app stream is `console` when present, else the sole process (single-file
  // logs get a filename-derived process). Multi-process without console → none.
  const appProcess = processColorMap.has(CONSOLE_PROCESS)
    ? CONSOLE_PROCESS
    : processColorMap.size === 1
      ? [...processColorMap.keys()][0]
      : null;

  return (sourceFile, timestampUs) => {
    const proc = sourceFile ? processOf(sourceFile) : appProcess ?? undefined;
    if (hasState && appProcess !== null && proc === appProcess) {
      // No known timestamp for this row (its send line is missing, or the line
      // was unparseable — the parser uses timestampUs <= 0 for "absent", as does
      // getMinMaxTimestamps) — we can't tell which state it was in, so don't
      // guess a shade.
      if (timestampUs === undefined || timestampUs <= 0) return undefined;
      const state = appStateAt(stateSegments, timestampUs);
      return state ? stateColors[state] : APP_LANE_COLOR;
    }
    return showProcessColors && proc ? processColorMap.get(proc) : undefined;
  };
}
