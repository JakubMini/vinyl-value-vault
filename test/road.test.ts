import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { syncCollection } from "../src/sync";
import { discogsRoad, runValuationBatch } from "../src/valuation";
import { cronTick, expectAllMocksUsed, markSyncedRecently, mockStats, mockSuggestions, resetDatabase, seedRecord } from "./helpers";

const gbp = (value: number) => ({ currency: "GBP", value });

beforeEach(resetDatabase);
afterEach(expectAllMocksUsed);

/**
 * The env as production sees it on the tunnel road. The egress binding stands in for the VPC
 * service: it notes each path that went through it, then answers with `answer`, which is the
 * global fetch (so the Discogs mocks reply, as Discogs would through a live tunnel) unless a
 * test says otherwise.
 */
function onTheTunnel(answer: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = (input, init) => fetch(input, init)) {
  const through: string[] = [];
  const egress = {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      through.push(new URL(input instanceof Request ? input.url : input).pathname);
      return answer(input, init);
    },
  };
  return { tunnelEnv: { ...env, DISCOGS_ROAD: "tunnel", DISCOGS_EGRESS: egress } as unknown as Env, through };
}

const offline = () => Promise.reject(new Error("destination_unavailable"));

describe("the road to Discogs", () => {
  it("is the pool unless DISCOGS_ROAD says tunnel", () => {
    expect(discogsRoad({ ...env, DISCOGS_ROAD: undefined })).toBe("pool");
    expect(discogsRoad({ ...env, DISCOGS_ROAD: "pool" })).toBe("pool");
    expect(discogsRoad({ ...env, DISCOGS_ROAD: "tunnel\n" })).toBe("tunnel");
    expect(discogsRoad({ ...env, DISCOGS_ROAD: "Tunnel" })).toBe("pool");
  });

  it("on the pool, prices on every fifth minute only", async () => {
    const record = await seedRecord({ artist: "Nirvana", title: "Nevermind", discogs_release_id: 249504 });
    await markSyncedRecently();
    mockStats(249504, { lowest_price: gbp(18.5), num_for_sale: 3, blocked_from_sale: false });
    mockSuggestions(249504, {});
    const lastValued = async () =>
      (await env.DB.prepare("SELECT last_valued_at FROM records WHERE id = ?").bind(record.id).first<{ last_valued_at: string | null }>())
        ?.last_valued_at;

    await cronTick(new Date("2026-10-02T06:01:00.000Z"));
    expect(await lastValued()).toBeNull(); // the mocks are still waiting: no call was made

    await cronTick(new Date("2026-10-02T06:05:00.000Z"));
    expect(await lastValued()).not.toBeNull();
  });

  it("on the tunnel, prices every minute through the egress binding, 15 records at a time", async () => {
    for (let id = 2001; id <= 2016; id++) await seedRecord({ artist: "A", title: `Release ${id}`, discogs_release_id: id });
    await markSyncedRecently();
    for (let id = 2001; id <= 2015; id++) mockStats(id, { lowest_price: gbp(10), num_for_sale: 1, blocked_from_sale: false });
    mockSuggestions(2001, { message: "You must fill out your seller settings first." }, 404);
    const { tunnelEnv, through } = onTheTunnel();

    await cronTick(new Date("2026-10-02T06:01:00.000Z"), tunnelEnv);

    const priced = await env.DB.prepare("SELECT COUNT(*) AS n FROM records WHERE last_valued_at IS NOT NULL").first<{ n: number }>();
    expect(priced?.n).toBe(15);
    // 15 stats calls and one suggestions call, every one of them through the tunnel.
    expect(through).toHaveLength(16);
    expect(through.every((path) => path.startsWith("/marketplace/"))).toBe(true);
  });

  it("when the tunnel's machine is offline, stops the run without blaming any record", async () => {
    const a = await seedRecord({ artist: "A", title: "First", discogs_release_id: 1001 });
    const b = await seedRecord({ artist: "B", title: "Second", discogs_release_id: 1002 });
    const { tunnelEnv, through } = onTheTunnel(offline);

    const summary = await runValuationBatch(tunnelEnv);

    expect(summary).toMatchObject({ road: "tunnel", considered: 2, valued: 0, errors: 0, stoppedEarly: true, rateLimitRemaining: null });
    expect(summary.reason).toContain("Could not reach Discogs");
    expect(summary.reason).toContain("destination_unavailable");
    expect(through).toEqual(["/marketplace/stats/1001"]);
    const rows = await env.DB.prepare("SELECT last_valued_at, last_valuation_error FROM records WHERE id IN (?, ?)").bind(a.id, b.id).all();
    expect(rows.results).toEqual([
      { last_valued_at: null, last_valuation_error: null },
      { last_valued_at: null, last_valuation_error: null },
    ]);
  });

  it("when the tunnel's machine is offline, a sync stops early to be retried, not failed", async () => {
    const { tunnelEnv } = onTheTunnel(offline);

    const run = await syncCollection(tunnelEnv, { source: "cron" });

    expect(run).toMatchObject({ status: "partial", items_seen: 0, added: 0 });
    expect(run.note).toContain("Could not reach Discogs for /oauth/identity");
  });
});
