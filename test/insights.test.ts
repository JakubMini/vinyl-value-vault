import { describe, expect, it } from "vitest";

import { breakdown, concentration, growth, market, moves, valueBands } from "../src/insights";
import { listedRecord } from "./helpers";

const gbp = (id: number, minor: number | null, rest: Parameters<typeof listedRecord>[0] = {}) =>
  listedRecord({ id, current_value_minor: minor, current_currency: minor === null ? null : "GBP", ...rest });

describe("where the value is", () => {
  const rows = [
    gbp(1, 1000, { year: 1976, format: "LP, Album", media_condition: "NM", label: "Polar", artist: "Abba" }),
    gbp(2, 3000, { year: 1979, format: "2xLP, Compilation", media_condition: "VG+", label: "Polar", artist: "Abba" }),
    gbp(3, null, { year: 1965, format: '7", Single', media_condition: "VG", label: "Parlophone", artist: "Beatles" }),
    gbp(4, 500, { year: null, format: null, media_condition: "VG+", label: null, artist: "Zappa" }),
    listedRecord({ id: 5, current_value_minor: 99_999, current_currency: "USD", year: 1971, format: "LP", media_condition: "M", label: "Reprise", artist: "Zappa" }),
  ];

  it("cuts by decade in order, with unknown years last and unlinked", () => {
    const slices = breakdown(rows, "decade", "GBP");
    expect(slices.map((s) => [s.key, s.count, s.priced, s.value_minor])).toEqual([
      ["1960s", 1, 0, 0],
      ["1970s", 3, 2, 4000],
      ["Unknown year", 1, 1, 500],
    ]);
    expect(slices[1]!.selection).toEqual({ decade: "1970s" });
    expect(slices[2]!.selection).toBeNull();
    expect(slices.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1);
    expect(slices[1]!.share).toBeCloseTo(4000 / 4500);
  });

  it("keeps formats and grades in their own order", () => {
    expect(breakdown(rows, "kind", "GBP").map((s) => s.key)).toEqual(["LP", '7"', "Unknown"]);
    expect(breakdown(rows, "grade", "GBP").map((s) => s.key)).toEqual(["M", "NM", "VG+", "VG"]);
    expect(breakdown(rows, "grade", "GBP").find((s) => s.key === "VG+")).toMatchObject({ count: 2, value_minor: 3500, selection: { grade: "VG+" } });
  });

  it("ranks open sets by value and folds the tail into Others", () => {
    expect(breakdown(rows, "artist", "GBP").map((s) => [s.key, s.value_minor])).toEqual([
      ["Abba", 4000],
      ["Zappa", 500],
      ["Beatles", 0],
    ]);
    const folded = breakdown(rows, "artist", "GBP", 1);
    expect(folded.map((s) => [s.label, s.count, s.value_minor, s.selection])).toEqual([
      ["Abba", 2, 4000, { artist: "Abba" }],
      ["Others (2)", 3, 500, null],
    ]);
    expect(breakdown(rows, "label", "GBP").find((s) => s.label === "No label")?.selection).toBeNull();
  });

  it("counts a record in every genre it carries, with shares of the whole", () => {
    const tagged = [
      gbp(1, 1000, { genres: ["Rock", "Pop"], styles: ["Indie Rock"] }),
      gbp(2, 3000, { genres: ["Rock"], styles: [] }),
      gbp(3, 1000, { genres: [], styles: [] }),
    ];
    const byGenre = breakdown(tagged, "genre", "GBP");
    expect(byGenre.map((s) => [s.key, s.count, s.value_minor, s.share, s.selection])).toEqual([
      ["Rock", 2, 4000, 0.8, { genre: "Rock" }],
      ["Pop", 1, 1000, 0.2, { genre: "Pop" }],
      ["No genre", 1, 1000, 0.2, null],
    ]);
    expect(breakdown(tagged, "style", "GBP").map((s) => s.key)).toEqual(["No style", "Indie Rock"]);
  });

  it("does not fold a tail of one", () => {
    expect(breakdown(rows, "artist", "GBP", 2).map((s) => s.key)).toEqual(["Abba", "Zappa", "Beatles"]);
  });
});

describe("how the value is spread", () => {
  it("puts each priced record in its band, edges included at the bottom", () => {
    const rows = [gbp(1, 499), gbp(2, 500), gbp(3, 999), gbp(4, 1000), gbp(5, 4999), gbp(6, 10_000), gbp(7, 250_000), gbp(8, null)];
    const bands = valueBands(rows, "GBP");
    expect(bands.map((b) => [b.label, b.count])).toEqual([
      ["Under £5", 1],
      ["£5 to £10", 2],
      ["£10 to £20", 1],
      ["£20 to £50", 1],
      ["£50 to £100", 0],
      ["£100 and over", 2],
    ]);
    expect(bands[1]!.selection).toEqual({ min: 5, max: 9.99 });
    expect(bands[5]!.selection).toEqual({ min: 100, max: null });
  });

  it("measures how much the top few hold, and the typical record", () => {
    const rows = Array.from({ length: 12 }, (_, i) => gbp(i + 1, (i + 1) * 100));
    const c = concentration([...rows, gbp(13, null)], "GBP");
    expect(c).toEqual({ priced: 12, total_minor: 7800, top: 10, top_share: 7500 / 7800, median_minor: 650, mean_minor: 650 });
    expect(concentration([gbp(1, 300), gbp(2, 100), gbp(3, 200)], "GBP")).toMatchObject({ top: 3, top_share: 1, median_minor: 200 });
    expect(concentration([], "GBP")).toEqual({ priced: 0, total_minor: 0, top: 0, top_share: 0, median_minor: null, mean_minor: null });
  });
});

describe("how prices moved and were found", () => {
  const rows = [
    gbp(1, 1000, { change_30d_minor: 50, current_method: "price_suggestion", current_num_for_sale: 12 }),
    gbp(2, 1000, { change_30d_minor: -50, current_method: "lowest_listing", current_num_for_sale: 2 }),
    gbp(3, 1000, { change_30d_minor: 0, current_method: "lowest_listing", current_num_for_sale: 0 }),
    gbp(4, null),
  ];

  it("counts risers, fallers and the rest", () => {
    expect(moves(rows)).toEqual({ rose: 1, fell: 1, flat: 1, unknown: 1 });
  });

  it("counts the methods, the copies for sale and the scarce ones", () => {
    expect(market(rows)).toEqual({ suggestion: 1, listing: 2, unpriced: 1, for_sale: 14, scarce: 2, scarce_at: 3 });
    expect(market([gbp(9, null)]).for_sale).toBeNull();
  });
});

describe("how the collection grew", () => {
  it("counts up by the day each record joined, leaving out what has gone", () => {
    const rows = [
      listedRecord({ id: 1, discogs_added_at: "2024-03-02T10:00:00.000Z" }),
      listedRecord({ id: 2, discogs_added_at: "2024-03-02T18:00:00.000Z" }),
      listedRecord({ id: 3, discogs_added_at: null, created_at: "2023-12-24T00:00:00.000Z" }),
      listedRecord({ id: 4, discogs_added_at: "2025-01-01T00:00:00.000Z", discogs_removed_at: "2025-06-01T00:00:00.000Z" }),
    ];
    expect(growth(rows)).toEqual([
      { t: Date.parse("2023-12-24T00:00:00.000Z"), count: 1, added: 1 },
      { t: Date.parse("2024-03-02T00:00:00.000Z"), count: 3, added: 2 },
    ]);
  });
});
