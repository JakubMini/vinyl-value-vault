/** Thin, typed access to the D1 tables. SQL lives here and nowhere else. */
import type { Grade } from "./grades";
import type { ImportedRecord } from "./release";

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
  cover_image_url: string | null;
  thumb_url: string | null;
  discogs_added_at: string | null;
  discogs_removed_at: string | null;
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

/** A record as the collection list shows it, with two figures worked out in SQL. */
export interface ListedRecordRow extends RecordRow {
  /**
   * Current value minus the value at the start of the window: the last price on or before
   * `changeSince`, or, for a record first priced inside the window, its first price.
   */
  change_30d_minor: number | null;
  /** Current value minus purchase price, only when both are in the same currency. */
  gain_minor: number | null;
}

/**
 * The collection, alphabetical, with change and gain. Both subqueries walk the
 * valuations (record_id, valued_at) index and stop at one row, so a page costs about
 * three rows read per record.
 */
export async function listRecords(
  db: D1Database,
  limit: number,
  offset: number,
  changeSince: string,
): Promise<{ records: ListedRecordRow[]; total: number }> {
  const [page, count] = await db.batch<ListedRecordRow | { n: number }>([
    db
      .prepare(
        `SELECT r.*,
           r.current_value_minor - COALESCE(
             (SELECT v.value_minor FROM valuations v
              WHERE v.record_id = r.id AND v.currency = r.current_currency AND v.valued_at <= ?1
              ORDER BY v.valued_at DESC, v.id DESC LIMIT 1),
             (SELECT v.value_minor FROM valuations v
              WHERE v.record_id = r.id AND v.currency = r.current_currency
              ORDER BY v.valued_at ASC, v.id ASC LIMIT 1)
           ) AS change_30d_minor,
           CASE WHEN r.purchase_price_minor IS NOT NULL AND r.purchase_currency = r.current_currency
                THEN r.current_value_minor - r.purchase_price_minor END AS gain_minor
         FROM records r
         ORDER BY r.artist COLLATE NOCASE, r.year, r.title COLLATE NOCASE
         LIMIT ?2 OFFSET ?3`,
      )
      .bind(changeSince, limit, offset),
    db.prepare("SELECT COUNT(*) AS n FROM records"),
  ]);
  return {
    records: (page?.results ?? []) as ListedRecordRow[],
    total: ((count?.results?.[0] as { n: number } | undefined)?.n) ?? 0,
  };
}

/** `column = ?` pairs for the editable fields a patch sets. Column names come from EDITABLE_COLUMNS, never from input. */
function patchAssignments(patch: RecordPatch): { assignments: string[]; values: unknown[] } {
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const column of EDITABLE_COLUMNS) {
    const value = patch[column];
    if (value !== undefined) {
      assignments.push(`${column} = ?`);
      values.push(value);
    }
  }
  return { assignments, values };
}

export async function updateRecord(db: D1Database, id: number, patch: RecordPatch, now: string): Promise<RecordRow | null> {
  const { assignments, values } = patchAssignments(patch);
  assignments.push("updated_at = ?");
  values.push(now, id);

  return db
    .prepare(`UPDATE records SET ${assignments.join(", ")} WHERE id = ? RETURNING *`)
    .bind(...values)
    .first<RecordRow>();
}

/** The newest price that came from Discogs (not from a regrade), with its raw payload. */
export async function latestDiscogsValuation(db: D1Database, recordId: number): Promise<ValuationRow | null> {
  return db
    .prepare("SELECT * FROM valuations WHERE record_id = ? AND source = 'discogs' ORDER BY valued_at DESC, id DESC LIMIT 1")
    .bind(recordId)
    .first<ValuationRow>();
}

/**
 * Apply a patch that changes the media grade. With a value for the new grade (worked out from
 * stored suggestions), it is recorded as a 'regrade' valuation and becomes the current value,
 * in one transaction. Either way last_valued_at is cleared, which puts the record at the front
 * of the valuation queue so the cron confirms the price with fresh data.
 */
