/**
 * Choosing records from the collection: the search box, the filters, the sort order, and the
 * URL they are kept in. Pure functions shared by the dashboard, which filters the whole
 * collection in the browser, and open to the Worker, which may answer the same questions over
 * the API one day. No DOM, no Worker types: only record shapes and grades.
 */
import type { ListedRecord } from "./api-types";
import { GRADES, type Grade } from "./grades";

export type SortKey = "artist" | "title" | "year" | "label" | "media" | "sleeve" | "value" | "change" | "gain" | "valued" | "added" | "forsale" | "cheapest";
export type SortDir = "asc" | "desc";
export type Status = "collection" | "priced" | "waiting" | "problem" | "gone" | "all";

export const SORT_KEYS: readonly SortKey[] = ["artist", "title", "year", "label", "media", "sleeve", "value", "change", "gain", "valued", "added", "forsale", "cheapest"];

export const STATUSES: readonly { value: Status; label: string }[] = [
  { value: "collection", label: "In the collection" },
  { value: "priced", label: "Priced" },
  { value: "waiting", label: "Waiting for a price" },
  { value: "problem", label: "Price problem" },
  { value: "gone", label: "Gone from Discogs" },
  { value: "all", label: "Everything" },
];

export type YesNo = "" | "yes" | "no";
export type Discs = "" | "1" | "2" | "3+";
export type Move = "" | "up" | "down" | "flat";
export type GainDir = "" | "up" | "down";
export type How = "" | "suggestion" | "listing";

/** A record with this many copies for sale, or fewer, counts as scarce. */
export const SCARCE_COPIES = 3;

const YES_NO = ["yes", "no"] as const;
const DISCS = ["1", "2", "3+"] as const;
const MOVES = ["up", "down", "flat"] as const;
const GAIN_DIRS = ["up", "down"] as const;
const HOWS = ["suggestion", "listing"] as const;

export interface Selection {
  /** Free text, matched against artist, title, label and catalogue number. */
  q: string;
  /** Media grade, or "" for any. */
  grade: Grade | "";
  status: Status;
  sort: SortKey;
  dir: SortDir;
  sleeve: Grade | "";
  /** "1970s", or "" for any. */
  decade: string;
  kind: FormatKind | "";
  discs: Discs;
  /** Format descriptors a record must all carry: Compilation, Reissue, Mono... */
  desc: string[];
  /** An exact label or artist, as the data spells it. Set by links from elsewhere rather than typed. */
  label: string;
  artist: string;
  /** One of Discogs' genres or styles the record must carry. */
  genre: string;
  style: string;
  spotify: YesNo;
  paid: YesNo;
  /** Value bounds in major units (pounds), inclusive. A record without a value is left out when either is set. */
  min: number | null;
  max: number | null;
  /** Which way the price went over the window the list was asked for (30 days unless the page chose another). */
  move: Move;
  /** Worth more, or less, than what was paid. */
  gain: GainDir;
  /** Priced from Discogs' suggestion for the grade, or from the cheapest copy for sale. */
  how: How;
  /** Only records with SCARCE_COPIES copies for sale or fewer. */
  scarce: boolean;
  /** Only records with something left to do: a price to find or a Spotify album to link. */
  todo: boolean;
}

export const DEFAULT_SELECTION: Readonly<Selection> = {
  q: "",
  grade: "",
  status: "collection",
  sort: "value",
  dir: "desc",
  sleeve: "",
  decade: "",
  kind: "",
  discs: "",
  desc: [],
  label: "",
  artist: "",
  genre: "",
  style: "",
  spotify: "",
  paid: "",
  min: null,
  max: null,
  move: "",
  gain: "",
  how: "",
  scarce: false,
  todo: false,
};

/** The way each order runs when first chosen: biggest, newest and best first; names A to Z; scarcest first. */
export const FIRST_DIR: Readonly<Record<SortKey, SortDir>> = {
  artist: "asc",
  title: "asc",
  year: "desc",
  label: "asc",
  media: "asc",
  sleeve: "asc",
  value: "desc",
  change: "desc",
  gain: "desc",
  valued: "desc",
  added: "desc",
  forsale: "asc",
  cheapest: "desc",
};

