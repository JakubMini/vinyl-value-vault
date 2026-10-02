/**
 * The HTTP API, served under /api so the rest of the hostname is free for the dashboard.
 * Everything except /api/health needs either `Authorization: Bearer <API_KEY>` (scripts, tests,
 * local development) or a Cloudflare Access login (the dashboard in a browser).
 * Amounts are integers in minor units; a formatted string is included for convenience.
 */
import { type Context, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { timingSafeEqual } from "hono/utils/buffer";
import { validator } from "hono/validator";
import { z } from "zod";

import { AccessUnavailable, verifyAccessJwt } from "./access";
import type { ApiRecord, CollectionResponse, ListedRecord, QueueResponse, RecordDetail, RecordsPage, SyncRun } from "./api-types";
import {
  type ListedRecordRow,
  type RecordInput,
  type RecordRow,
  type SyncRunRow,
  collectionSummary,
  dailyTotals,
  deleteRecord,
  getRecord,
  insertRecord,
  latestDiscogsValuation,
  listRecords,
  listSnapshots,
  listSyncRuns,
  listValuations,
  queueForValuation,
  updateRecord,
} from "./db";
import { DiscogsError } from "./discogs";
import { GRADES } from "./grades";
import { releaseToRecordFields } from "./release";
import { formatMinor } from "./money";
import { spotifyAlbumId } from "./spotify";
import { syncCollection } from "./sync";
import { discogsFromEnv, priceByGrade, regrade, runValuationBatch, storedSuggestionState, valueRecord } from "./valuation";

const grade = z.enum(GRADES);

/** A Spotify album as a link, a URI or a bare id. Stored as the id. */
const spotifyAlbum = z.string().transform((value, ctx) => {
  const id = spotifyAlbumId(value);
  if (id) return id;
  ctx.addIssue({ code: "custom", message: "Use a Spotify album link, such as https://open.spotify.com/album/…" });
  return z.NEVER;
});

const recordFields = z.object({
  discogs_release_id: z.number().int().positive().nullable(),
  discogs_instance_id: z.number().int().positive().nullable(),
  artist: z.string().trim().min(1),
  title: z.string().trim().min(1),
  label: z.string().trim().nullable(),
  catalogue_number: z.string().trim().nullable(),
  year: z.number().int().min(1900).max(2100).nullable(),
  country: z.string().trim().nullable(),
  format: z.string().trim().nullable(),
  media_condition: grade,
  sleeve_condition: grade,
  purchase_price_minor: z.number().int().nonnegative().nullable(),
  purchase_currency: z.string().trim().length(3).toUpperCase().nullable(),
  purchased_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").nullable(),
  notes: z.string().nullable(),
  spotify_album_id: spotifyAlbum.nullable(),
});

const createRecordSchema = recordFields
  .partial()
  .refine((b) => Boolean(b.discogs_release_id) || Boolean(b.artist && b.title), {
    message: "Provide a discogs_release_id, or both artist and title",
  });

const patchRecordSchema = recordFields.partial().refine((b) => Object.keys(b).length > 0, { message: "Nothing to update" });

const queueSchema = z.object({ ids: z.array(z.number().int().positive()).min(1).max(1000) });

const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// A personal collection fits in one page, so the dashboard can sort and filter it in the browser.
// change_days is the window each record's change covers; 30 is what change_30d_minor has always been.
const recordsPageSchema = pageSchema.extend({
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  change_days: z.coerce.number().int().min(1).max(3650).default(30),
});

const DAY_MS = 86_400_000;

// Thirty days of daily totals by default; up to ten years on request.
const collectionSchema = z.object({ days: z.coerce.number().int().min(1).max(3650).default(30) });

// A year of daily prices by default; more on request.
const historySchema = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(365) });

const flag = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => v === "true");

const syncSchema = z.object({ dry_run: flag, force_removals: flag });

const syncRunsSchema = z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) });

/** Validate part of a request with a Zod schema. A failure is a 400 that lists the problems. */
function validate<U extends "json" | "query", S extends z.ZodType>(target: U, schema: S) {
  return validator(target, (value, c) => {
    const result = schema.safeParse(value);
    if (!result.success) return c.json({ error: "Invalid request", issues: result.error.issues }, 400);
    return result.data as z.output<S>;
  });
}

