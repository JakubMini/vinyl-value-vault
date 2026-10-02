import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { staleRecords } from "../src/db";
import { suggestedValue } from "../src/valuation";
import { api, resetDatabase, seedRecord } from "./helpers";

beforeEach(resetDatabase);

const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const gbp = (value: number) => ({ currency: "GBP", value });

/** A stored Discogs valuation, as the job writes it, and the record's current value set to match. */
async function priced(
  recordId: number,
  valueMinor: number,
  valuedAt: string,
  options: { currency?: string; suggestions?: Record<string, { currency: string; value: number }> | null; source?: string } = {},
): Promise<void> {
  const currency = options.currency ?? "GBP";
  const raw = JSON.stringify({ stats: { lowest_price: null, num_for_sale: 4 }, suggestions: options.suggestions ?? null });
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO valuations (record_id, valued_at, source, method, currency, value_minor, lowest_listing_minor, num_for_sale, raw)
       VALUES (?, ?, ?, 'price_suggestion', ?, ?, 1500, 4, ?)`,
    ).bind(recordId, valuedAt, options.source ?? "discogs", currency, valueMinor, raw),
    env.DB.prepare("UPDATE records SET current_value_minor = ?, current_currency = ?, last_valued_at = ? WHERE id = ?").bind(
      valueMinor,
      currency,
      valuedAt,
      recordId,
    ),
  ]);
}

interface Listed {
  id: number;
  change_30d_minor: number | null;
  gain_minor: number | null;
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

describe("reading a suggestion from a stored payload", () => {
  it("handles missing, malformed and foreign-currency payloads", () => {
    expect(suggestedValue(null, "NM", "GBP")).toBeNull();
    expect(suggestedValue("not json", "NM", "GBP")).toBeNull();
    expect(suggestedValue(JSON.stringify({ suggestions: { "Mint (M)": gbp(40) } }), "M", "GBP")).toBe(4000);
    expect(suggestedValue(JSON.stringify({ suggestions: { "Mint (M)": gbp(40) } }), "M", "EUR")).toBeNull();
  });
});
