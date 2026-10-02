import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import worker from "../src/index";
import { runValuationBatch } from "../src/valuation";
import { api, expectAllMocksUsed, mockRelease, mockStats, mockSuggestions, resetDatabase, seedRecord } from "./helpers";

const NEVERMIND = 249504;
const DUMMY = 2371512;

const gbp = (value: number) => ({ currency: "GBP", value });

beforeEach(resetDatabase);
afterEach(expectAllMocksUsed);

describe("adding a record by Discogs id", () => {
  it("fills in the details from Discogs and prices it straight away", async () => {
    mockRelease(NEVERMIND, {
      id: NEVERMIND,
      title: "Nevermind",
      year: 1991,
      country: "Europe",
      artists: [{ name: "Nirvana", join: "" }],
      labels: [{ name: "DGC", catno: "DGC 24425" }],
      formats: [{ name: "Vinyl", qty: "1", descriptions: ["LP", "Album"] }],
    });
    mockStats(NEVERMIND, { lowest_price: gbp(18.5), num_for_sale: 42, blocked_from_sale: false });
    mockSuggestions(NEVERMIND, { "Very Good Plus (VG+)": gbp(25), "Near Mint (NM or M-)": gbp(32.5) });

    const res = await api("/records", { method: "POST", json: { discogs_release_id: NEVERMIND, media_condition: "VG+" } });
    expect(res.status).toBe(201);
    const record = await res.json();
    expect(record).toMatchObject({
      artist: "Nirvana",
      title: "Nevermind",
      label: "DGC",
      catalogue_number: "DGC 24425",
      year: 1991,
      country: "Europe",
      format: "LP, Album",
      current_value_minor: 2500,
      current_currency: "GBP",
      current_value: "£25.00",
      last_valuation_error: null,
    });

    const collection = await (await api("/collection")).json();
    expect(collection).toMatchObject({ total_minor: 2500, total: "£25.00", record_count: 1, valued_count: 1, unpriced_count: 0 });
  });

  it("answers 422 when the release does not exist", async () => {
    mockRelease(999999999, { message: "Release not found." }, 404);
    const res = await api("/records", { method: "POST", json: { discogs_release_id: 999999999 } });
    expect(res.status).toBe(422);
  });
});