/** A JSON array of strings as stored, or an empty list for null, malformed or anything else. */
function readList(text: string | null): string[] {
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function presentRecord(row: RecordRow): ApiRecord {
  return {
    ...row,
    genres: readList(row.genres),
    styles: readList(row.styles),
    current_value:
      row.current_value_minor !== null && row.current_currency !== null
        ? formatMinor(row.current_value_minor, row.current_currency)
        : null,
  };
}

function presentListedRecord(row: ListedRecordRow): ListedRecord {
  return { ...presentRecord(row), change_30d_minor: row.change_30d_minor, change_minor: row.change_minor, gain_minor: row.gain_minor };
}

function presentSyncRun(run: SyncRunRow): SyncRun {
  return { ...run, dry_run: run.dry_run === 1 };
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function stripUndefined<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}

export const app = new Hono<{ Bindings: Env }>().basePath("/api");

app.get("/health", (c) => c.json({ ok: true, service: "vinyl-value-vault", now: new Date().toISOString() }));

function unauthorized(c: Context) {
  c.header("WWW-Authenticate", 'Bearer realm="vinyl-value-vault"');
  return c.json({ error: "Unauthorized" }, 401);
}

// Everything below needs a credential. A Bearer key is judged on its own: right or wrong, an
// Access token alongside it changes nothing. Without one, a Cloudflare Access token is checked.
// Each path fails closed when its configuration is missing.
app.use("*", async (c, next) => {
  const presented = /^Bearer\s+(\S+)$/i.exec(c.req.header("Authorization") ?? "")?.[1];
  if (presented !== undefined) {
    // timingSafeEqual hashes both sides and compares in constant time.
    const expected = c.env.API_KEY;
    return expected && (await timingSafeEqual(expected, presented)) ? next() : unauthorized(c);
  }

  const assertion = c.req.header("Cf-Access-Jwt-Assertion");
  const teamDomain = c.env.ACCESS_TEAM_DOMAIN;
  const aud = c.env.ACCESS_AUD;
  if (assertion && teamDomain && aud) {
    try {
      if (await verifyAccessJwt(assertion, { teamDomain, aud })) return next();
    } catch (error) {
      if (!(error instanceof AccessUnavailable)) throw error;
      console.error(JSON.stringify({ event: "access.keys_unavailable", error: error.message }));
      return c.json({ error: "Cannot check the sign-in right now" }, 503);
    }
  }
  return unauthorized(c);
});

app.get("/collection", validate("query", collectionSchema), async (c) => {
  const since = new Date(Date.now() - (c.req.valid("query").days - 1) * DAY_MS).toISOString().slice(0, 10);
  const [summary, daily] = await Promise.all([collectionSummary(c.env.DB), dailyTotals(c.env.DB, since)]);
  const currency = c.env.VALUATION_CURRENCY;
  return c.json({
    currency,
    total_minor: summary.total_minor,
    total: formatMinor(summary.total_minor, currency),
    record_count: summary.record_count,
    valued_count: summary.valued_count,
    unpriced_count: summary.record_count - summary.valued_count,
    last_valued_at: summary.last_valued_at,
    daily,
  } satisfies CollectionResponse);
});

app.get("/records", validate("query", recordsPageSchema), async (c) => {
  const { limit, offset, change_days } = c.req.valid("query");
  const now = Date.now();
  const since30 = new Date(now - 30 * DAY_MS).toISOString();
  const since = change_days === 30 ? null : new Date(now - change_days * DAY_MS).toISOString();
  const { records, total } = await listRecords(c.env.DB, limit, offset, { since30, since });
  return c.json({ records: records.map(presentListedRecord), total, limit, offset, change_days } satisfies RecordsPage);
});

// ?value=false skips the immediate valuation; the cron prices the record later. Bulk imports use it
// so a burst of new records does not become a burst of Discogs calls.
app.post("/records", validate("json", createRecordSchema), async (c) => {
  const body = c.req.valid("json");
  const valueNow = c.req.query("value") !== "false";
  const now = new Date().toISOString();
  const discogs = discogsFromEnv(c.env);

  // Adding by Discogs id is enough: fetch the pressing's details to fill in the rest.
  let fromDiscogs: Partial<RecordInput> = {};
  if (body.discogs_release_id && !(body.artist && body.title)) {
    const release = await discogs.getRelease(body.discogs_release_id);
    if (release === null) return c.json({ error: `Discogs release ${body.discogs_release_id} not found` }, 422);
    fromDiscogs = releaseToRecordFields(release);
  }

  const artist = body.artist ?? fromDiscogs.artist;
  const title = body.title ?? fromDiscogs.title;
  if (!artist || !title) return c.json({ error: "Could not determine artist and title" }, 422);

  const input: RecordInput = {
    ...fromDiscogs,
    ...stripUndefined(body),
    artist,
    title,
    media_condition: body.media_condition ?? "VG+",
    sleeve_condition: body.sleeve_condition ?? "VG+",
  };

  let record: RecordRow;
  try {
    record = await insertRecord(c.env.DB, input, now);
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      return c.json({ error: `Discogs collection item ${input.discogs_instance_id} is already in the vault` }, 409);
    }
    throw error;
  }

  // Price it straight away so the caller sees a value. A failure is noted on the record, not fatal.
  if (valueNow && record.discogs_release_id !== null) {
    try {
      await valueRecord(c.env.DB, discogs, record, c.env.VALUATION_CURRENCY, now);
    } catch (error) {
      console.error(JSON.stringify({ event: "valuation.inline_failed", record_id: record.id, error: String(error) }));
    }
    record = (await getRecord(c.env.DB, record.id)) ?? record;
  }

  return c.json(presentRecord(record), 201);
});

