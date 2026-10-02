/**
 * The valuation job.
 *
 * Each run takes the records that have gone longest without a price and asks
 * Discogs what they are worth. For a record graded VG+ the headline value is
 * Discogs' suggested price for a VG+ copy. When suggestions are unavailable
 * (no token, or the account has no seller settings) the cheapest copy
 * currently listed is used instead, and the method is recorded so the two are
 * never confused.
 *
 * How much a run takes on depends on the road (see discogsRoad below). Discogs
 * allows 60 requests a minute per client address. On the tunnel road that
 * allowance is the vault's own, so a run prices up to 15 records. On the pool
 * road every Worker calling a Cloudflare-hosted site such as Discogs presents the
 * same address (2a06:98c0:3600::103), the allowance is usually spent by someone
 * else, and a run takes 5. Either way the job reads the rate-limit headers and
 * stops early when the window is nearly spent, and records priced within
 * VALUATION_REFRESH_HOURS are skipped, so a fresh collection costs no calls.
 */
import {
  type RecordPatch,
  type RecordRow,
  type SnapshotRow,
  latestDiscogsValuation,
  recordValuation,
  regradeRecord,
  recordValuationFailure,
  staleRecords,
  writeSnapshot,
} from "./db";
import { DiscogsClient, DiscogsError, type PriceSuggestions } from "./discogs";
import { DISCOGS_CONDITION_LABEL, GRADES, type Grade } from "./grades";
import { toMinor } from "./money";

export type ValuationOutcome =
  | { status: "valued"; recordId: number; valueMinor: number; method: "price_suggestion" | "lowest_listing" }
  | { status: "unpriced"; recordId: number; reason: string };

/** Options for one valuation. `suggestions` is shared across a batch. */
export interface ValueOptions {
  /** Set to false once Discogs has said suggestions are unavailable for this account, to save a call per record. */
  suggestions?: { available: boolean };
}

export interface BatchSummary {
  road: DiscogsRoad;
  considered: number;
  valued: number;
  unpriced: number;
  errors: number;
  stoppedEarly: boolean;
  reason?: string;
  /** Discogs' X-Discogs-Ratelimit-Remaining after the last call, or null if none was made. */
  rateLimitRemaining: number | null;
  snapshot?: SnapshotRow;
}

/**
 * The road the vault's Discogs calls take out of Cloudflare.
 *
 * - tunnel: through the DISCOGS_EGRESS VPC service and the Cloudflare Tunnel behind it, so
 *   the calls leave from the machine running the tunnel's connector and have Discogs'
 *   allowance of 60 a minute to themselves.
 * - pool:   a plain fetch, which reaches Discogs from the one client address every Worker
 *   shares (2a06:98c0:3600::103), so the allowance is nearly always spent by others.
 *
 * Set by DISCOGS_ROAD, which `npm run egress:here` and `npm run egress:pool` switch. Anything
 * other than "tunnel", including unset, is the pool: it needs nothing else to work.
 */
export type DiscogsRoad = "tunnel" | "pool";

export function discogsRoad(env: Env): DiscogsRoad {
  return env.DISCOGS_ROAD?.trim() === "tunnel" ? "tunnel" : "pool";
}

export function discogsFromEnv(env: Env): DiscogsClient {
  const egress = discogsRoad(env) === "tunnel" ? env.DISCOGS_EGRESS : undefined;
  return new DiscogsClient({
    token: env.DISCOGS_TOKEN || undefined,
    userAgent: env.DISCOGS_USER_AGENT,
    fetch: egress ? (url, init) => egress.fetch(url, init) : undefined,
  });
}

/** Records per run on each road. See VALUATION_BATCH_SIZE and VALUATION_TUNNEL_BATCH_SIZE in wrangler.jsonc. */
function batchSize(env: Env, road: DiscogsRoad): number {
  const configured = road === "tunnel" ? env.VALUATION_TUNNEL_BATCH_SIZE : env.VALUATION_BATCH_SIZE;
  return Math.max(1, Number(configured) || 5);
}

/** Value one record now. Throws DiscogsError on transient upstream failure so the caller can decide. */
export async function valueRecord(
  db: D1Database,
  discogs: DiscogsClient,
  record: RecordRow,
  currency: string,
  now: string,
  options: ValueOptions = {},
): Promise<ValuationOutcome> {
  if (record.discogs_release_id === null) {
    const reason = "No Discogs release id";
    await recordValuationFailure(db, record.id, reason, now);
    return { status: "unpriced", recordId: record.id, reason };
  }

  const releaseId = record.discogs_release_id;
  const stats = await discogs.getMarketplaceStats(releaseId, currency);
  if (stats === null) {
    const reason = `Discogs release ${releaseId} not found`;
    await recordValuationFailure(db, record.id, reason, now);
    return { status: "unpriced", recordId: record.id, reason };
  }

  // The release exists (stats answered), so a null here means the account cannot get
  // suggestions at all: no token, or seller settings missing. Stop asking for this batch.
  const share = options.suggestions ?? { available: true };
  const suggestions = share.available ? await discogs.getPriceSuggestions(releaseId) : null;
  if (suggestions === null) share.available = false;
  const suggestion = suggestions?.[DISCOGS_CONDITION_LABEL[record.media_condition]];
  const lowest = stats.lowest_price && stats.lowest_price.currency === currency ? toMinor(stats.lowest_price.value) : null;

  let value: { minor: number; method: "price_suggestion" | "lowest_listing" } | null = null;
  if (suggestion && suggestion.currency === currency) {
    value = { minor: toMinor(suggestion.value), method: "price_suggestion" };
  } else if (lowest !== null) {
    value = { minor: lowest, method: "lowest_listing" };
  }

  if (value === null) {
    const reason =
      stats.num_for_sale === 0 ? "No copies for sale and no price suggestion" : `No price in ${currency}`;
    await recordValuationFailure(db, record.id, reason, now);
    return { status: "unpriced", recordId: record.id, reason };
  }

  await recordValuation(db, {
    record_id: record.id,
    valued_at: now,
    method: value.method,
    currency,
    value_minor: value.minor,
    lowest_listing_minor: lowest,
    num_for_sale: stats.num_for_sale,
    media_condition: record.media_condition,
    raw: { stats, suggestions },
  });
  return { status: "valued", recordId: record.id, valueMinor: value.minor, method: value.method };
}

