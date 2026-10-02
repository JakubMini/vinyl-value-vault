import { Link } from "react-router";

import { ErrorState, Loading, StatusBadge, Tile, When } from "../components";
import { count } from "../format";
import { useCollection, useSyncRuns } from "../queries";

export function Overview() {
  const collection = useCollection();
  const runs = useSyncRuns(5);

  if (collection.isPending) return <Loading />;
  if (collection.isError) return <ErrorState error={collection.error} />;

  const c = collection.data;
  const lastSync = runs.data?.find((r) => !r.dry_run);

  return (
    <section className="stack">
      <div className="hero">
        <div className="hero-label">What the collection is worth</div>
        <div className="hero-value">{c.total}</div>
        <p className="muted">
          {c.unpriced_count > 0
            ? `${count(c.valued_count)} of ${count(c.record_count)} records priced so far. The rest are waiting for Discogs.`
            : `All ${count(c.record_count)} records priced.`}
        </p>
      </div>

      <div className="tiles">
        <Tile label="Records" value={count(c.record_count)} to="/collection" />
        <Tile label="Priced" value={count(c.valued_count)} to="/collection?status=priced" />
        <Tile label="Waiting for a price" value={count(c.unpriced_count)} to="/collection?status=waiting" />
        <Tile label="Latest price" value={c.last_valued_at ? <When iso={c.last_valued_at} /> : "Never"} />
      </div>

      <div className="card row-between">
        <div>
          <h2 className="card-title">Discogs sync</h2>
          {lastSync ? (
            <p className="muted">
              Last sync <When iso={lastSync.started_at} />: <StatusBadge status={lastSync.status} />
            </p>
          ) : (
            <p className="muted">No sync has run yet.</p>
          )}
        </div>
        <Link to="/sync" className="button">
          Open sync
        </Link>
      </div>
    </section>
  );
}
