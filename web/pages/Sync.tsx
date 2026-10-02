import type { SyncRun } from "../../src/api-types";
import { ErrorState, Loading, StatusBadge, When } from "../components";
import { count } from "../format";
import { useSync, useSyncRuns } from "../queries";

export function Sync() {
  const runs = useSyncRuns();
  const sync = useSync();
  const latest = sync.data;
  const previewing = sync.isPending && sync.variables.dryRun === true;
  const needsConfirmation = latest?.note?.includes("force_removals") ?? false;

  return (
    <section className="stack">
      <div>
        <h1>Sync with Discogs</h1>
        <p className="muted measure">
          Discogs owns what each pressing is: title, artist, label, format, cover. The vault owns what you say about your copy:
          grades, notes, what you paid. A sync adds new records, refreshes the Discogs details of the rest, and flags records that
          have left your collection. It never changes a grade. The vault also syncs itself once a day.
        </p>
      </div>

      <div className="actions">
        <button type="button" className="button" disabled={sync.isPending} onClick={() => sync.mutate({ dryRun: true })}>
          {previewing ? "Previewing…" : "Preview changes"}
        </button>
        <button type="button" className="button button-primary" disabled={sync.isPending} onClick={() => sync.mutate({})}>
          {sync.isPending && !previewing ? "Syncing…" : "Sync now"}
        </button>
        {needsConfirmation && latest && !latest.dry_run ? (
          <button
            type="button"
            className="button button-danger"
            disabled={sync.isPending}
            onClick={() => sync.mutate({ forceRemovals: true })}
          >
            Sync and flag the missing records
          </button>
        ) : null}
      </div>

      {sync.isError ? <ErrorState error={sync.error} /> : null}
      {latest ? <RunResult run={latest} /> : null}

      <div>
        <h2>Recent syncs</h2>
        {runs.isPending ? <Loading /> : runs.isError ? <ErrorState error={runs.error} /> : <RunLog runs={runs.data} />}
      </div>
    </section>
  );
}

function RunResult({ run }: { run: SyncRun }) {
  const figures: [string, number][] = [
    [run.dry_run ? "Would add" : "Added", run.added],
    [run.dry_run ? "Would refresh" : "Refreshed", run.updated],
    ["Unchanged", run.unchanged],
    [run.dry_run ? "Would flag as gone" : "Flagged as gone", run.removed],
    ["Not vinyl, skipped", run.skipped_not_vinyl],
    ["Deleted here, skipped", run.skipped_ignored],
  ];
  return (
    <div className="card" aria-live="polite">
      <div className="row-between">
        <h2 className="card-title">{run.dry_run ? "Preview" : "Sync"} result</h2>
        <StatusBadge status={run.status} />
      </div>
      <dl className="figures">
        {figures.map(([label, n]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{count(n)}</dd>
          </div>
        ))}
      </dl>
      {run.note ? <p className="note">{run.note}</p> : null}
      {run.dry_run && run.status === "ok" ? <p className="muted">Nothing was written. Sync now to apply it.</p> : null}
    </div>
  );
}

function RunLog({ runs }: { runs: SyncRun[] }) {
  if (runs.length === 0) return <p className="muted">No syncs yet.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Kind</th>
            <th scope="col">Status</th>
            <th scope="col" className="num">
              Added
            </th>
            <th scope="col" className="num">
              Refreshed
            </th>
            <th scope="col" className="num">
              Gone
            </th>
            <th scope="col">Note</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>
                <When iso={run.started_at} />
              </td>
              <td>
                {run.dry_run ? "Preview" : "Sync"}, {run.source === "cron" ? "daily" : "by hand"}
              </td>
              <td>
                <StatusBadge status={run.status} />
              </td>
              <td className="num">{count(run.added)}</td>
              <td className="num">{count(run.updated)}</td>
              <td className="num">{count(run.removed)}</td>
              <td className="note-cell">{run.note ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
