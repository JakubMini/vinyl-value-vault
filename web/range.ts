/** The window a change is measured over. One `range` parameter, shared by the Overview and the Collection. */

export const RANGES = [
  { value: "7", label: "7 days", period: "7 days", days: 7 },
  { value: "30", label: "30 days", period: "30 days", days: 30 },
  { value: "90", label: "90 days", period: "90 days", days: 90 },
  { value: "365", label: "1 year", period: "a year", days: 365 },
  { value: "all", label: "All time", period: "all time", days: 3650 },
] as const;

export type Range = (typeof RANGES)[number];

export const DEFAULT_RANGE: Range = RANGES[1];

export function readRange(params: { get(name: string): string | null }): Range {
  return RANGES.find((r) => r.value === params.get("range")) ?? DEFAULT_RANGE;
}

/** "in 30 days", "in a year", "over all time": how a change over the window reads in a sentence. */
export function over(range: Range): string {
  return range.value === "all" ? "over all time" : `in ${range.period}`;
}

/** Put a range in the URL, or take it out when it is the default. */
export function withRange(params: URLSearchParams, range: Range): URLSearchParams {
  const next = new URLSearchParams(params);
  if (range.value === DEFAULT_RANGE.value) next.delete("range");
  else next.set("range", range.value);
  return next;
}