/** The URL parameters a selection is kept in. Anything else in the URL belongs to someone else. */
export const SELECTION_KEYS = [
  "q",
  "grade",
  "status",
  "sort",
  "dir",
  "sleeve",
  "decade",
  "kind",
  "discs",
  "desc",
  "label",
  "artist",
  "genre",
  "style",
  "spotify",
  "paid",
  "min",
  "max",
  "move",
  "gain",
  "how",
  "scarce",
  "todo",
] as const;

/** What a selection is read from: URLSearchParams, or anything shaped like it. */
export interface ParamsLike {
  get(name: string): string | null;
  getAll(name: string): string[];
}

function isGrade(value: string | null): value is Grade {
  return (GRADES as readonly string[]).includes(value ?? "");
}

function oneOf<T extends string, F extends string>(value: string | null, allowed: readonly T[], fallback: F): T | F {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/** An amount in major units from the URL: a non-negative number, or null for anything else. */
function amount(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * A selection from the URL. Anything unknown falls back to the default, so a stale link still shows the collection.
 *
 * The default order is most valuable first. A link that names a sort but no direction means
 * ascending, as it always has, so links made before the default changed still read the same.
 */
export function readSelection(params: ParamsLike): Selection {
  const grade = params.get("grade");
  const sleeve = params.get("sleeve");
  const decade = params.get("decade") ?? "";
  const status = params.get("status");
  const sort = params.get("sort");
  const named = (SORT_KEYS as readonly string[]).includes(sort ?? "");
  const dir = params.get("dir");
  return {
    q: params.get("q") ?? "",
    grade: isGrade(grade) ? grade : "",
    status: STATUSES.some((s) => s.value === status) ? (status as Status) : DEFAULT_SELECTION.status,
    sort: named ? (sort as SortKey) : DEFAULT_SELECTION.sort,
    dir: dir === "asc" || dir === "desc" ? dir : named ? "asc" : DEFAULT_SELECTION.dir,
    sleeve: isGrade(sleeve) ? sleeve : "",
    decade: /^\d{4}s$/.test(decade) ? decade : "",
    kind: oneOf(params.get("kind"), FORMAT_KINDS, ""),
    discs: oneOf(params.get("discs"), DISCS, ""),
    desc: [...new Set(params.getAll("desc").map((d) => d.trim()).filter(Boolean))],
    label: params.get("label") ?? "",
    artist: params.get("artist") ?? "",
    genre: params.get("genre") ?? "",
    style: params.get("style") ?? "",
    spotify: oneOf(params.get("spotify"), YES_NO, ""),
    paid: oneOf(params.get("paid"), YES_NO, ""),
    min: amount(params.get("min")),
    max: amount(params.get("max")),
    move: oneOf(params.get("move"), MOVES, ""),
    gain: oneOf(params.get("gain"), GAIN_DIRS, ""),
    how: oneOf(params.get("how"), HOWS, ""),
    scarce: params.get("scarce") === "1",
    todo: params.get("todo") === "1",
  };
}

/** A selection as URL parameters, leaving out whatever is the default, so a plain URL means a plain view. */
export function writeSelection(s: Selection): [string, string][] {
  const out: [string, string][] = [];
  const put = (key: string, value: string | number | null) => {
    if (value !== null && value !== "") out.push([key, String(value)]);
  };
  put("q", s.q);
  put("grade", s.grade);
  if (s.status !== DEFAULT_SELECTION.status) put("status", s.status);
  // A named sort reads as ascending unless told otherwise; the default sort reads as its own direction.
  if (s.sort !== DEFAULT_SELECTION.sort) {
    put("sort", s.sort);
    if (s.dir !== "asc") put("dir", s.dir);
  } else if (s.dir !== DEFAULT_SELECTION.dir) put("dir", s.dir);
  put("sleeve", s.sleeve);
  put("decade", s.decade);
  put("kind", s.kind);
  put("discs", s.discs);
  for (const d of s.desc) put("desc", d);
  put("label", s.label);
  put("artist", s.artist);
  put("genre", s.genre);
  put("style", s.style);
  put("spotify", s.spotify);
  put("paid", s.paid);
  put("min", s.min);
  put("max", s.max);
  put("move", s.move);
  put("gain", s.gain);
  put("how", s.how);
  if (s.scarce) put("scarce", "1");
  if (s.todo) put("todo", "1");
  return out;
}

/** Every filter cleared. The search, the sort order and the tab in view stay. */
export function clearFilters(s: Selection): Selection {
  return {
    ...s,
    grade: "",
    status: DEFAULT_SELECTION.status,
    sleeve: "",
    decade: "",
    kind: "",
    discs: "",
    desc: [],
    label: "",
    artist: "",
    genre: "",
    style: "",
    spotify: "",
    paid: "",
    min: null,
    max: null,
    move: "",
    gain: "",
    how: "",
    scarce: false,
    todo: false,
    ...tabOf(s).filter,
  };
}

/** Only a record with a Discogs release, still in the collection, can be priced. */
export function canPrice(r: ListedRecord): boolean {
  return r.discogs_release_id !== null && r.discogs_removed_at === null;
}

export function matchesStatus(r: ListedRecord, status: Status): boolean {
  const gone = r.discogs_removed_at !== null;
  switch (status) {
    case "collection":
      return !gone;
    case "priced":
      return !gone && r.current_value_minor !== null;
    case "waiting":
      return !gone && r.current_value_minor === null && r.last_valuation_error === null;
    case "problem":
      return !gone && r.last_valuation_error !== null;
    case "gone":
      return gone;
    case "all":
      return true;
  }
}

/** No price yet: still waiting for its first, or Discogs had none to give. */
export function needsPrice(r: ListedRecord): boolean {
  return r.current_value_minor === null;
}

/** Something left to do: a price to find, or a Spotify album to link. */
export function isToDo(r: ListedRecord): boolean {
  return needsPrice(r) || r.spotify_album_id === null;
}

/** Case-insensitive substring search over the words a collector reaches for. */
export function matchesQuery(r: ListedRecord, q: string): boolean {
  const needle = q.trim().toLocaleLowerCase("en-GB");
  if (!needle) return true;
  return [r.artist, r.title, r.label, r.catalogue_number].some((f) => f?.toLocaleLowerCase("en-GB").includes(needle));
}

const sameWord = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** 1 or 2 discs are their own buckets; anything bigger is a box, more or less. */
export function discsBucket(discs: number): Exclude<Discs, ""> {
  return discs >= 3 ? "3+" : discs === 2 ? "2" : "1";
}

export function matches(r: ListedRecord, s: Selection): boolean {
  if (!matchesStatus(r, s.status)) return false;
  if (s.grade && r.media_condition !== s.grade) return false;
  if (s.sleeve && r.sleeve_condition !== s.sleeve) return false;
  if (!matchesQuery(r, s.q)) return false;
  if (s.decade && decadeOf(r.year) !== s.decade) return false;
  if (s.kind || s.discs || s.desc.length > 0) {
    const f = parseFormat(r.format);
    if (s.kind && f.kind !== s.kind) return false;
    if (s.discs && discsBucket(f.discs) !== s.discs) return false;
    if (s.desc.some((d) => !f.descriptors.some((x) => sameWord(x, d)))) return false;
  }
  if (s.label && r.label !== s.label) return false;
  if (s.artist && r.artist !== s.artist) return false;
  if (s.genre && !r.genres.includes(s.genre)) return false;
  if (s.style && !r.styles.includes(s.style)) return false;
  if (s.spotify && (r.spotify_album_id !== null) !== (s.spotify === "yes")) return false;
  if (s.paid && (r.purchase_price_minor !== null) !== (s.paid === "yes")) return false;
  if (s.min !== null || s.max !== null) {
    const v = r.current_value_minor;
    if (v === null) return false;
    if (s.min !== null && v < Math.round(s.min * 100)) return false;
    if (s.max !== null && v > Math.round(s.max * 100)) return false;
  }
  if (s.move) {
    const c = r.change_minor;
    if (c === null) return false;
    if (s.move === "up" ? c <= 0 : s.move === "down" ? c >= 0 : c !== 0) return false;
  }
  if (s.gain) {
    const g = r.gain_minor;
    if (g === null) return false;
    if (s.gain === "up" ? g <= 0 : g >= 0) return false;
  }
  if (s.how && r.current_method !== (s.how === "suggestion" ? "price_suggestion" : "lowest_listing")) return false;
  if (s.scarce && !isScarce(r)) return false;
  if (s.todo && !isToDo(r)) return false;
  return true;
}

/** Few copies for sale: a pressing that rarely comes up. */
export function isScarce(r: ListedRecord): boolean {
  return r.current_num_for_sale !== null && r.current_num_for_sale <= SCARCE_COPIES;
}

const GRADE_RANK = new Map<string, number>(GRADES.map((g, i) => [g, i]));
const text = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });

