/**
 * Keeping the vault in step with the Discogs collection.
 *
 * Discogs owns what a pressing is: artist, title, label, year, format, artwork. The vault owns
 * what I say about my copy: grades, notes, purchase price. So a sync adds new items (taking
 * whatever grades Discogs has for them), refreshes the Discogs-owned details of items already
 * here, and never touches anything else. Items that have left the collection are flagged, not
 * deleted, so their price history survives; items deleted from the vault on purpose stay gone.
 *
 * Cost: 2 + ceil(items / 100) Discogs calls and about two D1 statements per page, well inside
 * the free plan's 50 subrequests per invocation. The cron runs it once a day, in place of that
 * minute's valuation batch, and the API runs it on demand.
 */
import {
  type LinkedRecord,
  type SyncCounts,
  type SyncRunRow,
  DISCOGS_OWNED_COLUMNS,
  finishSyncRun,
  lastSyncTimes,
  loadSyncState,
  markRecordsRemoved,
  startSyncRun,
  writeCollectionPage,
} from "./db";
import { DiscogsError } from "./discogs";
import { type ImportedRecord, collectionFieldIds, collectionItemToRecord, isVinyl } from "./release";
import { discogsFromEnv } from "./valuation";

/** A successful sync is good for this long. */
export const SYNC_EVERY_HOURS = 24;
/** After a failed or partial sync, wait this long before the cron tries again, so valuations keep running. */
export const SYNC_RETRY_AFTER_HOURS = 1;
/**
 * A sync that would flag more than a fifth of the collection as gone (and more than a handful
 * of records) stops and asks for confirmation. A half-empty answer from Discogs should not be
 * able to empty the vault.
 */
const REMOVAL_GUARD_SHARE = 0.2;
const REMOVAL_GUARD_MIN = 5;

export interface SyncOptions {
  source: SyncRunRow["source"];
  dryRun?: boolean;
  forceRemovals?: boolean;
  now?: Date;
}

/** Should this cron tick sync instead of pricing records? */
export async function syncDue(env: Env, now: Date): Promise<boolean> {
  if (!env.DISCOGS_TOKEN) return false;
  const { last_ok, last_attempt } = await lastSyncTimes(env.DB);
  const hoursSince = (iso: string) => (now.getTime() - Date.parse(iso)) / 3_600_000;
  return (
    (last_ok === null || hoursSince(last_ok) >= SYNC_EVERY_HOURS) &&
    (last_attempt === null || hoursSince(last_attempt) >= SYNC_RETRY_AFTER_HOURS)
  );
}

function differs(existing: LinkedRecord, incoming: ImportedRecord): boolean {
  return existing.discogs_removed_at !== null || DISCOGS_OWNED_COLUMNS.some((c) => (existing[c] ?? null) !== (incoming[c] ?? null));
}

/**
 * Sync the vault with the Discogs collection behind DISCOGS_TOKEN. Never throws: the outcome,
 * including a failure, is written to sync_runs and returned.
 *
 * - ok:      every page was read; removals were decided.
 * - partial: stopped early (rate limit or a transient Discogs error). What was read is saved;
 *            nothing is flagged as removed, because an unread page is not an empty one.
 * - failed:  nothing could be done, for example a missing or rejected token.
 */
export async function syncCollection(env: Env, options: SyncOptions): Promise<SyncRunRow> {
  const now = (options.now ?? new Date()).toISOString();
  const dryRun = options.dryRun ?? false;
  const runId = await startSyncRun(env.DB, { started_at: now, source: options.source, dry_run: dryRun });

  const counts: SyncCounts = { items_seen: 0, added: 0, updated: 0, unchanged: 0, removed: 0, skipped_not_vinyl: 0, skipped_ignored: 0 };
  let status: "ok" | "partial" | "failed" = "ok";
  let note: string | null = null;

  try {
    const discogs = discogsFromEnv(env);
    if (!discogs.hasToken) throw new Error("DISCOGS_TOKEN is not set, so the collection cannot be read");

    const { linked, ignored } = await loadSyncState(env.DB);
    const byInstance = new Map(linked.map((r) => [r.discogs_instance_id, r]));
    const seen = new Set<number>();

    const { username } = await discogs.getIdentity();
    const fields = collectionFieldIds((await discogs.getCollectionFields(username)).fields);

    for (let page = 1, pages = 1; page <= pages; page++) {
      if (discogs.rateLimitRemaining !== null && discogs.rateLimitRemaining < 3) {
        status = "partial";
        note = `Stopped after ${page - 1} of ${pages} pages: Discogs rate limit nearly exhausted`;
        break;
      }

      const body = await discogs.getCollectionPage(username, page);
      pages = body.pagination.pages;

      const fresh: ImportedRecord[] = [];
      const changed: ImportedRecord[] = [];
      for (const item of body.releases) {
        if (!isVinyl(item)) {
          counts.skipped_not_vinyl++;
          continue;
        }
        if (seen.has(item.instance_id)) continue; // the collection shifted between pages
        seen.add(item.instance_id);
        counts.items_seen++;
        if (ignored.has(item.instance_id)) {
          counts.skipped_ignored++;
          continue;
        }

        const incoming = collectionItemToRecord(item, fields);
        const existing = byInstance.get(item.instance_id);
        if (!existing) fresh.push(incoming);
        else if (differs(existing, incoming)) changed.push(incoming);
        else counts.unchanged++;
      }

      if (dryRun) {
        counts.added += fresh.length;
        counts.updated += changed.length;
      } else {
        const written = await writeCollectionPage(env.DB, fresh, changed, now);
        counts.added += written.inserted;
        counts.updated += written.updated;
      }
    }

    if (status === "ok") {
      const active = linked.filter((r) => r.discogs_removed_at === null);
      const gone = active.filter((r) => !seen.has(r.discogs_instance_id)).map((r) => r.discogs_instance_id);
      if (gone.length > 0 && seen.size === 0) {
        note = "Discogs returned an empty collection, so nothing was flagged as removed";
      } else if (gone.length > REMOVAL_GUARD_MIN && gone.length > active.length * REMOVAL_GUARD_SHARE && !options.forceRemovals) {
        note = `${gone.length} of ${active.length} records are no longer on Discogs. That is more than a fifth, so none were flagged; sync again with force_removals=true to confirm`;
      } else if (gone.length > 0) {
        counts.removed = dryRun ? gone.length : await markRecordsRemoved(env.DB, gone, now);
      }
    }
  } catch (error) {
    if (error instanceof DiscogsError && error.isTransient) {
      status = "partial";
      note = `Stopped early: ${error.message}`;
    } else {
      status = "failed";
      note = error instanceof Error ? error.message : String(error);
    }
  }

  const run = await finishSyncRun(env.DB, runId, { ...counts, finished_at: new Date().toISOString(), status, note });
  const log = JSON.stringify({ event: "sync.run", ...run });
  if (status === "failed") console.error(log);
  else console.log(log);
  return run;
}