/**
 * Discogs' suggested price for a grade, read from a stored valuation's raw payload, in minor
 * units. Null when the payload has no suggestions (they were unavailable when it was fetched),
 * no entry for that grade, or an entry in another currency.
 */
export function suggestedValue(raw: string | null, grade: Grade, currency: string): number | null {
  if (!raw) return null;
  let suggestions: PriceSuggestions | null | undefined;
  try {
    suggestions = (JSON.parse(raw) as { suggestions?: PriceSuggestions | null }).suggestions;
  } catch {
    return null;
  }
  const suggestion = suggestions?.[DISCOGS_CONDITION_LABEL[grade]];
  return suggestion && suggestion.currency === currency ? toMinor(suggestion.value) : null;
}

/**
 * What a copy is worth at every grade, from a stored valuation's suggestions. Null when the
 * payload has no suggestions at all, which is the case when the price came from the cheapest
 * listing because Discogs would not give this account suggestions.
 */
export function priceByGrade(raw: string | null, currency: string): { grade: Grade; value_minor: number | null }[] | null {
  if (!raw) return null;
  try {
    if (!(JSON.parse(raw) as { suggestions?: unknown }).suggestions) return null;
  } catch {
    return null;
  }
  return GRADES.map((grade) => ({ grade, value_minor: suggestedValue(raw, grade, currency) }));
}

/**
 * Change a record's media grade and re-price it at once, without calling Discogs: every stored
 * valuation already holds Discogs' suggestions for all eight grades. If there is no suggestion
 * to use, the old value stands. Either way the record goes to the front of the valuation queue.
 */
export async function regrade(db: D1Database, record: RecordRow, patch: RecordPatch & { media_condition: Grade }, currency: string, now: string) {
  const latest = await latestDiscogsValuation(db, record.id);
  const minor = latest ? suggestedValue(latest.raw, patch.media_condition, currency) : null;
  const value =
    latest && minor !== null
      ? { value_minor: minor, currency, lowest_listing_minor: latest.lowest_listing_minor, num_for_sale: latest.num_for_sale }
      : null;
  return regradeRecord(db, record.id, patch, value, now);
}

/** One scheduled run: refresh the stalest records, then snapshot the collection total if anything changed. */
export async function runValuationBatch(env: Env, options: { limit?: number; now?: Date } = {}): Promise<BatchSummary> {
  const currency = env.VALUATION_CURRENCY;
  const road = discogsRoad(env);
  const limit = options.limit ?? batchSize(env, road);
  const nowDate = options.now ?? new Date();
  const now = nowDate.toISOString();
  const refreshHours = Math.max(0, Number(env.VALUATION_REFRESH_HOURS) || 24);
  const dueBefore = new Date(nowDate.getTime() - refreshHours * 3_600_000).toISOString();
  const discogs = discogsFromEnv(env);
  const suggestions = { available: true };

  const records = await staleRecords(env.DB, limit, dueBefore);
  const summary: BatchSummary = {
    road,
    considered: records.length,
    valued: 0,
    unpriced: 0,
    errors: 0,
    stoppedEarly: false,
    rateLimitRemaining: null,
  };

  for (const record of records) {
    // Each record costs up to two requests. Leave room rather than hit the wall.
    if (discogs.rateLimitRemaining !== null && discogs.rateLimitRemaining < 3) {
      summary.stoppedEarly = true;
      summary.reason = "Discogs rate limit nearly exhausted";
      break;
    }

    try {
      const outcome = await valueRecord(env.DB, discogs, record, currency, now, { suggestions });
      if (outcome.status === "valued") summary.valued += 1;
      else summary.unpriced += 1;
    } catch (error) {
      if (error instanceof DiscogsError && error.isTransient) {
        summary.stoppedEarly = true;
        summary.reason = error.message;
        break;
      }
      summary.errors += 1;
      await recordValuationFailure(env.DB, record.id, error instanceof Error ? error.message : String(error), now);
    }
  }

  summary.rateLimitRemaining = discogs.rateLimitRemaining;
  if (summary.valued > 0) summary.snapshot = await writeSnapshot(env.DB, currency, now);
  return summary;
}
