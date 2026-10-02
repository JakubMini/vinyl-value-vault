import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { staleRecords } from "../src/db";
import { priceByGrade, suggestedValue } from "../src/valuation";
import { api, expectAllMocksUsed, mockStats, mockSuggestions, resetDatabase, seedRecord } from "./helpers";

beforeEach(resetDatabase);
afterEach(expectAllMocksUsed);

const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const gbp = (value: number) => ({ currency: "GBP", value });

/** A stored Discogs valuation, as the job writes it, and the record's current value and market figures set to match. */
async function priced(
  recordId: number,
  valueMinor: number,
  valuedAt: string,
  options: {
    currency?: string;
    suggestions?: Record<string, { currency: string; value: number }> | null;
    source?: string;
    method?: "price_suggestion" | "lowest_listing";
    lowest?: number | null;
    forSale?: number | null;
  } = {},
): Promise<void> {
  const currency = options.currency ?? "GBP";
  const method = options.method ?? "price_suggestion";
  const lowest = options.lowest === undefined ? 1500 : options.lowest;
  const forSale = options.forSale === undefined ? 4 : options.forSale;
  const raw = JSON.stringify({ stats: { lowest_price: null, num_for_sale: forSale }, suggestions: options.suggestions ?? null });
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO valuations (record_id, valued_at, source, method, currency, value_minor, lowest_listing_minor, num_for_sale, raw)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(recordId, valuedAt, options.source ?? "discogs", method, currency, valueMinor, lowest, forSale, raw),
    env.DB.prepare(
      `UPDATE records
       SET current_value_minor = ?, current_currency = ?, current_method = ?, current_lowest_listing_minor = ?, current_num_for_sale = ?, last_valued_at = ?
       WHERE id = ?`,
    ).bind(valueMinor, currency, method, lowest, forSale, valuedAt, recordId),
  ]);
}

interface Listed {
  id: number;
  change_30d_minor: number | null;
  gain_minor: number | null;
  current_method: string | null;
  current_lowest_listing_minor: number | null;
  current_num_for_sale: number | null;
}

async function listed(): Promise<Map<number, Listed>> {
  const body = (await (await api("/records?limit=1000")).json()) as { records: Listed[] };
  return new Map(body.records.map((r) => [r.id, r]));
}

describe("the collection list", () => {
  it("works out the change over 30 days from the price at the start of the window", async () => {
    const old = await seedRecord({ artist: "A", title: "Priced for months" });
    await priced(old.id, 2000, daysAgo(40));
    await priced(old.id, 2500, daysAgo(10));
    await priced(old.id, 3000, daysAgo(1));

    const recent = await seedRecord({ artist: "B", title: "First priced last week" });
    await priced(recent.id, 1500, daysAgo(5));
    await priced(recent.id, 1800, daysAgo(1));

    const unpriced = await seedRecord({ artist: "C", title: "Never priced" });

    const records = await listed();
    expect(records.get(old.id)?.change_30d_minor).toBe(1000);
    expect(records.get(recent.id)?.change_30d_minor).toBe(300);
    expect(records.get(unpriced.id)?.change_30d_minor).toBeNull();
  });

  it("works out gain against the purchase price only when the currencies match", async () => {
    const pounds = await seedRecord({ artist: "A", title: "Bought in pounds" });
    const dollars = await seedRecord({ artist: "B", title: "Bought in dollars" });
    await priced(pounds.id, 3000, daysAgo(1));
    await priced(dollars.id, 3000, daysAgo(1));
    await api(`/records/${pounds.id}`, { method: "PATCH", json: { purchase_price_minor: 1000, purchase_currency: "GBP" } });
    await api(`/records/${dollars.id}`, { method: "PATCH", json: { purchase_price_minor: 1000, purchase_currency: "USD" } });

    const records = await listed();
    expect(records.get(pounds.id)?.gain_minor).toBe(2000);
    expect(records.get(dollars.id)?.gain_minor).toBeNull();
  });

  it("returns a whole collection in one page, up to 1,000 records", async () => {
    expect((await api("/records?limit=1000")).status).toBe(200);
    expect((await api("/records?limit=1001")).status).toBe(400);
  });
});