describe("valuing a record", () => {
  it("prefers the price suggestion for the record's own grade", async () => {
    const seeded = await seedRecord({ artist: "Nirvana", title: "Nevermind", discogs_release_id: NEVERMIND, media_condition: "NM" });
    mockStats(NEVERMIND, { lowest_price: gbp(18.5), num_for_sale: 42, blocked_from_sale: false });
    mockSuggestions(NEVERMIND, { "Very Good Plus (VG+)": gbp(25), "Near Mint (NM or M-)": gbp(32.5) });

    const res = await api(`/records/${seeded.id}/revalue`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { outcome: unknown; record: { current_value_minor: number } };
    expect(body.outcome).toMatchObject({ status: "valued", valueMinor: 3250, method: "price_suggestion" });

    const detail = (await (await api(`/records/${seeded.id}`)).json()) as { valuations: { method: string; value_minor: number; lowest_listing_minor: number; num_for_sale: number }[] };
    expect(detail.valuations).toHaveLength(1);
    expect(detail.valuations[0]).toMatchObject({ method: "price_suggestion", value_minor: 3250, lowest_listing_minor: 1850, num_for_sale: 42 });
  });

  it("falls back to the cheapest listing when Discogs will not suggest a price", async () => {
    const seeded = await seedRecord({ artist: "Portishead", title: "Dummy", discogs_release_id: DUMMY });
    mockStats(DUMMY, { lowest_price: gbp(18.5), num_for_sale: 3, blocked_from_sale: false });
    mockSuggestions(DUMMY, { message: "You must have seller settings to use this resource." }, 403);

    const body = (await (await api(`/records/${seeded.id}/revalue`, { method: "POST" })).json()) as { outcome: unknown };
    expect(body.outcome).toMatchObject({ status: "valued", valueMinor: 1850, method: "lowest_listing" });
  });

  it("keeps the last value and notes why when nothing is for sale", async () => {
    const seeded = await seedRecord({ artist: "Portishead", title: "Dummy", discogs_release_id: DUMMY });
    mockStats(DUMMY, { lowest_price: gbp(20), num_for_sale: 1, blocked_from_sale: false });
    mockSuggestions(DUMMY, {});
    await api(`/records/${seeded.id}/revalue`, { method: "POST" });

    mockStats(DUMMY, { lowest_price: null, num_for_sale: 0, blocked_from_sale: false });
    mockSuggestions(DUMMY, {});
    const body = (await (await api(`/records/${seeded.id}/revalue`, { method: "POST" })).json()) as { outcome: unknown; record: unknown };
    expect(body.outcome).toMatchObject({ status: "unpriced", reason: "No copies for sale and no price suggestion" });
    expect(body.record).toMatchObject({ current_value_minor: 2000, last_valuation_error: "No copies for sale and no price suggestion" });
  });
});

describe("the scheduled valuation job", () => {
  it("values the records that have waited longest and snapshots the total", async () => {
    const fresh = await seedRecord({ artist: "Nirvana", title: "Nevermind", discogs_release_id: NEVERMIND, last_valued_at: "2026-10-01T00:00:00.000Z" });
    const never = await seedRecord({ artist: "Portishead", title: "Dummy", discogs_release_id: DUMMY });
    await seedRecord({ artist: "Unknown", title: "No Discogs id" });

    // A batch of one: the never-valued record must go first.
    mockStats(DUMMY, { lowest_price: gbp(18.5), num_for_sale: 3, blocked_from_sale: false });
    mockSuggestions(DUMMY, { "Very Good Plus (VG+)": gbp(22) });

    const first = await runValuationBatch(env, { limit: 1, now: new Date("2026-10-02T06:00:00.000Z") });
    expect(first).toMatchObject({ considered: 1, valued: 1, unpriced: 0, errors: 0, stoppedEarly: false });
    expect(first.snapshot).toMatchObject({ currency: "GBP", total_minor: 2200, record_count: 3, valued_count: 1, taken_at: "2026-10-02T06:00:00.000Z" });

    // The real scheduled handler: Nevermind was last priced over a day ago so it is due;
    // Dummy was priced this morning so it is left alone.
    mockStats(NEVERMIND, { lowest_price: gbp(18.5), num_for_sale: 42, blocked_from_sale: false });
    mockSuggestions(NEVERMIND, { "Very Good Plus (VG+)": gbp(25) });

    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: "* * * * *" }), env, ctx);
    await waitOnExecutionContext(ctx);

    const collection = (await (await api("/collection")).json()) as { total_minor: number; valued_count: number; unpriced_count: number; history: { total_minor: number }[] };
    expect(collection).toMatchObject({ total_minor: 4700, valued_count: 2, unpriced_count: 1 });
    expect(collection.history.map((s) => s.total_minor)).toEqual([4700, 2200]);

    const rows = await env.DB.prepare("SELECT id, current_value_minor FROM records WHERE id IN (?, ?) ORDER BY id").bind(fresh.id, never.id).all();
    expect(rows.results).toEqual([
      { id: fresh.id, current_value_minor: 2500 },
      { id: never.id, current_value_minor: 2200 },
    ]);

    const valuations = await env.DB.prepare("SELECT record_id, COUNT(*) AS n FROM valuations GROUP BY record_id ORDER BY record_id").all();
    expect(valuations.results).toEqual([
      { record_id: fresh.id, n: 1 },
      { record_id: never.id, n: 1 },
    ]);
  });

  it("leaves records priced within the refresh window alone", async () => {
    const now = new Date("2026-10-02T12:00:00.000Z");
    await seedRecord({ artist: "A", title: "Priced an hour ago", discogs_release_id: 1001, last_valued_at: "2026-10-02T11:00:00.000Z" });
    await seedRecord({ artist: "B", title: "Priced yesterday morning", discogs_release_id: 1002, last_valued_at: "2026-10-01T09:00:00.000Z" });
    await seedRecord({ artist: "C", title: "Never priced", discogs_release_id: 1003 });
    for (const id of [1002, 1003]) {
      mockStats(id, { lowest_price: gbp(10), num_for_sale: 1, blocked_from_sale: false });
      mockSuggestions(id, {});
    }

    const summary = await runValuationBatch(env, { now });
    expect(summary).toMatchObject({ considered: 2, valued: 2, errors: 0 });

    // Run again straight away: nothing is due, so no Discogs calls at all.
    expect(await runValuationBatch(env, { now })).toMatchObject({ considered: 0, valued: 0 });
  });

  it("stops asking for price suggestions once Discogs says the account cannot have them", async () => {
    for (const id of [1001, 1002, 1003]) {
      await seedRecord({ artist: "A", title: `Release ${id}`, discogs_release_id: id });
      mockStats(id, { lowest_price: gbp(10), num_for_sale: 1, blocked_from_sale: false });
    }
    // Only the first record gets a suggestions call. Any further one would be unmocked and fail.
    mockSuggestions(1001, { message: "You must fill out your seller settings first." }, 404);

    const summary = await runValuationBatch(env);
    expect(summary).toMatchObject({ considered: 3, valued: 3, errors: 0, stoppedEarly: false });
    const methods = await env.DB.prepare("SELECT DISTINCT method FROM valuations").all();
    expect(methods.results).toEqual([{ method: "lowest_listing" }]);
  });

  it("stops the run when Discogs starts rate limiting, leaving the rest for next time", async () => {
    const a = await seedRecord({ artist: "A", title: "First", discogs_release_id: 1001 });
    const b = await seedRecord({ artist: "B", title: "Second", discogs_release_id: 1002 });
    mockStats(1001, { message: "You are making requests too quickly." }, 429);

    const summary = await runValuationBatch(env);
    expect(summary).toMatchObject({ considered: 2, valued: 0, stoppedEarly: true });
    expect(summary.reason).toContain("429");
    expect(summary.snapshot).toBeUndefined();

    const rows = await env.DB.prepare("SELECT id, last_valued_at FROM records WHERE id IN (?, ?)").bind(a.id, b.id).all();
    expect(rows.results.every((r) => r.last_valued_at === null)).toBe(true);
  });

  it("stops early when the rate-limit headers say the window is nearly spent", async () => {
    await seedRecord({ artist: "A", title: "First", discogs_release_id: 1001 });
    await seedRecord({ artist: "B", title: "Second", discogs_release_id: 1002 });
    mockStats(1001, { lowest_price: gbp(10), num_for_sale: 1, blocked_from_sale: false }, 200, { "X-Discogs-Ratelimit-Remaining": "2" });
    mockSuggestions(1001, {});

    const summary = await runValuationBatch(env);
    expect(summary).toMatchObject({ considered: 2, valued: 1, stoppedEarly: true, reason: "Discogs rate limit nearly exhausted" });
  });
});
