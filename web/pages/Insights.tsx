import { Link, useSearchParams } from "react-router";

import type { ListedRecord } from "../../src/api-types";
import { breakdown, BREAKDOWNS, type BreakdownKey, concentration, growth, market, moves, valueBands } from "../../src/insights";
import { DEFAULT_SELECTION, type Selection, writeSelection } from "../../src/select";
import { type Bar, BarChart } from "../BarChart";
import { ErrorState, Loading, Tile } from "../components";
import { count, dateTime, formatMinor, plural } from "../format";
import { LineChart } from "../LineChart";
import { useCollection, useRecords } from "../queries";

/** The collection page narrowed to a selection. */
function collectionLink(partial: Partial<Selection>): string {
  const query = new URLSearchParams(writeSelection({ ...DEFAULT_SELECTION, ...partial })).toString();
  return query ? `/collection?${query}` : "/collection";
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

export function Insights() {
  const records = useRecords();
  const collection = useCollection();
  const [params, setParams] = useSearchParams();
  const by = BREAKDOWNS.find((b) => b.key === params.get("by")) ?? BREAKDOWNS[0]!;
  const measure = params.get("measure") === "count" ? "count" : "value";

  if (records.isPending || collection.isPending) return <Loading />;
  if (records.isError) return <ErrorState error={records.error} />;
  if (collection.isError) return <ErrorState error={collection.error} />;

  const currency = collection.data.currency;
  const rows = records.data.filter((r) => r.discogs_removed_at === null);
  const conc = concentration(rows, currency);
  const mv = moves(rows);
  const mk = market(rows);

  function choose(key: "by" | "measure", value: string, fallback: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === fallback) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  }

  return (
    <section className="stack">
      <div>
        <h1>Insights</h1>
        <p className="muted measure">
          {conc.priced === rows.length
            ? `All ${plural(rows.length, "record")} priced.`
            : `${count(conc.priced)} of ${plural(rows.length, "record")} priced; the value figures cover those.`}{" "}
          Every bar leads to the collection, narrowed to what it counts.
        </p>
      </div>

      <div className="tiles">
        <Tile
          label={`Top ${count(conc.top)} records hold`}
          value={conc.priced > 0 ? `${percent(conc.top_share)} of the value` : "—"}
          detail={conc.priced > 0 ? `${formatMinor(conc.total_minor, currency)} in all` : "Shown once records are priced"}
          to={collectionLink({ status: "priced", sort: "value", dir: "desc" })}
        />
        <Tile
          label="A typical record"
          value={conc.median_minor !== null ? formatMinor(conc.median_minor, currency) : "—"}
          detail={conc.mean_minor !== null ? `The median; the average is ${formatMinor(conc.mean_minor, currency)}` : undefined}
        />
        <Tile
          label="Price moves, 30 days"
          value={`${count(mv.rose)} rose · ${count(mv.fell)} fell`}
          detail={`${count(mv.flat)} unchanged${mv.unknown > 0 ? `, ${count(mv.unknown)} too new to say` : ""}`}
          to={collectionLink({ move: "up", sort: "change", dir: "desc" })}
        />
        <Tile
          label="Priced from"
          value={`${count(mk.suggestion)} suggestion${mk.suggestion === 1 ? "" : "s"}`}
          detail={`${count(mk.listing)} from the cheapest copy for sale${mk.unpriced > 0 ? `, ${count(mk.unpriced)} unpriced` : ""}`}
          to={collectionLink({ how: "listing" })}
        />
        <Tile
          label="Copies for sale on Discogs"
          value={mk.for_sale !== null ? count(mk.for_sale) : "—"}
          detail={`${plural(mk.scarce, "record")} with ${count(mk.scarce_at)} or fewer`}
          to={collectionLink({ scarce: true, sort: "forsale", dir: "asc" })}
        />
      </div>

      <div className="card">
        <div className="insight-head">
          <h2 className="card-title">Where the value is</h2>
          <div className="actions">
            <div className="segmented" role="group" aria-label="Cut by">
              {BREAKDOWNS.map((b) => (
                <button key={b.key} type="button" aria-pressed={b.key === by.key} onClick={() => choose("by", b.key, BREAKDOWNS[0]!.key)}>
                  {b.label}
                </button>
              ))}
            </div>
            <div className="segmented" role="group" aria-label="Measure">
              <button type="button" aria-pressed={measure === "value"} onClick={() => choose("measure", "value", "value")}>
                Value
              </button>
              <button type="button" aria-pressed={measure === "count"} onClick={() => choose("measure", "count", "value")}>
                Records
              </button>
            </div>
          </div>
        </div>
        <Breakdown rows={rows} by={by.key} measure={measure} currency={currency} />
      </div>

      <div className="split">
        <div className="card">
          <h2 className="card-title">How the values are spread</h2>
          <BarChart
            label="Records in each value band"
            format={(v) => plural(v, "record")}
            bars={valueBands(rows, currency).map((b) => ({
              key: b.key,
              label: b.label,
              value: b.count,
              detail: b.count > 0 ? formatMinor(b.value_minor, currency) : undefined,
              to: b.count > 0 && b.selection ? collectionLink({ ...b.selection, sort: "value", dir: "desc" }) : null,
            }))}
          />
        </div>
        <Growth rows={rows} />
      </div>
    </section>
  );
}

function Breakdown({ rows, by, measure, currency }: { rows: ListedRecord[]; by: BreakdownKey; measure: "value" | "count"; currency: string }) {
  const slices = breakdown(rows, by, currency);
  if (slices.length === 0) return <p className="muted">Nothing to show yet.</p>;
  const bars: Bar[] = slices.map((s) => ({
    key: s.key,
    label: s.label,
    value: measure === "value" ? s.value_minor : s.count,
    detail:
      measure === "value"
        ? [percent(s.share), plural(s.count, "record"), s.priced < s.count ? `${count(s.priced)} priced` : null].filter(Boolean).join(" · ")
        : s.priced > 0
          ? `${formatMinor(s.value_minor, currency)} · ${percent(s.share)}`
          : undefined,
    to: s.selection ? collectionLink({ ...s.selection, sort: "value", dir: "desc" }) : null,
    muted: s.selection === null,
  }));
  return (
    <>
      <BarChart label={`${measure === "value" ? "Value" : "Records"} by ${by}`} format={(v) => (measure === "value" ? formatMinor(v, currency) : count(v))} bars={bars} />
      {by === "label" || by === "artist" ? <p className="muted small">The twelve with the most value; the rest are folded into Others.</p> : null}
    </>
  );
}

function Growth({ rows }: { rows: ListedRecord[] }) {
  const points = growth(rows).map((p) => ({ t: p.t, value: p.count, p }));
  const day = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="card">
      <h2 className="card-title">How the collection grew</h2>
      {points.length === 0 ? (
        <p className="muted">Nothing to show yet.</p>
      ) : points.length === 1 ? (
        <p className="muted">
          All {plural(points[0]!.value, "record")} joined on {day(points[0]!.t)}. The line starts once records join on different days.
        </p>
      ) : (
        <>
          <LineChart
            points={points}
            label={`Records in the collection over time, from ${dateTime(new Date(points[0]!.t).toISOString())}`}
            formatValue={(v) => count(v)}
            formatTime={day}
            describe={(pt) => <span>{`${plural(pt.p.added, "record")} added that day`}</span>}
          />
          <p className="muted small">
            Counted from the day each record joined the Discogs collection. <Link to={collectionLink({ sort: "added", dir: "desc" })}>Newest first</Link>.
          </p>
        </>
      )}
    </div>
  );
}
