/**
 * The value axis of a line chart, shared by the dashboard and its tests.
 *
 * Tight: the axis runs from the lowest value shown to the highest, not from zero, so a move of a
 * few pounds on a large collection fills the chart instead of hiding in a flat line near the top.
 * Gridlines sit at round steps inside that span. Values are whole numbers (pence, counts), so a
 * step is never less than one.
 */
export interface ValueScale {
  lo: number;
  hi: number;
  ticks: number[];
}

export function valueScale(values: number[], count = 4): ValueScale {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) {
    // A flat line has no span of its own: give it a little room either side, never below zero
    // for values that cannot go there.
    const pad = Math.max(1, Math.round(Math.abs(hi) * 0.05));
    lo = lo >= 0 ? Math.max(0, lo - pad) : lo - pad;
    hi += pad;
  }
  const raw = (hi - lo) / count;
  let step = 1;
  if (raw > 1) {
    const magnitude = 10 ** Math.floor(Math.log10(raw));
    step = [1, 2, 2.5, 5, 10]
      .map((m) => m * magnitude)
      .filter((s) => Number.isInteger(s))
      .find((s) => s >= raw) ?? 10 * magnitude;
  }
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  return { lo, hi, ticks };
}
