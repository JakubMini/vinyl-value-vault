import { beforeEach, describe, expect, it } from "vitest";

import { api, rawFetch, resetDatabase } from "./helpers";

describe("the HTTP API", () => {
  beforeEach(resetDatabase);

  it("answers /api/health without a key", async () => {
    const res = await rawFetch("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, service: "vinyl-value-vault" });
  });

  it("rejects everything else without the key", async () => {
    const res = await rawFetch("/api/collection");
    expect(res.status).toBe(401);
  });

  it("rejects a wrong key", async () => {
    const res = await rawFetch("/api/collection", { headers: { Authorization: "Bearer nope" } });
    expect(res.status).toBe(401);
  });

  it("creates, reads, updates and deletes a record", async () => {
    const created = await api("/records", {
      method: "POST",
      json: {
        artist: "Portishead",
        title: "Dummy",
        year: 1994,
        media_condition: "NM",
        purchase_price_minor: 2499,
        purchase_currency: "gbp",
      },
    });
    expect(created.status).toBe(201);
    const record = (await created.json()) as { id: number; sleeve_condition: string; purchase_currency: string; current_value: null };
    expect(record).toMatchObject({ artist: "Portishead", title: "Dummy", year: 1994, media_condition: "NM" });
    expect(record.sleeve_condition).toBe("VG+");
    expect(record.purchase_currency).toBe("GBP");
    expect(record.current_value).toBeNull();

    const list = (await (await api("/records")).json()) as { records: { id: number }[]; total: number };
    expect(list.total).toBe(1);
    expect(list.records[0]?.id).toBe(record.id);

    const patched = await api(`/records/${record.id}`, { method: "PATCH", json: { notes: "Original UK pressing", sleeve_condition: "VG" } });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ notes: "Original UK pressing", sleeve_condition: "VG" });

    const one = (await (await api(`/records/${record.id}`)).json()) as { valuations: unknown[] };
    expect(one.valuations).toEqual([]);

    expect((await api(`/records/${record.id}`, { method: "DELETE" })).status).toBe(204);
    expect((await api(`/records/${record.id}`)).status).toBe(404);
  });

  it("refuses a record with neither a Discogs id nor artist and title", async () => {
    const res = await api("/records", { method: "POST", json: { title: "Dummy" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Invalid request" });
  });

  it("refuses an unknown grade", async () => {
    const res = await api("/records", { method: "POST", json: { artist: "A", title: "B", media_condition: "Mint-ish" } });
    expect(res.status).toBe(400);
  });

  it("refuses an empty patch", async () => {
    const created = (await (await api("/records", { method: "POST", json: { artist: "A", title: "B" } })).json()) as { id: number };
    const res = await api(`/records/${created.id}`, { method: "PATCH", json: {} });
    expect(res.status).toBe(400);
  });

  it("reports an empty collection as worth nothing", async () => {
    const res = await api("/collection");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      currency: "GBP",
      total_minor: 0,
      total: "£0.00",
      record_count: 0,
      valued_count: 0,
      unpriced_count: 0,
      history: [],
    });
  });

  it("returns JSON for unknown routes", async () => {
    const res = await api("/nope");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("no longer answers at the old root paths", async () => {
    expect((await rawFetch("/health")).status).toBe(404);
    expect((await rawFetch("/records", { headers: { Authorization: "Bearer test-api-key" } })).status).toBe(404);
  });
});
