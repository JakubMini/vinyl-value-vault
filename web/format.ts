import { formatMinor } from "../src/money";

export { formatMinor };

const relative = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
const dateTimeFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
const countFormat = new Intl.NumberFormat("en-GB");

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** "3 minutes ago", "yesterday", "just now". */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((Date.parse(iso) - now) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

/** "2 Oct 2026, 14:27" in the viewer's time zone. */
export function dateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

export function count(n: number): string {
  return countFormat.format(n);
}

/** "1 record", "163 records". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${count(n)} ${n === 1 ? one : many}`;
}
