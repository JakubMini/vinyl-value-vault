import { describe, expect, it } from "vitest";

import {
  applySelection,
  DEFAULT_SELECTION,
  decadeOf,
  matches,
  parseFormat,
  readSelection,
  type Selection,
  sortRecords,
  writeSelection,
} from "../src/select";
import { listedRecord } from "./helpers";

const params = (query: string) => new URLSearchParams(query);
const select = (changes: Partial<Selection>): Selection => ({ ...DEFAULT_SELECTION, ...changes });

describe("reading a format string", () => {
  it.each([
    ["LP, Album, Stereo", { kind: "LP", discs: 1, descriptors: ["Album", "Stereo"] }],
    ["2xLP, Album, Stereo", { kind: "LP", discs: 2, descriptors: ["Album", "Stereo"] }],
    ["3xLP, Compilation", { kind: "LP", discs: 3, descriptors: ["Compilation"] }],
    ['7", 45 RPM, Single, Limited Edition, Picture Disc', { kind: '7"', discs: 1, descriptors: ["45 RPM", "Single", "Limited Edition", "Picture Disc"] }],
    ['12", 45 RPM', { kind: '12"', discs: 1, descriptors: ["45 RPM"] }],
    ["Album, LP", { kind: "LP", discs: 1, descriptors: ["Album"] }],
    ["LP, Mono, Compilation", { kind: "LP", discs: 1, descriptors: ["Mono", "Compilation"] }],
    ["4xBox Set, Compilation, Limited Edition", { kind: "Box set", discs: 4, descriptors: ["Compilation", "Limited Edition"] }],
    ["Box Set, LP, Album", { kind: "Box set", discs: 1, descriptors: ["LP", "Album"] }],
    ["LP", { kind: "LP", discs: 1, descriptors: [] }],
    ["Picture Disc, Shape", { kind: "Other", discs: 1, descriptors: ["Picture Disc", "Shape"] }],
    ["", { kind: "Unknown", discs: 1, descriptors: [] }],
    [null, { kind: "Unknown", discs: 1, descriptors: [] }],
  ])("%s", (format, expected) => {
    expect(parseFormat(format)).toEqual(expected);
  });

  it("names a decade", () => {
    expect(decadeOf(1956)).toBe("1950s");
    expect(decadeOf(2026)).toBe("2020s");
    expect(decadeOf(null)).toBeNull();
  });
});

describe("a selection in the URL", () => {
  it("is the default when the URL is plain", () => {
    expect(readSelection(params(""))).toEqual(DEFAULT_SELECTION);
    expect(writeSelection(DEFAULT_SELECTION)).toEqual([]);
  });

  it("reads what is there and falls back on anything unknown", () => {
    expect(readSelection(params("q=dummy&grade=NM&status=gone&sort=value&dir=desc"))).toEqual({
      q: "dummy",
      grade: "NM",
      status: "gone",
      sort: "value",
      dir: "desc",
    });
    expect(readSelection(params("grade=A1&status=lost&sort=colour&dir=sideways"))).toEqual(DEFAULT_SELECTION);
  });

  it("round-trips, writing only what differs from the default", () => {
    const s = select({ q: "muza", status: "all", sort: "year", dir: "desc" });
    const written = writeSelection(s);
    expect(written).toEqual([
      ["q", "muza"],
      ["status", "all"],
      ["sort", "year"],
      ["dir", "desc"],
    ]);
    expect(readSelection(new URLSearchParams(written))).toEqual(s);
  });
});

describe("which records a selection shows", () => {
  const priced = listedRecord({ id: 1, artist: "Portishead", title: "Dummy", label: "Go! Beat", catalogue_number: "828 522-1", current_value_minor: 4000, current_currency: "GBP", last_valued_at: "2026-10-01T00:00:00.000Z" });
  const waiting = listedRecord({ id: 2, artist: "Czesław Niemen", title: "Enigmatic", media_condition: "NM" });
  const problem = listedRecord({ id: 3, artist: "Ewa Demarczyk", title: "Live", last_valuation_error: "No copies for sale and no price suggestion" });
  const gone = listedRecord({ id: 4, artist: "Nirvana", title: "Nevermind", current_value_minor: 2500, current_currency: "GBP", discogs_removed_at: "2026-09-01T00:00:00.000Z" });
  const all = [priced, waiting, problem, gone];

  const ids = (s: Partial<Selection>) => all.filter((r) => matches(r, select(s))).map((r) => r.id);

  it.each([
    ["collection", [1, 2, 3]],
    ["priced", [1]],
    ["waiting", [2]],
    ["problem", [3]],
    ["gone", [4]],
    ["all", [1, 2, 3, 4]],
  ] as const)("status %s", (status, expected) => {
    expect(ids({ status })).toEqual(expected);
  });

  it("filters by media grade", () => {
    expect(ids({ grade: "NM" })).toEqual([2]);
    expect(ids({ grade: "VG+", status: "all" })).toEqual([1, 3, 4]);
  });

  it("searches artist, title, label and catalogue number, ignoring case", () => {
    expect(ids({ q: "DUMMY" })).toEqual([1]);
    expect(ids({ q: "go! beat" })).toEqual([1]);
    expect(ids({ q: "828 522" })).toEqual([1]);
    expect(ids({ q: "niemen" })).toEqual([2]);
    expect(ids({ q: "  " })).toEqual([1, 2, 3]);
    expect(ids({ q: "nevermind" })).toEqual([]);
    expect(ids({ q: "nevermind", status: "all" })).toEqual([4]);
  });
});

describe("sorting", () => {
  const a = listedRecord({ id: 1, artist: "abba", title: "Arrival", year: 1976, current_value_minor: 1200, media_condition: "VG" });
  const b = listedRecord({ id: 2, artist: "Beatles", title: "Help!", year: 1965, current_value_minor: null, media_condition: "M" });
  const c = listedRecord({ id: 3, artist: "Abba", title: "Voulez-Vous", year: 1979, current_value_minor: 3000, media_condition: "NM" });
  const d = listedRecord({ id: 4, artist: "Zappa", title: "Hot Rats", year: null, current_value_minor: 800, media_condition: "VG+" });
  const rows = [d, c, b, a];
  const order = (sort: Parameters<typeof sortRecords>[1], dir: "asc" | "desc") => sortRecords(rows, sort, dir).map((r) => r.id);

  it("sorts text without caring about case; ties stay in title order whichever way it sorts", () => {
    expect(order("artist", "asc")).toEqual([1, 3, 2, 4]);
    expect(order("artist", "desc")).toEqual([4, 2, 1, 3]);
  });

  it("sinks missing values to the bottom whichever way it sorts", () => {
    expect(order("value", "asc")).toEqual([4, 1, 3, 2]);
    expect(order("value", "desc")).toEqual([3, 1, 4, 2]);
    expect(order("year", "asc")).toEqual([2, 1, 3, 4]);
    expect(order("year", "desc")).toEqual([3, 1, 2, 4]);
  });

  it("sorts grades best to worst, not alphabetically", () => {
    expect(order("media", "asc")).toEqual([2, 3, 4, 1]);
  });

  it("leaves the input alone", () => {
    sortRecords(rows, "year", "asc");
    expect(rows.map((r) => r.id)).toEqual([4, 3, 2, 1]);
  });

  it("filters and sorts together", () => {
    expect(applySelection(rows, select({ q: "abba", sort: "value", dir: "desc" })).map((r) => r.id)).toEqual([3, 1]);
  });
});