/** What each column sorts by. Missing values always sink to the bottom, whichever the direction. */
const SORTS: Record<SortKey, (r: ListedRecord) => string | number | null> = {
  artist: (r) => r.artist,
  title: (r) => r.title,
  year: (r) => r.year,
  label: (r) => r.label,
  media: (r) => GRADE_RANK.get(r.media_condition) ?? null,
  sleeve: (r) => GRADE_RANK.get(r.sleeve_condition) ?? null,
  value: (r) => r.current_value_minor,
  change: (r) => r.change_minor,
  gain: (r) => r.gain_minor,
  valued: (r) => r.last_valued_at,
  added: (r) => r.discogs_added_at ?? r.created_at,
  forsale: (r) => r.current_num_for_sale,
  cheapest: (r) => r.current_lowest_listing_minor,
};

function compare(a: string | number, b: string | number): number {
  if (typeof a === "string" && typeof b === "string") return text.compare(a, b);
  return (a as number) - (b as number);
}

/** A sorted copy. Ties fall back to artist, then title, so the order is the same on every visit. */
export function sortRecords(records: readonly ListedRecord[], sort: SortKey, dir: SortDir): ListedRecord[] {
  const key = SORTS[sort];
  return [...records].sort((a, b) => {
    const x = key(a);
    const y = key(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    const order = compare(x, y);
    return (dir === "asc" ? order : -order) || text.compare(a.artist, b.artist) || text.compare(a.title, b.title);
  });
}

/** The records a selection shows, in the order it shows them. */
export function applySelection(records: readonly ListedRecord[], s: Selection): ListedRecord[] {
  return sortRecords(
    records.filter((r) => matches(r, s)),
    s.sort,
    s.dir,
  );
}

// --- Reading what Discogs says a pressing is ------------------------------------------------

export type FormatKind = "LP" | '12"' | '10"' | '7"' | "Box set" | "Other" | "Unknown";
export const FORMAT_KINDS: readonly FormatKind[] = ["LP", '12"', '10"', '7"', "Box set", "Other", "Unknown"];

/** Kinds in order of precedence: a box set of LPs is a box set. */
const KINDS: { token: string; kind: FormatKind }[] = [
  { token: "box set", kind: "Box set" },
  { token: "lp", kind: "LP" },
  { token: '12"', kind: '12"' },
  { token: '10"', kind: '10"' },
  { token: '7"', kind: '7"' },
];

export interface ParsedFormat {
  kind: FormatKind;
  /** How many discs: the "2x" in "2xLP". */
  discs: number;
  /** Everything else Discogs says: Album, Compilation, Reissue, Mono, Limited Edition... */
  descriptors: string[];
}

/**
 * Take a record's format string apart. The string is built from Discogs' format entry, so its
 * parts come in whatever order Discogs listed them ("Album, LP" happens) and the quantity rides
 * on the first part ("2xLP, Album"). Parts are treated as a set.
 */
export function parseFormat(format: string | null | undefined): ParsedFormat {
  const tokens = (format ?? "")
    .split(/,\s*/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length === 0) return { kind: "Unknown", discs: 1, descriptors: [] };

  let discs = 1;
  const parts = tokens.map((t) => {
    const m = /^(\d+)x(.+)$/.exec(t);
    if (!m) return t;
    discs = Number(m[1]);
    return m[2]!.trim();
  });

  const lower = parts.map((p) => p.toLowerCase());
  const found = KINDS.find((k) => lower.includes(k.token));
  const descriptors = found ? parts.filter((_, i) => lower[i] !== found.token) : parts;
  return { kind: found?.kind ?? "Other", discs, descriptors };
}

/** "1970s", or null when the year is unknown. */
export function decadeOf(year: number | null | undefined): string | null {
  if (year === null || year === undefined || !Number.isFinite(year)) return null;
  return `${Math.floor(year / 10) * 10}s`;
}

// --- What a selection could narrow to, and what it adds up to --------------------------------

export type FacetKey = "grade" | "status" | "sleeve" | "decade" | "kind" | "discs" | "desc" | "label" | "genre" | "style" | "spotify" | "paid" | "move" | "gain" | "how" | "scarce";

export interface FacetOption {
  value: string;
  label: string;
  /** How many records the selection would show with this option chosen. */
  count: number;
}

export type FacetOptions = Record<FacetKey, FacetOption[]>;

const FACET_RESET: { [K in FacetKey]: Selection[K] } = { grade: "", status: "all", sleeve: "", decade: "", kind: "", discs: "", desc: [], label: "", genre: "", style: "", spotify: "", paid: "", move: "", gain: "", how: "", scarce: false };

const DISC_LABELS: Record<Exclude<Discs, "">, string> = { "1": "1 disc", "2": "2 discs", "3+": "3 or more" };
const YES_NO_LABELS = {
  spotify: { yes: "On Spotify", no: "Not on Spotify" },
  paid: { yes: "Price paid known", no: "No price paid" },
} as const;
const MOVE_LABELS: Record<Exclude<Move, "">, string> = { up: "Rose", down: "Fell", flat: "Flat" };
const GAIN_LABELS: Record<Exclude<GainDir, "">, string> = { up: "Worth more than paid", down: "Worth less than paid" };
const HOW_LABELS: Record<Exclude<How, "">, string> = { suggestion: "Discogs' suggestion", listing: "Cheapest copy for sale" };
const SCARCE_LABEL = `${SCARCE_COPIES} or fewer for sale`;

/**
 * The options for every facet, each with the number of records it would show. A facet's counts
 * are taken with that facet cleared and everything else applied, so an option says what choosing
 * it would do. Descriptors stack (a record must carry all the chosen ones), so their counts are
 * taken over the records already shown. Statuses overlap (a priced record is also in the
 * collection), so each counts on its own. Options nothing would match are left out, unless chosen.
 */
export function facetOptions(records: readonly ListedRecord[], s: Selection): FacetOptions {
  const without = (key: FacetKey) => records.filter((r) => matches(r, { ...s, [key]: FACET_RESET[key] }));
  const tally = (rows: ListedRecord[], pick: (r: ListedRecord, f: ParsedFormat) => string | readonly string[] | null) => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const picked = pick(r, parseFormat(r.format));
      for (const key of picked === null ? [] : typeof picked === "string" ? [picked] : picked) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  /** What the selection has chosen in a facet. A chosen option stays listed even when nothing would match it, so it can be seen and taken off. */
  const chosen = (key: FacetKey): readonly string[] => {
    const v = s[key];
    return Array.isArray(v) ? v : v === true ? ["yes"] : typeof v === "string" && v ? [v] : [];
  };
  const inOrder = (key: FacetKey, values: readonly string[], counts: Map<string, number>, label: (v: string) => string = (v) => v) =>
    values.map((value) => ({ value, label: label(value), count: counts.get(value) ?? 0 })).filter((o) => o.count > 0 || chosen(key).includes(o.value));
  const byCount = (key: FacetKey, counts: Map<string, number>) =>
    [...counts.entries(), ...chosen(key).filter((v) => !counts.has(v)).map((v): [string, number] => [v, 0])]
      .sort((a, b) => b[1] - a[1] || text.compare(a[0], b[0]))
      .map(([value, n]) => ({ value, label: value, count: n }));

  const decades = tally(without("decade"), (r) => decadeOf(r.year));
  const yesNo = (key: "spotify" | "paid", has: (r: ListedRecord) => boolean) => {
    const counts = tally(without(key), (r) => (has(r) ? "yes" : "no"));
    return inOrder(key, YES_NO, counts, (v) => YES_NO_LABELS[key][v as "yes" | "no"]);
  };
  const anyStatus = without("status");
  return {
    grade: inOrder("grade", GRADES, tally(without("grade"), (r) => r.media_condition)),
    status: STATUSES.map((o) => ({ value: o.value, label: o.label, count: anyStatus.filter((r) => matchesStatus(r, o.value)).length })).filter((o) => o.count > 0 || o.value === s.status),
    sleeve: inOrder("sleeve", GRADES, tally(without("sleeve"), (r) => r.sleeve_condition)),
    decade: inOrder("decade", [...new Set([...decades.keys(), ...chosen("decade")])].sort(), decades),
    kind: inOrder("kind", FORMAT_KINDS, tally(without("kind"), (_, f) => f.kind)),
    discs: inOrder("discs", DISCS, tally(without("discs"), (_, f) => discsBucket(f.discs)), (v) => DISC_LABELS[v as Exclude<Discs, "">]),
    desc: byCount("desc", tally(records.filter((r) => matches(r, s)), (_, f) => f.descriptors)),
    label: byCount("label", tally(without("label"), (r) => r.label)),
    genre: byCount("genre", tally(without("genre"), (r) => r.genres)),
    style: byCount("style", tally(without("style"), (r) => r.styles)),
    spotify: yesNo("spotify", (r) => r.spotify_album_id !== null),
    paid: yesNo("paid", (r) => r.purchase_price_minor !== null),
    move: inOrder("move", MOVES, tally(without("move"), (r) => (r.change_minor === null ? null : r.change_minor > 0 ? "up" : r.change_minor < 0 ? "down" : "flat")), (v) => MOVE_LABELS[v as Exclude<Move, "">]),
    gain: inOrder("gain", GAIN_DIRS, tally(without("gain"), (r) => (r.gain_minor === null ? null : r.gain_minor > 0 ? "up" : r.gain_minor < 0 ? "down" : null)), (v) => GAIN_LABELS[v as Exclude<GainDir, "">]),
    how: inOrder("how", HOWS, tally(without("how"), (r) => (r.current_method === "price_suggestion" ? "suggestion" : r.current_method === "lowest_listing" ? "listing" : null)), (v) => HOW_LABELS[v as Exclude<How, "">]),
    scarce: inOrder("scarce", ["yes"], tally(without("scarce"), (r) => (isScarce(r) ? "yes" : null)), () => SCARCE_LABEL),
  };
}

export interface Totals {
  count: number;
  /** Records with a value in the asked-for currency; the sums below cover these. */
  priced: number;
  value_minor: number;
  /** Over the window the list was asked for. Null until at least one record has a change. */
  change_minor: number | null;
  /** Null until at least one record has a price paid in the same currency. */
  gain_minor: number | null;
  /** How many records the gain covers. */
  paid: number;
}

/** What a set of records adds up to: what it is worth, how that moved, and the gain on what was paid. */
export function totals(records: readonly ListedRecord[], currency: string): Totals {
  const t: Totals = { count: records.length, priced: 0, value_minor: 0, change_minor: null, gain_minor: null, paid: 0 };
  for (const r of records) {
    if (r.current_value_minor === null || r.current_currency !== currency) continue;
    t.priced += 1;
    t.value_minor += r.current_value_minor;
    if (r.change_minor !== null) t.change_minor = (t.change_minor ?? 0) + r.change_minor;
    if (r.gain_minor !== null) {
      t.gain_minor = (t.gain_minor ?? 0) + r.gain_minor;
      t.paid += 1;
    }
  }
  return t;
}

export interface ActiveFilter {
  key: string;
  label: string;
  /** The selection with this one filter removed. */
  next: Selection;
}

/**
 * The filters in force, as chips: what each says, and the selection without it. `over` is how
 * the change window reads: "in 30 days". The filter a tab stands for is left out, since the tab
 * already says it.
 */
export function activeFilters(s: Selection, money: (major: number) => string, over = "in 30 days"): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  const add = (key: string, label: string, reset: Partial<Selection>) => out.push({ key, label, next: { ...s, ...reset } });
  if (s.artist) add("artist", s.artist, { artist: "" });
  if (s.label) add("label", `On ${s.label}`, { label: "" });
  if (s.genre) add("genre", s.genre, { genre: "" });
  if (s.style) add("style", s.style, { style: "" });
  if (s.decade) add("decade", s.decade, { decade: "" });
  if (s.kind) add("kind", s.kind, { kind: "" });
  if (s.discs) add("discs", DISC_LABELS[s.discs], { discs: "" });
  for (const d of s.desc) add(`desc:${d}`, d, { desc: s.desc.filter((x) => x !== d) });
  if (s.grade) add("grade", `Media ${s.grade}`, { grade: "" });
  if (s.sleeve) add("sleeve", `Sleeve ${s.sleeve}`, { sleeve: "" });
  if (s.spotify) add("spotify", YES_NO_LABELS.spotify[s.spotify], { spotify: "" });
  if (s.paid) add("paid", YES_NO_LABELS.paid[s.paid], { paid: "" });
  if (s.min !== null && s.max !== null) add("value", `${money(s.min)} to ${money(s.max)}`, { min: null, max: null });
  else if (s.min !== null) add("value", `From ${money(s.min)}`, { min: null, max: null });
  else if (s.max !== null) add("value", `Up to ${money(s.max)}`, { min: null, max: null });
  if (s.move) add("move", `${MOVE_LABELS[s.move]} ${over}`, { move: "" });
  if (s.gain) add("gain", GAIN_LABELS[s.gain], { gain: "" });
  if (s.how) add("how", `Priced from ${s.how === "suggestion" ? "a suggestion" : "a listing"}`, { how: "" });
  if (s.scarce) add("scarce", SCARCE_LABEL, { scarce: false });
  if (s.status !== DEFAULT_SELECTION.status) add("status", STATUSES.find((o) => o.value === s.status)!.label, { status: DEFAULT_SELECTION.status });
  if (s.todo) add("todo", "To do", { todo: false });
  const shownByTab = Object.keys(tabOf(s).filter);
  return out.filter((f) => !shownByTab.includes(f.key));
}

