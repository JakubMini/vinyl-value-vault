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
 * Why batches: the Workers free plan allows 50 external fetches per
 * invocation and Discogs allows 60 requests a minute. Twenty records at two
 * calls each fits both, and a run every five minutes gives ~5,700 refreshes a
 * day, far more than a personal collection needs.
 */
import {
  type RecordRow,
  type SnapshotRow,
  recordValuation,
  recordValuationFailure,
  staleRecords,
  writeSnapshot,
} from "./db";
import { DiscogsClient, DiscogsError } from "./discogs";
import { DISCOGS_CONDITION_LABEL } from "./grades";
import { toMinor } from "./money";

export type ValuationOutcome =
  | { status: "valued"; recordId: number; valueMinor: number; method: "price_suggestion" | "lowest_listing" }
  | { status: "unpriced"; recordId: number; reason: string };

export interface BatchSummary {
  considered: number;
  valued: number;
  unpriced: number;
  errors: number;
  stoppedEarly: boolean;
  reason?: string;
  snapshot?: SnapshotRow;
}

export function discogsFromEnv(env: Env): DiscogsClient {
  return new DiscogsClient({
    token: env.DISCOGS_TOKEN || undefined,
    userAgent: env.DISCOGS_USER_AGENT,
  });
}

/** Value one record now. Throws DiscogsError on transient upstream failure so the caller can decide. */
export async function valueRecord(
  db: D1Database,
  discogs: DiscogsClient,
  record: RecordRow,
  currency: string,
  now: string,
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

  const suggestions = await discogs.getPriceSuggestions(releaseId);
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
    raw: { stats, suggestions },
  });
  return { status: "valued", recordId: record.id, valueMinor: value.minor, method: value.method };
}

/** One scheduled run: refresh the stalest records, then snapshot the collection total if anything changed. */
export async function runValuationBatch(env: Env, options: { limit?: number; now?: Date } = {}): Promise<BatchSummary> {
  const currency = env.VALUATION_CURRENCY;
  const limit = options.limit ?? Math.max(1, Number(env.VALUATION_BATCH_SIZE) || 20);
  const now = (options.now ?? new Date()).toISOString();
  const discogs = discogsFromEnv(env);

  const records = await staleRecords(env.DB, limit);
  const summary: BatchSummary = { considered: records.length, valued: 0, unpriced: 0, errors: 0, stoppedEarly: false };

  for (const record of records) {
    // Each record costs up to two requests. Leave room rather than hit the wall.
    if (discogs.rateLimitRemaining !== null && discogs.rateLimitRemaining < 3) {
      summary.stoppedEarly = true;
      summary.reason = "Discogs rate limit nearly exhausted";
      break;
    }

    try {
      const outcome = await valueRecord(env.DB, discogs, record, currency, now);
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

  if (summary.valued > 0) summary.snapshot = await writeSnapshot(env.DB, currency, now);
  return summary;
}