export async function regradeRecord(
  db: D1Database,
  id: number,
  patch: RecordPatch,
  value: { value_minor: number; currency: string; lowest_listing_minor: number | null; num_for_sale: number | null } | null,
  now: string,
): Promise<RecordRow | null> {
  const { assignments, values } = patchAssignments(patch);
  assignments.push("last_valued_at = NULL", "updated_at = ?");
  values.push(now);
  if (value) {
    assignments.push("current_value_minor = ?", "current_currency = ?", "last_valuation_error = NULL");
    values.push(value.value_minor, value.currency);
  }
  const update = db.prepare(`UPDATE records SET ${assignments.join(", ")} WHERE id = ? RETURNING *`).bind(...values, id);
  if (!value) return update.first<RecordRow>();

  const [, updated] = await db.batch<RecordRow>([
    db
      .prepare(
        `INSERT INTO valuations (record_id, valued_at, source, method, currency, value_minor, lowest_listing_minor, num_for_sale, raw)
         VALUES (?, ?, 'regrade', 'price_suggestion', ?, ?, ?, ?, NULL)`,
      )
      .bind(id, now, value.currency, value.value_minor, value.lowest_listing_minor, value.num_for_sale),
    update,
  ]);
  return updated?.results[0] ?? null;
}

/** Delete a record and its history. A record from the Discogs collection is remembered, so a sync does not bring it back. */
export async function deleteRecord(db: D1Database, id: number, now: string): Promise<boolean> {
  const [, deleted] = await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO sync_ignored (discogs_instance_id, ignored_at)
         SELECT discogs_instance_id, ? FROM records WHERE id = ? AND discogs_instance_id IS NOT NULL`,
      )
      .bind(now, id),
    db.prepare("DELETE FROM records WHERE id = ?").bind(id),
  ]);
  return (deleted?.meta.changes ?? 0) > 0;
}

/**
 * Records due a price: never looked at, or last looked at before `dueBefore`. Never-valued
 * records come first, then the ones that have waited longest. A record priced recently is
 * left alone, so once the collection is fresh the job makes no Discogs calls at all.
 */
export async function staleRecords(db: D1Database, limit: number, dueBefore: string): Promise<RecordRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM records
       WHERE discogs_release_id IS NOT NULL
         AND discogs_removed_at IS NULL
         AND (last_valued_at IS NULL OR last_valued_at < ?)
       ORDER BY last_valued_at IS NOT NULL, last_valued_at ASC, id ASC
       LIMIT ?`,
    )
    .bind(dueBefore, limit)
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
       FROM records
       WHERE discogs_removed_at IS NULL`,
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

// --- Discogs collection sync ---------------------------------------------------------------

/** What Discogs owns about a record. A sync refreshes these and never touches anything else. */
export const DISCOGS_OWNED_COLUMNS = [
  "artist",
  "title",
  "label",
  "catalogue_number",
  "year",
  "country",
  "format",
  "cover_image_url",
  "thumb_url",
  "discogs_added_at",
] as const;

/** A record that came from the Discogs collection, as much of it as a sync compares. */
export type LinkedRecord = Pick<RecordRow, "id" | "discogs_removed_at" | (typeof DISCOGS_OWNED_COLUMNS)[number]> & {
  discogs_instance_id: number;
};

/** Everything a sync needs to know up front, in one round trip. */
export async function loadSyncState(db: D1Database): Promise<{ linked: LinkedRecord[]; ignored: Set<number> }> {
  const [linked, ignored] = await db.batch<LinkedRecord | { discogs_instance_id: number }>([
    db.prepare(
      `SELECT id, discogs_instance_id, discogs_removed_at, ${DISCOGS_OWNED_COLUMNS.join(", ")}
       FROM records WHERE discogs_instance_id IS NOT NULL`,
    ),
    db.prepare("SELECT discogs_instance_id FROM sync_ignored"),
  ]);
  return {
    linked: (linked?.results ?? []) as LinkedRecord[],
    ignored: new Set((ignored?.results ?? []).map((r) => r.discogs_instance_id)),
  };
}

/**
 * Write one page of a sync: insert the new items, refresh the changed ones. Each statement
 * takes the whole page as a single JSON parameter, so a page of 100 costs two queries, not 200.
 * Plain INSERT rather than an upsert: a conflicting upsert still burns an AUTOINCREMENT id.
 */
export async function writeCollectionPage(
  db: D1Database,
  fresh: ImportedRecord[],
  changed: ImportedRecord[],
  now: string,
): Promise<{ inserted: number; updated: number }> {
  const statements: D1PreparedStatement[] = [];
  if (fresh.length > 0) {
    statements.push(
      db
        .prepare(
          `INSERT INTO records (discogs_release_id, discogs_instance_id, ${DISCOGS_OWNED_COLUMNS.join(", ")},
                               media_condition, sleeve_condition, notes, created_at, updated_at)
           SELECT j.value ->> '$.discogs_release_id', j.value ->> '$.discogs_instance_id',
                  ${DISCOGS_OWNED_COLUMNS.map((c) => `j.value ->> '$.${c}'`).join(", ")},
                  COALESCE(j.value ->> '$.media_condition', 'VG+'), COALESCE(j.value ->> '$.sleeve_condition', 'VG+'),
                  j.value ->> '$.notes', ?1, ?1
           FROM json_each(?2) AS j
           WHERE NOT EXISTS (SELECT 1 FROM records r WHERE r.discogs_instance_id = j.value ->> '$.discogs_instance_id')`,
        )
        .bind(now, JSON.stringify(fresh)),
    );
  }
  if (changed.length > 0) {
    statements.push(
      db
        .prepare(
          `UPDATE records
           SET ${DISCOGS_OWNED_COLUMNS.map((c) => `${c} = j.value ->> '$.${c}'`).join(", ")},
               discogs_removed_at = NULL, updated_at = ?1
           FROM json_each(?2) AS j
           WHERE records.discogs_instance_id = j.value ->> '$.discogs_instance_id'`,
        )
        .bind(now, JSON.stringify(changed)),
    );
  }
  if (statements.length === 0) return { inserted: 0, updated: 0 };

  const results = await db.batch(statements);
  const changes = results.map((r) => r.meta.changes);
  return {
    inserted: fresh.length > 0 ? (changes.shift() ?? 0) : 0,
    updated: changed.length > 0 ? (changes.shift() ?? 0) : 0,
  };
}

/** Flag records whose collection item has gone from Discogs. Their history stays. */
export async function markRecordsRemoved(db: D1Database, instanceIds: number[], now: string): Promise<number> {
  const result = await db
    .prepare(
      `UPDATE records SET discogs_removed_at = ?1, updated_at = ?1
       WHERE discogs_removed_at IS NULL AND discogs_instance_id IN (SELECT value FROM json_each(?2))`,
    )
    .bind(now, JSON.stringify(instanceIds))
    .run();
  return result.meta.changes;
}

export type SyncStatus = "running" | "ok" | "partial" | "failed";

export interface SyncCounts {
  items_seen: number;
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  skipped_not_vinyl: number;
  skipped_ignored: number;
}

export interface SyncRunRow extends SyncCounts {
  id: number;
  started_at: string;
  finished_at: string | null;
  source: "cron" | "api";
  dry_run: 0 | 1;
  status: SyncStatus;
  note: string | null;
}

export async function startSyncRun(
  db: D1Database,
  run: { started_at: string; source: SyncRunRow["source"]; dry_run: boolean },
): Promise<number> {
  const row = await db
    .prepare("INSERT INTO sync_runs (started_at, source, dry_run) VALUES (?, ?, ?) RETURNING id")
    .bind(run.started_at, run.source, run.dry_run ? 1 : 0)
    .first<{ id: number }>();
  if (!row) throw new Error("Sync run insert returned no row");
  return row.id;
}

export async function finishSyncRun(
  db: D1Database,
  id: number,
  result: SyncCounts & { finished_at: string; status: Exclude<SyncStatus, "running">; note: string | null },
): Promise<SyncRunRow> {
  const row = await db
    .prepare(
      `UPDATE sync_runs
       SET finished_at = ?, status = ?, note = ?, items_seen = ?, added = ?, updated = ?, unchanged = ?,
           removed = ?, skipped_not_vinyl = ?, skipped_ignored = ?
       WHERE id = ? RETURNING *`,
    )
    .bind(
      result.finished_at,
      result.status,
      result.note,
      result.items_seen,
      result.added,
      result.updated,
      result.unchanged,
      result.removed,
      result.skipped_not_vinyl,
      result.skipped_ignored,
      id,
    )
    .first<SyncRunRow>();
  if (!row) throw new Error(`Sync run ${id} vanished`);
  return row;
}

export async function listSyncRuns(db: D1Database, limit: number): Promise<SyncRunRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM sync_runs ORDER BY started_at DESC, id DESC LIMIT ?")
    .bind(limit)
    .all<SyncRunRow>();
  return results;
}

/**
 * When the last real sync succeeded and when one was last tried. The cron asks every minute,
 * so both lookups walk the started_at index and stop at the first match instead of scanning.
 */
export async function lastSyncTimes(db: D1Database): Promise<{ last_ok: string | null; last_attempt: string | null }> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT started_at FROM sync_runs WHERE dry_run = 0 AND status = 'ok' ORDER BY started_at DESC LIMIT 1) AS last_ok,
         (SELECT started_at FROM sync_runs WHERE dry_run = 0 ORDER BY started_at DESC LIMIT 1) AS last_attempt`,
    )
    .first<{ last_ok: string | null; last_attempt: string | null }>();
  return row ?? { last_ok: null, last_attempt: null };
}
