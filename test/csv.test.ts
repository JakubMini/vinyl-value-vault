import { describe, expect, it } from "vitest";

import { csvCell, RECORD_CSV_COLUMNS, recordsCsv, toCsv } from "../src/csv";
import { listedRecord } from "./helpers";

describe("a CSV cell", () => {
  it.each([
    ["plain", "Dummy", "Dummy"],
    ["a comma", "Grieg, Edvard", '"Grieg, Edvard"'],
    ["a quote", 'The "White" Album', '"The ""White"" Album"'],
    ["a line break", "Line one\nLine two", '"Line one\nLine two"'],
    ["a would-be formula", "=SUM(A1:A9)", "'=SUM(A1:A9)"],
    ["a leading plus", "+44 pressing", "'+44 pressing"],
    ["a leading minus", "-Live-", "'-Live-"],
    ["a leading at", "@home", "'@home"],
    ["a guarded cell that also needs quoting", "=1,2", "\"'=1,2\""],
  ])("handles %s", (_, input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });

  it("leaves numbers as numbers and blanks as nothing", () => {
    expect(csvCell(-5)).toBe("-5");
    expect(csvCell(19.15)).toBe("19.15");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(Number.NaN)).toBe("");
  });

  it("joins rows with CRLF and ends the file with one", () => {
    expect(toCsv([["a", "b"], [1, null]])).toBe("a,b\r\n1,\r\n");
  });
});

describe("the collection as CSV", () => {
  it("has a header row and one row per record, money in pounds, links spelled out", () => {
    const r = listedRecord({
      id: 7,
      artist: "Portishead",
      title: "Dummy",
      label: "Go! Beat",
      year: 1994,
      genres: ["Electronic", "Rock"],
      styles: ["Trip Hop"],
      current_value_minor: 1915,
      current_currency: "GBP",
      change_30d_minor: -50,
      gain_minor: 915,
      purchase_price_minor: 1000,
      purchase_currency: "GBP",
      purchased_on: "2025-01-15",
      current_method: "price_suggestion",
      current_num_for_sale: 4,
      current_lowest_listing_minor: 2219,
      discogs_release_id: 2371512,
      spotify_album_id: "1ATL5GLyefJaxhQzSPVrLX",
      notes: 'Ring wear, "VG" really',
    });
    const [header, row, ...rest] = recordsCsv([r]).split("\r\n");
    expect(rest).toEqual([""]);
    expect(header!.split(",")).toEqual(RECORD_CSV_COLUMNS.map((c) => c.header));
    expect(row).toBe(
      'Portishead,Dummy,Go! Beat,,1994,,Electronic; Rock,Trip Hop,VG+,VG+,19.15,GBP,-0.5,-0.5,9.15,10,GBP,2025-01-15,suggestion,4,22.19,,,,https://www.discogs.com/release/2371512,https://open.spotify.com/album/1ATL5GLyefJaxhQzSPVrLX,"Ring wear, ""VG"" really"',
    );
  });

  it("writes an empty collection as just the header", () => {
    expect(recordsCsv([]).split("\r\n")).toHaveLength(2);
  });
});
