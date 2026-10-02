/**
 * Choosing records from the collection: the search box, the filters, the sort order, and the
 * URL they are kept in. Pure functions shared by the dashboard, which filters the whole
 * collection in the browser, and open to the Worker, which may answer the same questions over
 * the API one day. No DOM, no Worker types: only record shapes and grades.
 */
import type { ListedRecord } from "./api-types";
import { GRADES, type Grade } from "./grades";

export type SortKey = "artist" | "title" | "year" | "media" | "sleeve" | "value" | "change" | "gain" | "valued" | "added";
export type SortDir = "asc" | "desc";
export type Status = "collection" | "priced" | "waiting" | "problem" | "gone" | "all";

export const SORT_KEYS: readonly SortKey[] = ["artist", "title", "year", "media", "sleeve", "value", "change", "gain", "valued", "added"];

export const STATUSES: readonly { value: Status; label: string }[] = [
  { value: "collection", label: "In the collection" },
  { value: "priced", label: "Priced" },
  { value: "waiting", label: "Waiting for a price" },
  { value: "problem", label: "Price problem" },
  { value: "gone", label: "Gone from Discogs" },
  { value: "all", label: "Everything" },
];

export interface Selection {
  /** Free text, matched against artist, title, label and catalogue number. */
  q: string;
  /** Media grade, or "" for any. */
  grade: Grade | "";
  status: Status;
  sort: SortKey;
  dir: SortDir;
}

export const DEFAULT_SELECTION: Readonly<Selection> = { q: "", grade: "", status: "collection", sort: "artist", dir: "asc" };

/** The URL parameters a selection is kept in. Anything else in the URL belongs to someone else. */
export const SELECTION_KEYS = ["q", "grade", "status", "sort", "dir"] as const;

/** What a selection is read from: URLSearchParams, or anything shaped like it. */
export interface ParamsLike {
  get(name: string): string | null;
  getAll(name: string): string[];
}

function isGrade(value: string | null): value is Grade {
  return (GRADES as readonly string[]).includes(value ?? "");
}

/** A selection from the URL. Anything unknown falls back to the default, so a stale link still shows the collection. */
export function readSelection(params: ParamsLike): Selection {
  const grade = params.get("grade");
  const status = params.get("status");
  const sort = params.get("sort");
  return {
    q: params.get("q") ?? "",
    grade: isGrade(grade) ? grade : "",
    status: STATUSES.some((s) => s.value === status) ? (status as Status) : DEFAULT_SELECTION.status,
    sort: SORT_KEYS.includes(sort as SortKey) ? (sort as SortKey) : DEFAULT_SELECTION.sort,
    dir: params.get("dir") === "desc" ? "desc" : "asc",
  };
}

/** A selection as URL parameters, leaving out whatever is the default, so a plain URL means a plain view. */
export function writeSelection(s: Selection): [string, string][] {
  const out: [string, string][] = [];
  if (s.q) out.push(["q", s.q]);
  if (s.grade) out.push(["grade", s.grade]);
  if (s.status !== DEFAULT_SELECTION.status) out.push(["status", s.status]);
  if (s.sort !== DEFAULT_SELECTION.sort) out.push(["sort", s.sort]);
  if (s.dir !== DEFAULT_SELECTION.dir) out.push(["dir", s.dir]);
  return out;
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

/** Case-insensitive substring search over the words a collector reaches for. */
export function matchesQuery(r: ListedRecord, q: string): boolean {
  const needle = q.trim().toLocaleLowerCase("en-GB");
  if (!needle) return true;
  return [r.artist, r.title, r.label, r.catalogue_number].some((f) => f?.toLocaleLowerCase("en-GB").includes(needle));
}

export function matches(r: ListedRecord, s: Selection): boolean {
  return matchesStatus(r, s.status) && (!s.grade || r.media_condition === s.grade) && matchesQuery(r, s.q);
}

const GRADE_RANK = new Map<string, number>(GRADES.map((g, i) => [g, i]));
const text = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });

/** What each column sorts by. Missing values always sink to the bottom, whichever the direction. */
const SORTS: Record<SortKey, (r: ListedRecord) => string | number | null> = {
  artist: (r) => r.artist,
  title: (r) => r.title,
  year: (r) => r.year,
  media: (r) => GRADE_RANK.get(r.media_condition) ?? null,
  sleeve: (r) => GRADE_RANK.get(r.sleeve_condition) ?? null,
  value: (r) => r.current_value_minor,
  change: (r) => r.change_30d_minor,
  gain: (r) => r.gain_minor,
  valued: (r) => r.last_valued_at,
  added: (r) => r.discogs_added_at ?? r.created_at,
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
