import { describe, expect, it } from "vitest";

import { annualisedReturn, breakdown, byYear, concentration, growth, listening, market, moves, scarcity, standing, tiers, valueBands } from "../src/insights";
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
    // Pop and "No genre" tie on value and count, so they fall back to name order.
    const byGenre = breakdown(tagged, "genre", "GBP");
    expect(byGenre.map((s) => [s.key, s.count, s.value_minor, s.share, s.selection])).toEqual([
      ["Rock", 2, 4000, 0.8, { genre: "Rock" }],
      ["No genre", 1, 1000, 0.2, null],
      ["Pop", 1, 1000, 0.2, { genre: "Pop" }],
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

describe("one record against the rest", () => {
  const rows = [gbp(1, 500), gbp(2, 1000), gbp(3, 1000), gbp(4, 4000), gbp(5, null), gbp(6, 9000, { discogs_removed_at: "2026-01-01T00:00:00.000Z" })];

  it("ranks it by value among the priced records still in the collection", () => {
    expect(standing(rows, 4, "GBP")).toEqual({ position: 1, of: 4, above: 1 });
    expect(standing(rows, 2, "GBP")).toEqual({ position: 2, of: 4, above: 1 / 3 });
    expect(standing(rows, 1, "GBP")).toEqual({ position: 4, of: 4, above: 0 });
    expect(standing(rows, 5, "GBP")).toBeNull();
    expect(standing([gbp(1, 500)], 1, "GBP")).toEqual({ position: 1, of: 1, above: 0 });
  });

  it("annualises the gain on what was paid, once it has been held a month", () => {
    const now = Date.parse("2026-10-02T00:00:00.000Z");
    const bought = (on: string, paid: number, worth: number, currency = "GBP") =>
      annualisedReturn({ purchase_price_minor: paid, purchase_currency: currency, purchased_on: on, current_value_minor: worth, current_currency: "GBP" }, now);
    expect(bought("2025-10-02", 1000, 1200)).toBeCloseTo(0.2, 5);
    expect(bought("2024-10-02", 1000, 1440)).toBeCloseTo(0.2, 2);
    expect(bought("2025-10-02", 1000, 800)).toBeCloseTo(-0.2, 5);
    expect(bought("2026-09-20", 1000, 2000)).toBeNull();
    expect(bought("2025-10-02", 1000, 1200, "USD")).toBeNull();
    expect(bought("", 1000, 1200)).toBeNull();
    expect(bought("2025-10-02", 0, 1200)).toBeNull();
  });
});

describe("tiers", () => {
  const priced = (values: number[]) => values.map((v, i) => listedRecord({ id: i + 1, current_value_minor: v, current_currency: "GBP" }));

  it("splits the value into the top tenth, the next four tenths and the bottom half", () => {
    // Ten records: one at £10, four at £2.50, five at £1. Total £25.
    const t = tiers(priced([1000, 250, 250, 250, 250, 100, 100, 100, 100, 100]), "GBP");
    expect(t.tiers.map((x) => [x.key, x.count, x.value_minor])).toEqual([
      ["top", 1, 1000],
      ["middle", 4, 1000],
      ["bottom", 5, 500],
    ]);
    expect(t.tiers[0]!.share).toBeCloseTo(0.4);
    // £10 + £2.50 = £12.50 is the first run to reach half of £25.
    expect(t.half_count).toBe(2);
  });

  it("leaves out unpriced records and copes with very few", () => {
    expect(tiers([listedRecord()], "GBP")).toEqual({ priced: 0, total_minor: 0, tiers: [], half_count: 0 });
    const one = tiers(priced([500]), "GBP");
    expect(one.tiers.map((x) => x.key)).toEqual(["top"]);
    expect(one.half_count).toBe(1);
  });
});

describe("byYear", () => {
  it("counts every year from the oldest to the newest, empty years included", () => {
    const rows = [
      listedRecord({ id: 1, year: 1970, current_value_minor: 500, current_currency: "GBP" }),
      listedRecord({ id: 2, year: 1972, current_value_minor: 300, current_currency: "GBP" }),
      listedRecord({ id: 3, year: 1972 }),
      listedRecord({ id: 4, year: null }),
    ];
    expect(byYear(rows, "GBP")).toEqual({
      years: [
        { year: 1970, count: 1, value_minor: 500 },
        { year: 1971, count: 0, value_minor: 0 },
        { year: 1972, count: 2, value_minor: 300 },
      ],
      unknown: 1,
    });
  });
});

describe("scarcity", () => {
  it("compares the typical value of records with few copies for sale against the rest", () => {
    const rows = [
      listedRecord({ id: 1, current_num_for_sale: 1, current_value_minor: 4000, current_currency: "GBP" }),
      listedRecord({ id: 2, current_num_for_sale: 3, current_value_minor: 2000, current_currency: "GBP" }),
      listedRecord({ id: 3, current_num_for_sale: 40, current_value_minor: 500, current_currency: "GBP" }),
      listedRecord({ id: 5, current_num_for_sale: 90, current_value_minor: 90_000, current_currency: "GBP" }),
      listedRecord({ id: 6, current_num_for_sale: 12, current_value_minor: 700, current_currency: "GBP" }),
      listedRecord({ id: 4, current_num_for_sale: null }),
    ];
    // The £900 record would drag an average of the rest to over £300; the median stays at £7.
    expect(scarcity(rows, "GBP")).toEqual({ at: 3, scarce: { count: 2, median_minor: 3000 }, rest: { count: 3, median_minor: 700 } });
  });
});

describe("listening", () => {
  it("counts what has been played, the value never played, and the most played first", () => {
    const rows = [
      listedRecord({ id: 1, play_count: 2, last_played_at: "2026-11-01T00:00:00.000Z", current_value_minor: 900, current_currency: "GBP" }),
      listedRecord({ id: 2, play_count: 5, last_played_at: "2026-10-01T00:00:00.000Z" }),
      listedRecord({ id: 3, play_count: 0, current_value_minor: 1200, current_currency: "GBP" }),
      listedRecord({ id: 4, play_count: 2, last_played_at: "2026-11-03T00:00:00.000Z" }),
    ];
    const l = listening(rows, "GBP");
    expect(l).toMatchObject({ records: 4, played: 3, plays: 9, unplayed_value_minor: 1200 });
    expect(l.most.map((r) => r.id)).toEqual([2, 4, 1]);
  });
});

describe("breakdown by count", () => {
  it("ranks an open set by how many records, not by value, when asked", () => {
    const rows = [
      listedRecord({ id: 1, genres: ["Jazz"], current_value_minor: 9000, current_currency: "GBP" }),
      listedRecord({ id: 2, genres: ["Rock"], current_value_minor: 100, current_currency: "GBP" }),
      listedRecord({ id: 3, genres: ["Rock"], current_value_minor: 100, current_currency: "GBP" }),
    ];
    expect(breakdown(rows, "genre", "GBP").map((s) => s.key)).toEqual(["Jazz", "Rock"]);
    expect(breakdown(rows, "genre", "GBP", 12, "count").map((s) => s.key)).toEqual(["Rock", "Jazz"]);
    expect(breakdown(rows, "sleeve", "GBP").find((s) => s.key === "VG+")?.selection).toEqual({ sleeve: "VG+" });
  });
});
