/** Which columns the collection table shows. The choice is remembered in this browser only. */
import type { SortKey } from "../src/select";

export type ColumnKey = "year" | "label" | "catno" | "format" | "media" | "sleeve" | "value" | "change" | "gain" | "forsale" | "cheapest" | "valued" | "added";

export interface ColumnSpec {
  key: ColumnKey;
  /** The header. The change column's comes from the range, so it is filled in by the page. */
  label: string;
  /** Hover text for a header that needs it. */
  hint?: string;
  sort?: SortKey;
  numeric?: boolean;
  /** Hidden on narrow screens. */
  narrow?: boolean;
  /** Shown until the collector says otherwise. */
  shown: boolean;
}

export const COLUMNS: readonly ColumnSpec[] = [
  { key: "year", label: "Year", sort: "year", numeric: true, narrow: true, shown: true },
  { key: "label", label: "Label", sort: "label", narrow: true, shown: false },
  { key: "catno", label: "Cat. no.", narrow: true, shown: false },
  { key: "format", label: "Format", narrow: true, shown: false },
  { key: "media", label: "Grade", hint: "Media grade", sort: "media", shown: true },
  { key: "sleeve", label: "Sleeve", sort: "sleeve", narrow: true, shown: false },
  { key: "value", label: "Value", sort: "value", numeric: true, shown: true },
  { key: "change", label: "Change", sort: "change", numeric: true, narrow: true, shown: true },
  { key: "gain", label: "Gain", sort: "gain", numeric: true, narrow: true, shown: false },
  { key: "forsale", label: "For sale", sort: "forsale", numeric: true, narrow: true, shown: false },
  { key: "cheapest", label: "Cheapest", sort: "cheapest", numeric: true, narrow: true, shown: false },
  { key: "valued", label: "Priced", sort: "valued", narrow: true, shown: false },
  { key: "added", label: "Added", sort: "added", narrow: true, shown: false },
];

// Version 2 came with a quieter default set; a choice saved against the old one is not carried over.
const STORAGE_KEY = "vinyl-value-vault.columns.v2";
const DEFAULT = new Set<ColumnKey>(COLUMNS.filter((c) => c.shown).map((c) => c.key));

/** The remembered choice, or the default. Storage may be missing or refuse; the table must still render. */
export function loadColumns(): ReadonlySet<ColumnKey> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT;
    const known = new Set(COLUMNS.map((c) => c.key));
    return new Set(parsed.filter((k): k is ColumnKey => typeof k === "string" && known.has(k as ColumnKey)));
  } catch {
    return DEFAULT;
  }
}

export function saveColumns(columns: ReadonlySet<ColumnKey>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...columns]));
  } catch {
    // Private windows and full stores forget; the choice just lasts the visit.
  }
}
