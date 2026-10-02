/**
 * The shapes the API returns, shared by the Worker (src/app.ts) and the dashboard (web/).
 * Free of Worker types on purpose: the dashboard type-checks against the DOM, not the Workers
 * runtime, so this file may import only other runtime-free modules.
 */
import type { Grade } from "./grades";

export interface ApiRecord {
  id: number;
  discogs_release_id: number | null;
  discogs_instance_id: number | null;
  artist: string;
  title: string;
  label: string | null;
  catalogue_number: string | null;
  year: number | null;
  country: string | null;
  format: string | null;
  media_condition: Grade;
  sleeve_condition: Grade;
  purchase_price_minor: number | null;
  purchase_currency: string | null;
  purchased_on: string | null;
  notes: string | null;
  current_value_minor: number | null;
  current_currency: string | null;
  /** current_value_minor formatted for people, e.g. "£25.00". */
  current_value: string | null;
  last_valued_at: string | null;
  last_valuation_error: string | null;
  cover_image_url: string | null;
  thumb_url: string | null;
  discogs_added_at: string | null;
  /** Set when the record has left the Discogs collection. */
  discogs_removed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A record in the collection list, with two figures worked out by the API. */
export interface ListedRecord extends ApiRecord {
  /** Value now minus value 30 days ago (or at its first price, if that was more recent). */
  change_30d_minor: number | null;
  /** Value now minus what was paid, when both are in the same currency. */
  gain_minor: number | null;
}

/** One price in a record's history. */
export interface ValuationPoint {
  id: number;
  record_id: number;
  valued_at: string;
  /** 'discogs' when fetched, 'regrade' when worked out from stored suggestions after a grade change. */
  source: string;
  method: "price_suggestion" | "lowest_listing";
  currency: string;
  value_minor: number;
  lowest_listing_minor: number | null;
  num_for_sale: number | null;
  media_condition: Grade | null;
}

/** A record with its price history, as the record page shows it. */
export interface RecordDetail extends ApiRecord {
  /** Newest first. */
  valuations: ValuationPoint[];
  /** How the latest price from Discogs was worked out, or null if it has never been priced. */
  latest_method: ValuationPoint["method"] | null;
  /** Discogs' suggestion for every grade, from the latest price; null when Discogs gave none. */
  price_by_grade: { grade: Grade; value_minor: number | null }[] | null;
  discogs_url: string | null;
}

export interface Snapshot {
  id: number;
  taken_at: string;
  currency: string;
  total_minor: number;
  record_count: number;
  valued_count: number;
}

/** The collection total at the end of a UTC day. */
export interface DailyTotal {
  day: string;
  taken_at: string;
  currency: string;
  total_minor: number;
  record_count: number;
  valued_count: number;
}

export interface CollectionResponse {
  currency: string;
  total_minor: number;
  total: string;
  record_count: number;
  valued_count: number;
  unpriced_count: number;
  last_valued_at: string | null;
  /** One total per day for the requested number of days, oldest first. */
  daily: DailyTotal[];
}

export interface RecordsPage {
  records: ListedRecord[];
  total: number;
  limit: number;
  offset: number;
}

export interface SyncRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  source: "cron" | "api";
  dry_run: boolean;
  status: "running" | "ok" | "partial" | "failed";
  items_seen: number;
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  skipped_not_vinyl: number;
  skipped_ignored: number;
  note: string | null;
}

export interface SyncRunsResponse {
  runs: SyncRun[];
}

export interface ApiErrorBody {
  error: string;
  issues?: unknown;
}
