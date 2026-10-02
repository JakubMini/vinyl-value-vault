/**
 * What the collection adds up to, cut different ways: where the value sits, how it is spread,
 * how it moved, how the collection grew. Pure functions over the collection list, shared with
 * the dashboard's Insights page. Every slice knows the selection that shows exactly its
 * records, so a bar can lead to the table.
 */
import type { ListedRecord } from "./api-types";
import { GRADES } from "./grades";
import { decadeOf, FORMAT_KINDS, isScarce, parseFormat, SCARCE_COPIES, type Selection } from "./select";

export type BreakdownKey = "decade" | "kind" | "grade" | "genre" | "style" | "label" | "artist";

export const BREAKDOWNS: readonly { key: BreakdownKey; label: string }[] = [
  { key: "decade", label: "Decade" },
  { key: "kind", label: "Format" },
  { key: "grade", label: "Grade" },
  { key: "genre", label: "Genre" },
  { key: "style", label: "Style" },
  { key: "label", label: "Label" },
  { key: "artist", label: "Artist" },
];

/** Cuts where one record can fall into several slices, so the shares can add up to more than one. */
export const OVERLAPPING: readonly BreakdownKey[] = ["genre", "style"];

export interface Slice {
  key: string;
  label: string;
  /** Records in the slice, priced or not. */
  count: number;
  /** Of which priced in the asked-for currency; the value covers these. */
  priced: number;
  value_minor: number;
  /** This slice's part of all the priced value, 0 to 1. */
  share: number;
  /** What narrows the collection to this slice, or null when it cannot be put in a URL (a folded tail, an unknown year). */
  selection: Partial<Selection> | null;
}

interface Grouping {
  /** The slice a record belongs to, or every slice it belongs to. */
  of: (r: ListedRecord, format: ReturnType<typeof parseFormat>) => string | readonly string[];
  label: (key: string) => string;
  selection: (key: string) => Partial<Selection> | null;
  /** Fixed order for a small, known set; otherwise by value. */
  order?: readonly string[];
}

const UNKNOWN_YEAR = "Unknown year";
const NO_LABEL = "No label";
const NO_GENRE = "No genre";
const NO_STYLE = "No style";

const GROUPINGS: Record<BreakdownKey, Grouping> = {
  decade: {
    of: (r) => decadeOf(r.year) ?? UNKNOWN_YEAR,
    label: (k) => k,
    selection: (k) => (k === UNKNOWN_YEAR ? null : { decade: k }),
  },
  kind: {
    of: (_, f) => f.kind,
    label: (k) => k,
    selection: (k) => ({ kind: k as Selection["kind"] }),
    order: FORMAT_KINDS,
  },
  grade: {
    of: (r) => r.media_condition,
    label: (k) => k,
    selection: (k) => ({ grade: k as Selection["grade"] }),
    order: GRADES,
  },
  genre: {
    of: (r) => (r.genres.length > 0 ? r.genres : NO_GENRE),
    label: (k) => k,
    selection: (k) => (k === NO_GENRE ? null : { genre: k }),
  },
  style: {
    of: (r) => (r.styles.length > 0 ? r.styles : NO_STYLE),
    label: (k) => k,
    selection: (k) => (k === NO_STYLE ? null : { style: k }),
  },
  label: {
    of: (r) => r.label ?? NO_LABEL,
    label: (k) => k,
    selection: (k) => (k === NO_LABEL ? null : { label: k }),
  },
  artist: {
    of: (r) => r.artist,
    label: (k) => k,
    selection: (k) => ({ artist: k }),
  },
};

const text = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });

function slice(key: string, label: string, selection: Partial<Selection> | null): Slice {
  return { key, label, count: 0, priced: 0, value_minor: 0, share: 0, selection };
}

function add(s: Slice, r: ListedRecord, currency: string): void {
  s.count += 1;
  if (r.current_value_minor !== null && r.current_currency === currency) {
    s.priced += 1;
    s.value_minor += r.current_value_minor;
  }
}

/** The value of every priced record in `currency`: what a share is a share of. */
function pricedTotal(records: readonly ListedRecord[], currency: string): number {
  return records.reduce((sum, r) => sum + (r.current_value_minor !== null && r.current_currency === currency ? r.current_value_minor : 0), 0);
}

function withShares(slices: Slice[], total: number): Slice[] {
  for (const s of slices) s.share = total > 0 ? s.value_minor / total : 0;
  return slices;
}

/**
 * The collection cut by one key. A known small set (decades, formats, grades) comes in its
 * natural order; an open set (genres, styles, labels, artists) comes by value, the top `limit`
 * and the rest folded into "Others". Shares are of the whole priced collection, so where a
 * record can sit in several slices (its genres) they can add up to more than one.
 */
export function breakdown(records: readonly ListedRecord[], by: BreakdownKey, currency: string, limit = 12): Slice[] {
  const g = GROUPINGS[by];
  const slices = new Map<string, Slice>();
  for (const r of records) {
    const keys = g.of(r, parseFormat(r.format));
    for (const key of typeof keys === "string" ? [keys] : keys) {
      let s = slices.get(key);
      if (!s) slices.set(key, (s = slice(key, g.label(key), g.selection(key))));
      add(s, r, currency);
    }
  }

  let ordered: Slice[];
  if (g.order) {
    ordered = g.order.map((k) => slices.get(k)).filter((s): s is Slice => s !== undefined);
  } else if (by === "decade") {
    ordered = [...slices.values()].sort((a, b) => (a.key === UNKNOWN_YEAR ? 1 : b.key === UNKNOWN_YEAR ? -1 : text.compare(a.key, b.key)));
  } else {
    ordered = [...slices.values()].sort((a, b) => b.value_minor - a.value_minor || b.count - a.count || text.compare(a.key, b.key));
  }

  if (ordered.length > limit + 1) {
    const kept = ordered.slice(0, limit);
    const tail = slice("others", `Others (${ordered.length - limit})`, null);
    for (const s of ordered.slice(limit)) {
      tail.count += s.count;
      tail.priced += s.priced;
      tail.value_minor += s.value_minor;
    }
    ordered = [...kept, tail];
  }
  return withShares(ordered, pricedTotal(records, currency));
}

