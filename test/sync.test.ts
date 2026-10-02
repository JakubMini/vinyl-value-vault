import { createExecutionContext, createScheduledController, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { staleRecords } from "../src/db";
import worker from "../src/index";
import { syncCollection, syncDue } from "../src/sync";
import {
  api,
  collectionItem,
  expectAllMocksUsed,
  mockCollection,
  mockCollectionPage,
  mockFields,
  mockIdentity,
  mockStats,
  mockSuggestions,
  resetDatabase,
  seedRecord,
} from "./helpers";

beforeEach(resetDatabase);
afterEach(expectAllMocksUsed);

const sync = (options: { dryRun?: boolean; forceRemovals?: boolean } = {}) => syncCollection(env, { source: "api", ...options });

interface Row {
  id: number;
  discogs_instance_id: number;
  artist: string;
  title: string;
  media_condition: string;
  sleeve_condition: string;
  notes: string | null;
  cover_image_url: string | null;
  thumb_url: string | null;
  discogs_added_at: string | null;
  discogs_removed_at: string | null;
  last_valued_at: string | null;
}

async function rows(): Promise<Row[]> {
  const { results } = await env.DB.prepare("SELECT * FROM records ORDER BY discogs_instance_id").all<Row>();
  return results;
}

async function setValue(instanceId: number, minor: number): Promise<void> {
  await env.DB.prepare("UPDATE records SET current_value_minor = ?, current_currency = 'GBP' WHERE discogs_instance_id = ?").bind(minor, instanceId).run();
}

describe("syncing the Discogs collection", () => {
  it("adds the vinyl with the grades Discogs has, and skips other formats", async () => {
    mockCollection([
      collectionItem(1, { artist: "Portishead", title: "Dummy", media: "Near Mint (NM or M-)", sleeve: "Very Good (VG)", notes: "Signed" }),
      collectionItem(2),
      collectionItem(3, { format: "CD" }),
    ]);

    const run = await sync();

    expect(run).toMatchObject({ status: "ok", source: "api", dry_run: 0, items_seen: 2, added: 2, updated: 0, unchanged: 0, removed: 0, skipped_not_vinyl: 1, note: null });
    const [dummy, other] = await rows();
    expect(dummy).toMatchObject({
      discogs_instance_id: 1,
      artist: "Portishead",
      title: "Dummy",
      media_condition: "NM",
      sleeve_condition: "VG",
      notes: "Signed",
      cover_image_url: "https://i.discogs.com/1-cover.jpg",
      thumb_url: "https://i.discogs.com/1-thumb.jpg",
      discogs_added_at: "2026-09-01T17:00:00.000Z",
      discogs_removed_at: null,
      last_valued_at: null, // the valuation cron prices it, a few records a minute
    });
    expect(other).toMatchObject({ discogs_instance_id: 2, media_condition: "VG+", sleeve_condition: "VG+", notes: null });
  });

  it("is idempotent and does not use up record ids", async () => {
    const collection = [collectionItem(1), collectionItem(2)];
    mockCollection(collection);
    await sync();
    const maxId = Math.max(...(await rows()).map((r) => r.id));

    mockCollection(collection);
    expect(await sync()).toMatchObject({ status: "ok", added: 0, updated: 0, unchanged: 2, removed: 0 });

    expect(await rows()).toHaveLength(2);
    const next = await seedRecord({ artist: "A", title: "Added by hand" });
    expect(next.id).toBe(maxId + 1);
  });

  it("refreshes what Discogs owns and never the grades, notes or purchase price set in the vault", async () => {
    mockCollection([collectionItem(1, { title: "Dummy", media: "Very Good Plus (VG+)" })]);
    await sync();
    const [record] = await rows();
    await api(`/records/${record!.id}`, { method: "PATCH", json: { media_condition: "NM", notes: "Cleaned", purchase_price_minor: 1500 } });

    mockCollection([collectionItem(1, { title: "Dummy (Remastered)", media: "Good (G)", notes: "From Discogs", cover: "https://i.discogs.com/new.jpg" })]);
    expect(await sync()).toMatchObject({ status: "ok", added: 0, updated: 1, unchanged: 0 });

    const after = await env.DB.prepare("SELECT title, cover_image_url, media_condition, notes, purchase_price_minor FROM records").first();
    expect(after).toEqual({ title: "Dummy (Remastered)", cover_image_url: "https://i.discogs.com/new.jpg", media_condition: "NM", notes: "Cleaned", purchase_price_minor: 1500 });
  });

  it("ignores Discogs' spacer image when a release has no artwork", async () => {
    mockCollection([collectionItem(1, { cover: "https://st.discogs.com/abc/images/spacer.gif" })]);
    await sync();
    expect((await rows())[0]?.cover_image_url).toBeNull();
  });

  it("flags records that left the collection, keeps them out of the total and the queue, and restores them if they return", async () => {
    mockCollection([collectionItem(1), collectionItem(2)]);
    await sync();
    await setValue(1, 2000);
    await setValue(2, 3000);

    mockCollection([collectionItem(1)]);
    expect(await sync()).toMatchObject({ status: "ok", removed: 1, unchanged: 1 });

    const [kept, gone] = await rows();
    expect(kept?.discogs_removed_at).toBeNull();
    expect(gone?.discogs_removed_at).not.toBeNull();
    const collection = (await (await api("/collection")).json()) as { total_minor: number; record_count: number };
    expect(collection).toMatchObject({ total_minor: 2000, record_count: 1 });
    expect((await staleRecords(env.DB, 10, "2100-01-01T00:00:00.000Z")).map((r) => r.discogs_instance_id)).toEqual([1]);

    mockCollection([collectionItem(1), collectionItem(2)]);
    expect(await sync()).toMatchObject({ status: "ok", updated: 1, unchanged: 1, removed: 0 });
    expect((await rows())[1]?.discogs_removed_at).toBeNull();
  });

  it("does not bring back a record deleted from the vault", async () => {
    mockCollection([collectionItem(1), collectionItem(2)]);
    await sync();
    const [unwanted] = await rows();
    expect((await api(`/records/${unwanted!.id}`, { method: "DELETE" })).status).toBe(204);

    mockCollection([collectionItem(1), collectionItem(2)]);
    expect(await sync()).toMatchObject({ status: "ok", added: 0, unchanged: 1, skipped_ignored: 1, removed: 0 });
    expect((await rows()).map((r) => r.discogs_instance_id)).toEqual([2]);
  });

  it("reports what would change on a dry run without writing anything", async () => {
    mockCollection([collectionItem(1)]);
    await sync();

    mockCollection([collectionItem(2), collectionItem(3)]);
    const run = await sync({ dryRun: true });

    expect(run).toMatchObject({ status: "ok", dry_run: 1, added: 2, removed: 1 });
    const records = await rows();
    expect(records.map((r) => [r.discogs_instance_id, r.discogs_removed_at])).toEqual([[1, null]]);
  });

  it("keeps what it read when the rate limit stops it, and flags nothing as removed", async () => {
    mockCollection([collectionItem(1), collectionItem(2)]);
    await sync();

    mockIdentity();
    mockFields();
    mockCollectionPage(1, [collectionItem(1), collectionItem(3)], { pages: 2, headers: { "X-Discogs-Ratelimit-Remaining": "2" } });
    const run = await sync();

    expect(run).toMatchObject({ status: "partial", added: 1, unchanged: 1, removed: 0 });
    expect(run.note).toContain("Stopped after 1 of 2 pages");
    expect((await rows()).map((r) => [r.discogs_instance_id, r.discogs_removed_at])).toEqual([
      [1, null],
      [2, null],
      [3, null],
    ]);
  });

  it("treats a Discogs outage mid-sync as partial", async () => {
    mockIdentity();
    mockFields();
    mockCollectionPage(1, [collectionItem(1)], { pages: 2 });
    mockCollectionPage(2, [], { pages: 2, status: 503 });

    const run = await sync();

    expect(run).toMatchObject({ status: "partial", added: 1 });
    expect(run.note).toContain("503");
  });

  it("will not flag more than a fifth of the collection without confirmation", async () => {
    const all = Array.from({ length: 10 }, (_, i) => collectionItem(i + 1));
    mockCollection(all);
    await sync();

    mockCollection(all.slice(0, 3));
    const refused = await sync();
    expect(refused).toMatchObject({ status: "ok", removed: 0 });
    expect(refused.note).toContain("7 of 10 records are no longer on Discogs");

    mockCollection(all.slice(0, 3));
    expect(await sync({ forceRemovals: true })).toMatchObject({ status: "ok", removed: 7 });
  });

  it("fails cleanly without a token", async () => {
    const run = await syncCollection({ ...env, DISCOGS_TOKEN: "" }, { source: "api" });
    expect(run).toMatchObject({ status: "failed", added: 0 });
    expect(run.note).toContain("DISCOGS_TOKEN");
  });
});

describe("the sync API", () => {
  it("runs a sync, then lists it", async () => {
    mockCollection([collectionItem(1)]);
    const res = await api("/sync/discogs?dry_run=true", { method: "POST" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok", dry_run: true, added: 1 });

    const { runs } = (await (await api("/sync/runs")).json()) as { runs: { dry_run: boolean; status: string }[] };
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ dry_run: true, status: "ok" });
  });

  it("answers 502 when Discogs rejects the token", async () => {
    mockIdentity(401);
    const res = await api("/sync/discogs", { method: "POST" });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ status: "failed", note: "Discogs 401 for /oauth/identity" });
  });

  it("rejects a malformed flag", async () => {
    expect((await api("/sync/discogs?dry_run=yes", { method: "POST" })).status).toBe(400);
  });
});

