import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";

import type { ListedRecord } from "../../src/api-types";
import { breakdown, BREAKDOWNS, type BreakdownKey, concentration, growth, market, moves, OVERLAPPING, valueBands } from "../../src/insights";
import { type Bar, BarChart } from "../BarChart";
import { ErrorState, Loading } from "../components";
import { count, dateTime, formatMinor, plural } from "../format";
import { LineChart } from "../LineChart";
import { collectionLink } from "../links";
import { useCollection, useRecords } from "../queries";
import "../insights.css";

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
  const coverage = conc.priced < rows.length ? `${count(conc.priced)} of ${plural(rows.length, "record")} priced; the value figures cover those` : null;

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
      <h1>Insights</h1>

      <ul className="ins-figures">
        <Figure
          value={conc.priced > 0 ? percent(conc.top_share) : "—"}
          label={`of the value in the top ${count(conc.top)}`}
          title={conc.priced > 0 ? [`${formatMinor(conc.total_minor, currency)} in all`, coverage].filter(Boolean).join(". ") : "Shown once records are priced"}
          to={collectionLink({ status: "priced", sort: "value", dir: "desc" })}
        />
        <Figure
          value={conc.median_minor !== null ? formatMinor(conc.median_minor, currency) : "—"}
          label="a typical record"
          title={conc.mean_minor !== null ? `The median; the average is ${formatMinor(conc.mean_minor, currency)}` : undefined}
        />
        <Figure
          value={`${count(mv.rose)} rose · ${count(mv.fell)} fell`}
          label="price moves, 30 days"
          title={`${count(mv.flat)} unchanged${mv.unknown > 0 ? `, ${count(mv.unknown)} too new to say` : ""}`}
          to={collectionLink({ move: "up", sort: "change", dir: "desc" })}
        />
        <Figure
          value={count(mk.suggestion)}
          label="priced by suggestion"
          title={`${count(mk.listing)} from the cheapest copy for sale${mk.unpriced > 0 ? `, ${count(mk.unpriced)} unpriced` : ""}`}
          to={collectionLink({ how: "listing" })}
        />
        <Figure
          value={mk.for_sale !== null ? count(mk.for_sale) : "—"}
          label="copies for sale on Discogs"
          title={`${plural(mk.scarce, "record")} with ${count(mk.scarce_at)} or fewer`}
          to={collectionLink({ scarce: true, sort: "forsale", dir: "asc" })}
        />
      </ul>

      <div className="card">
        <div className="insight-head">
          <h2 className="card-title">Where the value is</h2>
          <div className="actions">
            <div className="segmented" role="group" aria-label="Cut by">
              {BREAKDOWNS.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  aria-pressed={b.key === by.key}
                  title={OVERLAPPING.includes(b.key) ? `A record with two ${b.key}s counts in both, so the shares can add up to more than the whole` : undefined}
                  onClick={() => choose("by", b.key, BREAKDOWNS[0]!.key)}
                >
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

/** One figure in the row at the top: the number first, a short label under it, the rest on hover. */
function Figure({ value, label, title, to }: { value: ReactNode; label: string; title?: string; to?: string }) {
  const body = (
    <>
      <span className="ins-figure-value">{value}</span>
      <span className="ins-figure-label">{label}</span>
    </>
  );
  return (
    <li>
      {to ? (
        <Link to={to} className="ins-figure" title={title}>
          {body}
        </Link>
      ) : (
        <div className="ins-figure" title={title}>
          {body}
        </div>
      )}
    </li>
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
    title: s.key === "others" ? "The rest, beyond the twelve with the most value" : undefined,
  }));
  return <BarChart label={`${measure === "value" ? "Value" : "Records"} by ${by}`} format={(v) => (measure === "value" ? formatMinor(v, currency) : count(v))} bars={bars} />;
}

/** How the collection grew. Hidden until records have joined on more than one day: one day is a dot, not a line. */
function Growth({ rows }: { rows: ListedRecord[] }) {
  const points = growth(rows).map((p) => ({ t: p.t, value: p.count, p }));
  if (points.length < 2) return null;
  const day = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="card">
      <div className="insight-head">
        <h2 className="card-title" title="Counted from the day each record joined the Discogs collection">
          How the collection grew
        </h2>
        <Link className="ins-more" to={collectionLink({ sort: "added", dir: "desc" })}>
          Newest first
        </Link>
      </div>
      <LineChart
        points={points}
        label={`Records in the collection over time, from ${dateTime(new Date(points[0]!.t).toISOString())}`}
        formatValue={(v) => count(v)}
        formatTime={day}
        describe={(pt) => <span>{`${plural(pt.p.added, "record")} added that day`}</span>}
      />
    </div>
  );
}