// --- Named views: presets other pages link into, and the tabs built from them -----------------

export interface QuickFilter {
  id: string;
  label: string;
  /** What it sets. Everything else in the selection is left as it was, so a search stays a search. */
  preset: Partial<Selection>;
}

/** Views a collector keeps coming back to. The Overview links into them; the Collection page shows two as tabs. */
export const QUICK_FILTERS: readonly QuickFilter[] = [
  { id: "valuable", label: "Most valuable", preset: { status: "priced", sort: "value", dir: "desc" } },
  { id: "risers", label: "Biggest risers", preset: { move: "up", sort: "change", dir: "desc" } },
  { id: "fallers", label: "Biggest fallers", preset: { move: "down", sort: "change", dir: "asc" } },
  { id: "waiting", label: "Needs a price", preset: { status: "waiting" } },
  { id: "no-spotify", label: "No Spotify yet", preset: { spotify: "no" } },
  { id: "bargains", label: "Bought for less than worth", preset: { gain: "up", sort: "gain", dir: "desc" } },
  { id: "scarce", label: "Scarce", preset: { scarce: true, sort: "forsale", dir: "asc" } },
];

export type TabId = "all" | "risers" | "fallers" | "todo";

export interface Tab {
  id: TabId;
  label: string;
  /** What the tab narrows to. It is in force while every part of it is. */
  filter: Partial<Selection>;
  /** The order the tab brings with it, if any. */
  order?: Pick<Selection, "sort" | "dir">;
}