app.get("/records/:id", validate("query", historySchema), async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid id" }, 400);
  const record = await getRecord(c.env.DB, id);
  if (!record) return c.json({ error: "Not found" }, 404);
  const [valuations, latest] = await Promise.all([
    listValuations(c.env.DB, id, c.req.valid("query").limit),
    latestDiscogsValuation(c.env.DB, id),
  ]);
  return c.json({
    ...presentRecord(record),
    valuations,
    latest_method: latest?.method ?? null,
    suggestions: latest ? storedSuggestionState(latest.raw, c.env.VALUATION_CURRENCY) : null,
    price_by_grade: latest ? priceByGrade(latest.raw, c.env.VALUATION_CURRENCY) : null,
    discogs_url: record.discogs_release_id ? `https://www.discogs.com/release/${record.discogs_release_id}` : null,
  } satisfies RecordDetail);
});

// A new media grade re-prices the record straight away from stored Discogs suggestions; see regrade().
app.patch("/records/:id", validate("json", patchRecordSchema), async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid id" }, 400);
  const existing = await getRecord(c.env.DB, id);
  if (!existing) return c.json({ error: "Not found" }, 404);

  const patch = stripUndefined(c.req.valid("json"));
  const now = new Date().toISOString();
  const { media_condition } = patch;
  const record =
    media_condition !== undefined && media_condition !== existing.media_condition
      ? await regrade(c.env.DB, existing, { ...patch, media_condition }, c.env.VALUATION_CURRENCY, now)
      : await updateRecord(c.env.DB, id, patch, now);
  if (!record) return c.json({ error: "Not found" }, 404);
  return c.json(presentRecord(record));
});

app.delete("/records/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid id" }, 400);
  const deleted = await deleteRecord(c.env.DB, id, new Date().toISOString());
  return deleted ? c.body(null, 204) : c.json({ error: "Not found" }, 404);
});

app.post("/records/:id/revalue", async (c) => {
  const id = parseId(c.req.param("id"));
  if (id === null) return c.json({ error: "Invalid id" }, 400);
  const record = await getRecord(c.env.DB, id);
  if (!record) return c.json({ error: "Not found" }, 404);
  const outcome = await valueRecord(c.env.DB, discogsFromEnv(c.env), record, c.env.VALUATION_CURRENCY, new Date().toISOString());
  const updated = (await getRecord(c.env.DB, id)) ?? record;
  return c.json({ outcome, record: presentRecord(updated) });
});

// Run a valuation batch on demand. The cron does the same thing every minute.
app.post("/valuations/run", async (c) => {
  const limit = Number(c.req.query("limit"));
  const summary = await runValuationBatch(c.env, Number.isInteger(limit) && limit > 0 ? { limit } : {});
  return c.json(summary);
});

// Queue records for a fresh price. Nothing is priced here: the valuation job takes them first,
// a batch at a time, so re-pricing the whole collection never makes more Discogs calls in one
// run than usual.
app.post("/valuations/queue", validate("json", queueSchema), async (c) => {
  const queued = await queueForValuation(c.env.DB, [...new Set(c.req.valid("json").ids)]);
  return c.json({ queued } satisfies QueueResponse);
});

app.get("/snapshots", validate("query", pageSchema), async (c) => {
  const { limit } = c.req.valid("query");
  return c.json({ snapshots: await listSnapshots(c.env.DB, limit) });
});

// Sync with the Discogs collection now. The cron does the same once a day.
// ?dry_run=true reports what would change without writing anything.
app.post("/sync/discogs", validate("query", syncSchema), async (c) => {
  const { dry_run, force_removals } = c.req.valid("query");
  const run = await syncCollection(c.env, { source: "api", dryRun: dry_run, forceRemovals: force_removals });
  return c.json(presentSyncRun(run), run.status === "failed" ? 502 : 200);
});

app.get("/sync/runs", validate("query", syncRunsSchema), async (c) => {
  const { limit } = c.req.valid("query");
  return c.json({ runs: (await listSyncRuns(c.env.DB, limit)).map(presentSyncRun) });
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  console.error(JSON.stringify({ event: "request.failed", path: c.req.path, error: error.message, stack: error.stack }));
  if (error instanceof DiscogsError) return c.json({ error: "Discogs request failed", upstream_status: error.status }, 502);
  return c.json({ error: "Internal error" }, 500);
});
