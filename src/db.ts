/** Thin, typed access to the three D1 tables. SQL lives here and nowhere else. */
import type { Grade } from "./grades";

export interface RecordRow {
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
  last_valued_at: string | null;
  last_valuation_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ValuationRow {
  id: number;
  record_id: number;
  valued_at: string;
  source: string;
  method: "price_suggestion" | "lowest_listing";
  currency: string;
  value_minor: number;
  lowest_listing_minor: number | null;
  num_for_sale: number | null;
  raw: string | null;
}

export interface SnapshotRow {
  id: number;
  taken_at: string;
  currency: string;
  total_minor: number;
  record_count: number;
  valued_count: number;
}

export interface CollectionSummary {
  record_count: number;
  valued_count: number;
  total_minor: number;
  last_valued_at: string | null;
}

/** The columns a client may set. Everything else is derived. */
export const EDITABLE_COLUMNS = [
  "discogs_release_id",
  "discogs_instance_id",
  "artist",
  "title",
  "label",
  "catalogue_number",
  "year",
  "country",
  "format",
  "media_condition",
  "sleeve_condition",
  "purchase_price_minor",
  "purchase_currency",
  "purchased_on",
  "notes",
] as const;

export type EditableColumn = (typeof EDITABLE_COLUMNS)[number];
export type RecordInput = Pick<RecordRow, "artist" | "title"> & Partial<Pick<RecordRow, EditableColumn>>;
export type RecordPatch = Partial<Pick<RecordRow, EditableColumn>>;

export async function insertRecord(db: D1Database, input: RecordInput, now: string): Promise<RecordRow> {
  const columns: string[] = [];
  const values: unknown[] = [];
  for (const column of EDITABLE_COLUMNS) {
    const value = input[column];
    if (value !== undefined) {
      columns.push(column);
      values.push(value);
    }
  }
  columns.push("created_at", "updated_at");
  values.push(now, now);

  const row = await db
    .prepare(`INSERT INTO records (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")}) RETURNING *`)
    .bind(...values)
    .first<RecordRow>();
  if (!row) throw new Error("Insert returned no row");
  return row;
}

export async function getRecord(db: D1Database, id: number): Promise<RecordRow | null> {
  return db.prepare("SELECT * FROM records WHERE id = ?").bind(id).first<RecordRow>();
}

export async function listRecords(
  db: D1Database,
  limit: number,
  offset: number,
): Promise<{ records: RecordRow[]; total: number }> {
  const [page, count] = await db.batch<RecordRow | { n: number }>([
    db.prepare("SELECT * FROM records ORDER BY artist COLLATE NOCASE, year, title COLLATE NOCASE LIMIT ? OFFSET ?").bind(limit, offset),
    db.prepare("SELECT COUNT(*) AS n FROM records"),
  ]);
  return {
    records: (page?.results ?? []) as RecordRow[],
    total: ((count?.results?.[0] as { n: number } | undefined)?.n) ?? 0,
  };
}

export async function updateRecord(db: D1Database, id: number, patch: RecordPatch, now: string): Promise<RecordRow | null> {
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const column of EDITABLE_COLUMNS) {
    const value = patch[column];
    if (value !== undefined) {
      assignments.push(`${column} = ?`);
      values.push(value);
    }
  }
  assignments.push("updated_at = ?");
  values.push(now, id);

  return db
    .prepare(`UPDATE records SET ${assignments.join(", ")} WHERE id = ? RETURNING *`)
    .bind(...values)
    .first<RecordRow>();
}

export async function deleteRecord(db: D1Database, id: number): Promise<boolean> {
  const result = await db.prepare("DELETE FROM records WHERE id = ?").bind(id).run();
  return result.meta.changes > 0;
}

/** Records that can be valued, the ones that have waited longest first. Never-valued records come before all others. */
export async function staleRecords(db: D1Database, limit: number): Promise<RecordRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM records
       WHERE discogs_release_id IS NOT NULL
       ORDER BY last_valued_at IS NOT NULL, last_valued_at ASC, id ASC
       LIMIT ?`,
    )
    .bind(limit)
    .all<RecordRow>();
  return results;
}

export interface NewValuation {
  record_id: number;
  valued_at: string;
  method: ValuationRow["method"];
  currency: string;
  value_minor: number;
  lowest_listing_minor: number | null;
  num_for_sale: number | null;
  raw: unknown;
}

/** Write the valuation and roll it up onto the record in one transaction. */
export async function recordValuation(db: D1Database, v: NewValuation): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO valuations (record_id, valued_at, source, method, currency, value_minor, lowest_listing_minor, num_for_sale, raw)
         VALUES (?, ?, 'discogs', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(v.record_id, v.valued_at, v.method, v.currency, v.value_minor, v.lowest_listing_minor, v.num_for_sale, JSON.stringify(v.raw)),
    db
      .prepare(
        `UPDATE records
         SET current_value_minor = ?, current_currency = ?, last_valued_at = ?, last_valuation_error = NULL, updated_at = ?
         WHERE id = ?`,
      )
      .bind(v.value_minor, v.currency, v.valued_at, v.valued_at, v.record_id),
  ]);
}

/** The job looked but found no usable price. The record keeps its last value and goes to the back of the queue. */
export async function recordValuationFailure(db: D1Database, recordId: number, reason: string, now: string): Promise<void> {
  await db
    .prepare("UPDATE records SET last_valued_at = ?, last_valuation_error = ?, updated_at = ? WHERE id = ?")
    .bind(now, reason, now, recordId)
    .run();
}

export async function listValuations(db: D1Database, recordId: number, limit: number): Promise<ValuationRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM valuations WHERE record_id = ? ORDER BY valued_at DESC, id DESC LIMIT ?")
    .bind(recordId, limit)
    .all<ValuationRow>();
  return results;
}

export async function collectionSummary(db: D1Database): Promise<CollectionSummary> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS record_count,
              COUNT(current_value_minor) AS valued_count,
              COALESCE(SUM(current_value_minor), 0) AS total_minor,
              MAX(last_valued_at) AS last_valued_at
       FROM records`,
    )
    .first<CollectionSummary>();
  return row ?? { record_count: 0, valued_count: 0, total_minor: 0, last_valued_at: null };
}

export async function writeSnapshot(db: D1Database, currency: string, now: string): Promise<SnapshotRow> {
  const summary = await collectionSummary(db);
  const row = await db
    .prepare(
      `INSERT INTO collection_snapshots (taken_at, currency, total_minor, record_count, valued_count)
       VALUES (?, ?, ?, ?, ?) RETURNING *`,
    )
    .bind(now, currency, summary.total_minor, summary.record_count, summary.valued_count)
    .first<SnapshotRow>();
  if (!row) throw new Error("Snapshot insert returned no row");
  return row;
}

export async function listSnapshots(db: D1Database, limit: number): Promise<SnapshotRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM collection_snapshots ORDER BY taken_at DESC, id DESC LIMIT ?")
    .bind(limit)
    .all<SnapshotRow>();
  return results;
}