/** A quick filter as a tab: its order apart from what it narrows to. */
function fromQuickFilter(id: string): Pick<Tab, "filter" | "order"> {
  const { sort, dir, ...filter } = QUICK_FILTERS.find((f) => f.id === id)!.preset;
  return sort && dir ? { filter, order: { sort, dir } } : { filter };
}

export const TABS: readonly Tab[] = [
  { id: "all", label: "All", filter: {} },
  { id: "risers", label: "Risers", ...fromQuickFilter("risers") },
  { id: "fallers", label: "Fallers", ...fromQuickFilter("fallers") },
  { id: "todo", label: "To do", filter: { todo: true } },
];

const ALL_TAB = TABS[0]!;

function inForce(s: Selection, tab: Tab): boolean {
  const keys = Object.keys(tab.filter) as (keyof Selection)[];
  return keys.length > 0 && keys.every((k) => String(s[k]) === String(tab.filter[k]));
}

/** The tab a selection is on: the first whose filter is in force, or All. */
export function tabOf(s: Selection): Tab {
  return TABS.find((t) => inForce(s, t)) ?? ALL_TAB;
}

/**
 * Move to a tab. The old tab's filter comes off, and so does its order unless the collector has
 * since chosen another; the new tab's filter and order go on. Search and every other filter stay.
 */
export function chooseTab(s: Selection, id: TabId): Selection {
  const from = tabOf(s);
  const to = TABS.find((t) => t.id === id) ?? ALL_TAB;
  if (from.id === to.id) return s;
  const off = Object.fromEntries(Object.keys(from.filter).map((k) => [k, DEFAULT_SELECTION[k as keyof Selection]])) as Partial<Selection>;
  const orderOff = from.order && s.sort === from.order.sort && s.dir === from.order.dir ? { sort: DEFAULT_SELECTION.sort, dir: DEFAULT_SELECTION.dir } : {};
  return { ...s, ...off, ...orderOff, ...to.filter, ...to.order };
}
