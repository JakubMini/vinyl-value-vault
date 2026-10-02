import { Link, useSearchParams } from "react-router";

import type { ListedRecord } from "../../src/api-types";
import { ErrorState, Loading, MoneyChange, StatusBadge, Tile, When } from "../components";
import { count, dateTime, formatMinor, plural } from "../format";
import { LineChart } from "../LineChart";
import { useCollection, useRecords, useSyncRuns } from "../queries";
import { over, RANGES, readRange, withRange } from "../range";

export function Overview() {
  const [params, setParams] = useSearchParams();
  const range = readRange(params);
  const collection = useCollection(range.days);
  const records = useRecords(range.days);
  const runs = useSyncRuns(5);

  if (collection.isPending) return <Loading />;
  if (collection.isError) return <ErrorState error={collection.error} />;

  const c = collection.data;
  const lastSync = runs.data?.find((r) => !r.dry_run);
  const inCollection = (records.data ?? []).filter((r) => r.discogs_removed_at === null);
  const moved = inCollection.filter((r) => r.change_minor !== null && r.change_minor !== 0);
  const risers = [...moved].filter((r) => r.change_minor! > 0).sort((a, b) => b.change_minor! - a.change_minor!).slice(0, 5);
  const fallers = [...moved].filter((r) => r.change_minor! < 0).sort((a, b) => a.change_minor! - b.change_minor!).slice(0, 5);
  const marketMove = inCollection.reduce((sum, r) => sum + (r.change_minor ?? 0), 0);
  const withPurchase = inCollection.filter((r) => r.gain_minor !== null);
  const gain = withPurchase.reduce((sum, r) => sum + r.gain_minor!, 0);

  return (
    <section className="stack">
      <div className="hero">
        <div className="hero-label">What the collection is worth</div>
        <div className="hero-value">{c.total}</div>
        <p className="muted">
          {c.unpriced_count > 0
            ? `${count(c.valued_count)} of ${plural(c.record_count, "record")} priced so far. The rest are waiting for Discogs.`
            : `All ${plural(c.record_count, "record")} priced.`}{" "}
          {c.last_valued_at ? (
            <>
              Latest price <When iso={c.last_valued_at} />.
            </>
          ) : null}
        </p>
      </div>

      <div className="tiles">
        <Tile label="Records" value={count(c.record_count)} to="/collection" />
        <Tile label="Waiting for a price" value={count(c.unpriced_count)} to="/collection?status=waiting" />
        <Tile
          label={`Price moves, ${range.period}`}
          value={records.data ? <MoneyChange minor={marketMove} currency={c.currency} /> : "…"}
          detail="From price changes, not additions"
          to={`/collection?${new URLSearchParams(withRange(new URLSearchParams({ move: "up", sort: "change", dir: "desc" }), range))}`}
        />
        <Tile
          label="Gain on what I paid"
          value={records.data ? withPurchase.length > 0 ? <MoneyChange minor={gain} currency={c.currency} /> : "—" : "…"}
          detail={withPurchase.length > 0 ? `Across ${plural(withPurchase.length, "record")} with a price paid` : "Add what you paid on a record's page"}
        />
      </div>

      <div className="card">
        <div className="row-between">
          <h2 className="card-title">Value over time</h2>
          <div className="segmented" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                aria-pressed={r === range}
                onClick={() => setParams((prev) => withRange(prev, r))}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
        {c.daily.length === 0 ? (
          <p className="muted">The chart starts with the first price.</p>
        ) : (
          <div className={collection.isFetching ? "refetching" : undefined}>
            <LineChart
              points={c.daily.map((d) => ({ t: Date.parse(d.taken_at), value: d.total_minor, d }))}
              label={`Collection value, ${range.value === "all" ? "all time" : `last ${range.period}`}`}
              formatValue={(v) => formatMinor(v, c.currency)}
              formatTime={(t) => dateTime(new Date(t).toISOString())}
              describe={(p) => <span>{`${count(p.d.valued_count)} of ${count(p.d.record_count)} priced`}</span>}
            />
            {c.daily.length < 2 ? <p className="muted small">One point a day; the line grows as the days go by.</p> : null}
          </div>
        )}
      </div>

      <div className="split">
        <Movers title={`Risers, ${range.period}`} records={risers} empty={`Nothing has gone up ${over(range)}.`} />
        <Movers title={`Fallers, ${range.period}`} records={fallers} empty={`Nothing has gone down ${over(range)}.`} />
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

function Movers({ title, records, empty }: { title: string; records: ListedRecord[]; empty: string }) {
  return (
    <div className="card">
      <h2 className="card-title">{title}</h2>
      {records.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="movers">
          {records.map((r) => (
            <li key={r.id}>
              {r.thumb_url ? <img src={r.thumb_url} alt="" width={36} height={36} className="thumb" /> : <span className="thumb" />}
              <Link to={`/records/${r.id}`} className="movers-name">
                <span className="record-title">{r.title}</span>
                <span className="record-sub">{r.artist}</span>
              </Link>
              <MoneyChange minor={r.change_minor} currency={r.current_currency} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