describe("changing a record's media grade", () => {
  const suggestions = { "Very Good Plus (VG+)": gbp(25), "Near Mint (NM or M-)": gbp(32.5), "Good (G)": { currency: "USD", value: 9 } };

  it("re-prices it at once from the stored suggestions, and queues it for a fresh price", async () => {
    const record = await seedRecord({ artist: "Nirvana", title: "Nevermind", discogs_release_id: 249504 });
    await priced(record.id, 2500, daysAgo(2), { suggestions });
    const other = await seedRecord({ artist: "Z", title: "Never valued", discogs_release_id: 1 });

    const res = await api(`/records/${record.id}`, { method: "PATCH", json: { media_condition: "NM" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ media_condition: "NM", current_value_minor: 3250, current_value: "£32.50", last_valued_at: null });

    const regrade = await env.DB.prepare("SELECT source, method, value_minor, raw FROM valuations WHERE record_id = ? ORDER BY id DESC").bind(record.id).first();
    expect(regrade).toEqual({ source: "regrade", method: "price_suggestion", value_minor: 3250, raw: null });

    // Never-valued and just-regraded records share the front of the queue.
    const queue = (await staleRecords(env.DB, 10, daysAgo(1))).map((r) => r.id);
    expect(queue).toEqual([record.id, other.id]);
  });

  it("keeps the old value when Discogs gave no suggestion for the new grade", async () => {
    const record = await seedRecord({ artist: "A", title: "B", discogs_release_id: 2 });
    await priced(record.id, 2500, daysAgo(2), { suggestions });

    const body = await (await api(`/records/${record.id}`, { method: "PATCH", json: { media_condition: "F" } })).json();
    expect(body).toMatchObject({ media_condition: "F", current_value_minor: 2500, last_valued_at: null });
    const { n } = (await env.DB.prepare("SELECT COUNT(*) AS n FROM valuations WHERE record_id = ?").bind(record.id).first<{ n: number }>())!;
    expect(n).toBe(1);
  });

  it("ignores a suggestion in another currency, and a valuation that had no suggestions", async () => {
    const usd = await seedRecord({ artist: "A", title: "B", discogs_release_id: 3 });
    await priced(usd.id, 2500, daysAgo(2), { suggestions });
    const none = await seedRecord({ artist: "C", title: "D", discogs_release_id: 4 });
    await priced(none.id, 1850, daysAgo(2), { suggestions: null });

    expect(await (await api(`/records/${usd.id}`, { method: "PATCH", json: { media_condition: "G" } })).json()).toMatchObject({ current_value_minor: 2500 });
    expect(await (await api(`/records/${none.id}`, { method: "PATCH", json: { media_condition: "NM" } })).json()).toMatchObject({
      current_value_minor: 1850,
    });
  });

  it("uses the latest price from Discogs, not an earlier regrade", async () => {
    const record = await seedRecord({ artist: "A", title: "B", discogs_release_id: 5 });
    await priced(record.id, 2500, daysAgo(3), { suggestions });
    await api(`/records/${record.id}`, { method: "PATCH", json: { media_condition: "NM" } });
    const back = await (await api(`/records/${record.id}`, { method: "PATCH", json: { media_condition: "VG+" } })).json();
    expect(back).toMatchObject({ current_value_minor: 2500 });
  });

  it("leaves the price alone when only the sleeve grade or the notes change", async () => {
    const record = await seedRecord({ artist: "A", title: "B", discogs_release_id: 6 });
    const when = daysAgo(2);
    await priced(record.id, 2500, when, { suggestions });

    const body = await (await api(`/records/${record.id}`, { method: "PATCH", json: { sleeve_condition: "VG", notes: "Ring wear" } })).json();
    expect(body).toMatchObject({ current_value_minor: 2500, last_valued_at: when, sleeve_condition: "VG" });
  });
});

describe("the market behind a price", () => {
  it("rolls how the price was found, the cheapest copy and how many are for sale onto the record", async () => {
    const record = await seedRecord({ artist: "Nirvana", title: "Nevermind", discogs_release_id: 249504 });
    mockStats(249504, { lowest_price: gbp(18.5), num_for_sale: 2, blocked_from_sale: false });
    mockSuggestions(249504, { "Very Good Plus (VG+)": gbp(25) });
    await api(`/records/${record.id}/revalue`, { method: "POST" });
    expect((await listed()).get(record.id)).toMatchObject({ current_method: "price_suggestion", current_lowest_listing_minor: 1850, current_num_for_sale: 2 });

    mockStats(249504, { lowest_price: gbp(17), num_for_sale: 1, blocked_from_sale: false });
    mockSuggestions(249504, {});
    await api(`/records/${record.id}/revalue`, { method: "POST" });
    expect((await listed()).get(record.id)).toMatchObject({ current_method: "lowest_listing", current_lowest_listing_minor: 1700, current_num_for_sale: 1 });
  });

  it("treats a regrade as a suggestion, keeping the market figures of the price it came from", async () => {
    const record = await seedRecord({ artist: "A", title: "B", discogs_release_id: 8 });
    await priced(record.id, 1850, daysAgo(2), { suggestions: { "Near Mint (NM or M-)": gbp(32.5) }, method: "lowest_listing", lowest: 1850, forSale: 3 });

    const regraded = await (await api(`/records/${record.id}`, { method: "PATCH", json: { media_condition: "NM" } })).json();
    expect(regraded).toMatchObject({ current_value_minor: 3250, current_method: "price_suggestion", current_lowest_listing_minor: 1850, current_num_for_sale: 3 });

    // No suggestion for Fair: the value and everything about it stay as they were.
    const kept = await (await api(`/records/${record.id}`, { method: "PATCH", json: { media_condition: "F" } })).json();
    expect(kept).toMatchObject({ current_value_minor: 3250, current_method: "price_suggestion", current_lowest_listing_minor: 1850, current_num_for_sale: 3 });
  });
});

describe("reading a suggestion from a stored payload", () => {
  it("handles missing, malformed and foreign-currency payloads", () => {
    expect(suggestedValue(null, "NM", "GBP")).toBeNull();
    expect(suggestedValue("not json", "NM", "GBP")).toBeNull();
    expect(suggestedValue(JSON.stringify({ suggestions: { "Mint (M)": gbp(40) } }), "M", "GBP")).toBe(4000);
    expect(suggestedValue(JSON.stringify({ suggestions: { "Mint (M)": gbp(40) } }), "M", "EUR")).toBeNull();
  });
});

describe("a record's page", () => {
  const suggestions = { "Very Good Plus (VG+)": gbp(25), "Near Mint (NM or M-)": gbp(32.5), "Good (G)": { currency: "USD", value: 9 } };

  it("has the price history without raw payloads, the price at every grade, and a Discogs link", async () => {
    const record = await seedRecord({ artist: "Nirvana", title: "Nevermind", discogs_release_id: 249504 });
    await priced(record.id, 2400, daysAgo(3), { suggestions });
    await priced(record.id, 2500, daysAgo(1), { suggestions });

    const res = await api(`/records/${record.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      valuations: Record<string, unknown>[];
      latest_method: string;
      price_by_grade: { grade: string; value_minor: number | null }[];
      discogs_url: string;
    };
    expect(body.valuations.map((v) => v.value_minor)).toEqual([2500, 2400]);
    expect(body.valuations[0]).not.toHaveProperty("raw");
    expect(body.latest_method).toBe("price_suggestion");
    expect(body.discogs_url).toBe("https://www.discogs.com/release/249504");
    expect(body.price_by_grade).toEqual([
      { grade: "M", value_minor: null },
      { grade: "NM", value_minor: 3250 },
      { grade: "VG+", value_minor: 2500 },
      { grade: "VG", value_minor: null },
      { grade: "G+", value_minor: null },
      { grade: "G", value_minor: null },
      { grade: "F", value_minor: null },
      { grade: "P", value_minor: null },
    ]);
  });

  it("has no price ladder when Discogs gave no suggestions, or the record was never priced", async () => {
    const listing = await seedRecord({ artist: "A", title: "Priced from listings", discogs_release_id: 7 });
    await priced(listing.id, 1850, daysAgo(1), { suggestions: null });
    const never = await seedRecord({ artist: "B", title: "Never priced" });

    expect(await (await api(`/records/${listing.id}`)).json()).toMatchObject({ price_by_grade: null, latest_method: "price_suggestion" });
    expect(await (await api(`/records/${never.id}`)).json()).toMatchObject({ price_by_grade: null, latest_method: null, discogs_url: null, valuations: [] });
    expect(priceByGrade(null, "GBP")).toBeNull();
  });

  it("limits the history on request", async () => {
    const record = await seedRecord({ artist: "A", title: "B" });
    for (const d of [5, 4, 3, 2, 1]) await priced(record.id, 1000 + d, daysAgo(d));
    const body = (await (await api(`/records/${record.id}?limit=2`)).json()) as { valuations: unknown[] };
    expect(body.valuations).toHaveLength(2);
    expect((await api(`/records/${record.id}?limit=0`)).status).toBe(400);
  });

  it("knows which grade each price was for", async () => {
    const record = await seedRecord({ artist: "Nirvana", title: "Nevermind", discogs_release_id: 249504, media_condition: "VG" });
    mockStats(249504, { lowest_price: gbp(18.5), num_for_sale: 42, blocked_from_sale: false });
    mockSuggestions(249504, { "Very Good (VG)": gbp(20), "Near Mint (NM or M-)": gbp(32.5) });
    await api(`/records/${record.id}/revalue`, { method: "POST" });
    await api(`/records/${record.id}`, { method: "PATCH", json: { media_condition: "NM" } });

    const body = (await (await api(`/records/${record.id}`)).json()) as { valuations: { source: string; media_condition: string; value_minor: number }[] };
    expect(body.valuations.map((v) => [v.source, v.media_condition, v.value_minor])).toEqual([
      ["regrade", "NM", 3250],
      ["discogs", "VG", 2000],
    ]);
  });
});