describe("when the cron syncs", () => {
  async function addRun(startedAt: string, status: string, dryRun = 0): Promise<void> {
    await env.DB.prepare("INSERT INTO sync_runs (started_at, source, dry_run, status) VALUES (?, 'cron', ?, ?)").bind(startedAt, dryRun, status).run();
  }
  const now = new Date("2026-10-02T12:00:00.000Z");
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

  it("is due when it has never run, or the last success is a day old", async () => {
    expect(await syncDue(env, now)).toBe(true);
    await addRun(hoursAgo(25), "ok");
    expect(await syncDue(env, now)).toBe(true);
    await addRun(hoursAgo(2), "ok");
    expect(await syncDue(env, now)).toBe(false);
  });

  it("waits an hour after a failed attempt, and ignores dry runs", async () => {
    await addRun(hoursAgo(30), "ok");
    await addRun(hoursAgo(0.5), "failed");
    expect(await syncDue(env, now)).toBe(false);
    await addRun(hoursAgo(0.1), "ok", 1);
    expect(await syncDue(env, new Date(now.getTime() + 3_600_000))).toBe(true);
  });

  it("is never due without a token", async () => {
    expect(await syncDue({ ...env, DISCOGS_TOKEN: "" }, now)).toBe(false);
  });

  it("syncs on the first tick of the day and prices records on the next", async () => {
    const due = await seedRecord({ artist: "Nirvana", title: "Nevermind", discogs_release_id: 249504 });
    const tick = async () => {
      const ctx = createExecutionContext();
      await worker.scheduled(createScheduledController({ cron: "* * * * *" }), env, ctx);
      await waitOnExecutionContext(ctx);
    };

    // First tick: no sync has ever run, so it syncs and makes no valuation calls.
    mockCollection([collectionItem(1)]);
    await tick();
    const runs = await env.DB.prepare("SELECT source, status, added FROM sync_runs").all();
    expect(runs.results).toEqual([{ source: "cron", status: "ok", added: 1 }]);
    expect((await env.DB.prepare("SELECT last_valued_at FROM records WHERE id = ?").bind(due.id).first())?.last_valued_at).toBeNull();

    // Next tick: the sync is fresh, so it prices records again.
    mockStats(249504, { lowest_price: { currency: "GBP", value: 18.5 }, num_for_sale: 3, blocked_from_sale: false });
    mockSuggestions(249504, { "Very Good Plus (VG+)": { currency: "GBP", value: 25 } });
    mockStats(1_000_001, { lowest_price: { currency: "GBP", value: 10 }, num_for_sale: 1, blocked_from_sale: false });
    mockSuggestions(1_000_001, { "Very Good Plus (VG+)": { currency: "GBP", value: 12 } });
    await tick();
    const valued = await env.DB.prepare("SELECT COUNT(*) AS n FROM records WHERE current_value_minor IS NOT NULL").first<{ n: number }>();
    expect(valued?.n).toBe(2);
  });
});
