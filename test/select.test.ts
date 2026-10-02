import { describe, expect, it } from "vitest";

import {
  activeFilters,
  applySelection,
  clearFilters,
  DEFAULT_SELECTION,
  decadeOf,
  facetOptions,
  matches,
  parseFormat,
  QUICK_FILTERS,
  quickFilterActive,
  readSelection,
  type Selection,
  sortRecords,
  toggleQuickFilter,
  totals,
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
    expect(readSelection(params("q=dummy&grade=NM&status=gone&sort=value&dir=desc"))).toEqual(select({ q: "dummy", grade: "NM", status: "gone", sort: "value", dir: "desc" }));
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

  it("round-trips the narrow filters, descriptors repeated", () => {
    const s = select({ decade: "1970s", kind: "LP", discs: "2", desc: ["Compilation", "Mono"], label: "CBS", artist: "Abba", sleeve: "VG", spotify: "no", paid: "yes", min: 5, max: 20.5, move: "up", gain: "down", how: "listing", scarce: true });
    const written = writeSelection(s);
    expect(written.filter(([k]) => k === "desc")).toEqual([
      ["desc", "Compilation"],
      ["desc", "Mono"],
    ]);
    expect(readSelection(new URLSearchParams(written))).toEqual(s);
  });

  it("drops bounds and choices it cannot read", () => {
    expect(readSelection(params("min=abc&max=-3&decade=seventies&kind=cassette&discs=9&spotify=maybe&move=sideways&gain=lots"))).toEqual(DEFAULT_SELECTION);
    expect(readSelection(params("desc=&desc=Mono&desc=Mono")).desc).toEqual(["Mono"]);
  });

  it("clears the narrow filters and keeps the rest", () => {
    const s = select({ q: "abba", grade: "NM", status: "all", sort: "value", dir: "desc", decade: "1970s", desc: ["Mono"], min: 5, artist: "Abba" });
    expect(clearFilters(s)).toEqual(select({ q: "abba", grade: "NM", status: "all", sort: "value", dir: "desc" }));
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

describe("the narrow filters", () => {
  const rows = [
    listedRecord({ id: 1, artist: "Abba", label: "Polar", year: 1976, format: "LP, Album, Stereo", sleeve_condition: "NM", spotify_album_id: "x", purchase_price_minor: 500, purchase_currency: "GBP", current_value_minor: 1200, current_currency: "GBP", change_30d_minor: 100, gain_minor: 700, current_method: "price_suggestion", current_num_for_sale: 12 }),
    listedRecord({ id: 2, artist: "Abba", label: "Polar", year: 1979, format: "2xLP, Compilation, Mono", sleeve_condition: "VG", current_value_minor: 3000, current_currency: "GBP", change_30d_minor: -50, gain_minor: null, current_method: "lowest_listing", current_num_for_sale: 40 }),
    listedRecord({ id: 3, artist: "Beatles", label: "Parlophone", year: 1965, format: '7", Single, Mono', sleeve_condition: "VG+", current_value_minor: 800, current_currency: "GBP", change_30d_minor: 0, purchase_price_minor: 1000, purchase_currency: "GBP", gain_minor: -200, current_method: "lowest_listing", current_num_for_sale: 2 }),
    listedRecord({ id: 4, artist: "Zappa", label: null, year: null, format: null, sleeve_condition: "VG+" }),
  ];
  const ids = (changes: Partial<Selection>) => rows.filter((r) => matches(r, select(changes))).map((r) => r.id);

  it.each([
    [{ decade: "1970s" }, [1, 2]],
    [{ kind: "LP" }, [1, 2]],
    [{ kind: '7"' }, [3]],
    [{ kind: "Unknown" }, [4]],
    [{ discs: "2" }, [2]],
    [{ discs: "1" }, [1, 3, 4]],
    [{ desc: ["Mono"] }, [2, 3]],
    [{ desc: ["mono", "Compilation"] }, [2]],
    [{ label: "Polar" }, [1, 2]],
    [{ artist: "Beatles" }, [3]],
    [{ sleeve: "VG+" }, [3, 4]],
    [{ spotify: "yes" }, [1]],
    [{ spotify: "no" }, [2, 3, 4]],
    [{ paid: "yes" }, [1, 3]],
    [{ min: 10 }, [1, 2]],
    [{ max: 10 }, [3]],
    [{ min: 8, max: 12 }, [1, 3]],
    [{ move: "up" }, [1]],
    [{ move: "down" }, [2]],
    [{ move: "flat" }, [3]],
    [{ gain: "up" }, [1]],
    [{ gain: "down" }, [3]],
    [{ how: "suggestion" }, [1]],
    [{ how: "listing" }, [2, 3]],
    [{ scarce: true }, [3]],
  ] as [Partial<Selection>, number[]][])("%j", (changes, expected) => {
    expect(ids(changes)).toEqual(expected);
  });

  it("counts what each option would show, with that facet cleared and the rest applied", () => {
    const o = facetOptions(rows, select({ decade: "1970s", kind: "LP" }));
    expect(o.decade).toEqual([
      { value: "1960s", label: "1960s", count: 0 },
      { value: "1970s", label: "1970s", count: 2 },
    ].filter((x) => x.count > 0));
    expect(o.kind).toEqual([{ value: "LP", label: "LP", count: 2 }]);
    expect(o.discs).toEqual([
      { value: "1", label: "1 disc", count: 1 },
      { value: "2", label: "2 discs", count: 1 },
    ]);
    expect(o.label).toEqual([{ value: "Polar", label: "Polar", count: 2 }]);
    expect(o.sleeve).toEqual([
      { value: "NM", label: "NM", count: 1 },
      { value: "VG", label: "VG", count: 1 },
    ]);
    expect(o.spotify).toEqual([
      { value: "yes", label: "On Spotify", count: 1 },
      { value: "no", label: "Not on Spotify", count: 1 },
    ]);
    expect(o.move).toEqual([
      { value: "up", label: "Rose", count: 1 },
      { value: "down", label: "Fell", count: 1 },
    ]);
    expect(o.how).toEqual([
      { value: "suggestion", label: "Discogs' suggestion", count: 1 },
      { value: "listing", label: "Cheapest copy for sale", count: 1 },
    ]);
  });

  it("stacks descriptors: counts are over the records already shown, most common first", () => {
    expect(facetOptions(rows, select({})).desc.map((o) => `${o.value}:${o.count}`)).toEqual(["Mono:2", "Album:1", "Compilation:1", "Single:1", "Stereo:1"]);
    expect(facetOptions(rows, select({ desc: ["Compilation"] })).desc.map((o) => `${o.value}:${o.count}`)).toEqual(["Compilation:1", "Mono:1"]);
  });

  it("adds up what is shown, in one currency", () => {
    const other = listedRecord({ id: 5, current_value_minor: 99_999, current_currency: "USD", change_30d_minor: 5, gain_minor: 5 });
    expect(totals([...rows, other], "GBP")).toEqual({ count: 5, priced: 3, value_minor: 5000, change_minor: 50, gain_minor: 500, paid: 2 });
    expect(totals([rows[3]!], "GBP")).toEqual({ count: 1, priced: 0, value_minor: 0, change_minor: null, gain_minor: null, paid: 0 });
  });

  it("describes the filters in force, each with a way out", () => {
    const s = select({ artist: "Abba", decade: "1970s", desc: ["Mono", "Compilation"], min: 5, max: 20, move: "up", q: "keep me", how: "listing", scarce: true });
    const chips = activeFilters(s, (n) => `£${n}`);
    expect(chips.map((c) => c.label)).toEqual(["Abba", "1970s", "Mono", "Compilation", "£5 to £20", "Rose in 30 days", "Priced from a listing", "3 or fewer for sale"]);
    expect(chips[2]!.next.desc).toEqual(["Compilation"]);
    expect(chips[4]!.next).toMatchObject({ min: null, max: null, q: "keep me" });
    expect(activeFilters(select({ max: 20 }), (n) => `£${n}`)[0]!.label).toBe("Up to £20");
  });

  it("quick filters go on and off, leaving a search alone", () => {
    const risers = QUICK_FILTERS.find((f) => f.id === "risers")!;
    const on = toggleQuickFilter(select({ q: "abba" }), risers);
    expect(on).toMatchObject({ q: "abba", move: "up", sort: "change", dir: "desc" });
    expect(quickFilterActive(on, risers)).toBe(true);
    expect(toggleQuickFilter(on, risers)).toEqual(select({ q: "abba" }));
    expect(rows.filter((r) => matches(r, on)).map((r) => r.id)).toEqual([1]);
  });

  it("every quick filter shows something sensible on a mixed collection", () => {
    const expected: Record<string, number[]> = { valuable: [2, 1, 3], risers: [1], fallers: [2], waiting: [4], "no-spotify": [2, 3, 4], bargains: [1], scarce: [3] };
    for (const f of QUICK_FILTERS) {
      expect(applySelection(rows, toggleQuickFilter(select({}), f)).map((r) => r.id), f.id).toEqual(expected[f.id]);
    }
  });
});