/** Band edges in minor units; the last band is open-ended. */
export const VALUE_BANDS = [0, 500, 1000, 2000, 5000, 10_000] as const;

function whole(minor: number, currency: string): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency, maximumFractionDigits: 0 }).format(minor / 100);
}

/** How many records sit in each value band. Records without a price are left out. */
export function valueBands(records: readonly ListedRecord[], currency: string): Slice[] {
  const slices = VALUE_BANDS.map((from, i) => {
    const to = VALUE_BANDS[i + 1];
    const label = i === 0 ? `Under ${whole(to!, currency)}` : to === undefined ? `${whole(from, currency)} and over` : `${whole(from, currency)} to ${whole(to, currency)}`;
    return slice(String(from), label, { min: from / 100, max: to === undefined ? null : (to - 1) / 100 });
  });
  for (const r of records) {
    if (r.current_value_minor === null || r.current_currency !== currency) continue;
    let i = VALUE_BANDS.findIndex((from, j) => r.current_value_minor! >= from && (j === VALUE_BANDS.length - 1 || r.current_value_minor! < VALUE_BANDS[j + 1]!));
    if (i < 0) i = 0;
    add(slices[i]!, r, currency);
  }
  return withShares(slices, pricedTotal(records, currency));
}

export interface Concentration {
  priced: number;
  total_minor: number;
  /** How many records the top share covers. */
  top: number;
  /** The part of all the value held by the `top` most valuable records, 0 to 1. */
  top_share: number;
  median_minor: number | null;
  mean_minor: number | null;
}

/** How much of the value sits in the few most valuable records, and what a typical record is worth. */
export function concentration(records: readonly ListedRecord[], currency: string, top = 10): Concentration {
  const values = records
    .filter((r) => r.current_value_minor !== null && r.current_currency === currency)
    .map((r) => r.current_value_minor!)
    .sort((a, b) => b - a);
  const total = values.reduce((sum, v) => sum + v, 0);
  const n = values.length;
  const topTotal = values.slice(0, top).reduce((sum, v) => sum + v, 0);
  const median = n === 0 ? null : n % 2 === 1 ? values[(n - 1) / 2]! : Math.round((values[n / 2 - 1]! + values[n / 2]!) / 2);
  return {
    priced: n,
    total_minor: total,
    top: Math.min(top, n),
    top_share: total > 0 ? topTotal / total : 0,
    median_minor: median,
    mean_minor: n === 0 ? null : Math.round(total / n),
  };
}

export interface Moves {
  rose: number;
  fell: number;
  flat: number;
  /** Priced too recently to have a 30-day figure, or not priced. */
  unknown: number;
}

/** Which way prices went over 30 days, by count. */
export function moves(records: readonly ListedRecord[]): Moves {
  const m: Moves = { rose: 0, fell: 0, flat: 0, unknown: 0 };
  for (const r of records) {
    const c = r.change_30d_minor;
    if (c === null) m.unknown += 1;
    else if (c > 0) m.rose += 1;
    else if (c < 0) m.fell += 1;
    else m.flat += 1;
  }
  return m;
}

export interface Market {
  /** Priced from Discogs' suggestion for the grade. */
  suggestion: number;
  /** Priced from the cheapest copy for sale. */
  listing: number;
  unpriced: number;
  /** Copies for sale across the collection, or null when no record has the figure. */
  for_sale: number | null;
  /** Records with SCARCE_COPIES copies or fewer. */
  scarce: number;
  scarce_at: number;
}

/** How prices were found, and how much of the collection is on the market. */
export function market(records: readonly ListedRecord[]): Market {
  const m: Market = { suggestion: 0, listing: 0, unpriced: 0, for_sale: null, scarce: 0, scarce_at: SCARCE_COPIES };
  for (const r of records) {
    if (r.current_method === "price_suggestion") m.suggestion += 1;
    else if (r.current_method === "lowest_listing") m.listing += 1;
    else m.unpriced += 1;
    if (r.current_num_for_sale !== null) m.for_sale = (m.for_sale ?? 0) + r.current_num_for_sale;
    if (isScarce(r)) m.scarce += 1;
  }
  return m;
}

export interface GrowthPoint {
  /** The day, as a time in ms. */
  t: number;
  /** Records in the collection by the end of that day. */
  count: number;
  /** Added that day. */
  added: number;
}

/** How the collection grew: one point per day something was added, counting from when Discogs says it joined. */
export function growth(records: readonly ListedRecord[]): GrowthPoint[] {
  const perDay = new Map<string, number>();
  for (const r of records) {
    if (r.discogs_removed_at !== null) continue;
    const day = (r.discogs_added_at ?? r.created_at).slice(0, 10);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  let running = 0;
  return [...perDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, added]) => ({ t: Date.parse(`${day}T00:00:00.000Z`), count: (running += added), added }));
}
