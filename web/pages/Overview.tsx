import { type KeyboardEvent, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import type { ListedRecord } from "../../src/api-types";
import { DEFAULT_SELECTION, matches, QUICK_FILTERS, type Selection, writeSelection } from "../../src/select";
import { ErrorState, Loading, MoneyChange, When } from "../components";
import { count, dateTime, formatMinor, plural } from "../format";
import { LineChart } from "../LineChart";
import { collectionLink } from "../links";
import { useCollection, useRecords } from "../queries";
import { over, RANGES, type Range, readRange, withRange } from "../range";
import "../overview.css";

/** The chart's windows, short enough to sit in the card's header. Screen readers get the full words. */
const SHORT: Record<Range["value"], string> = { "7": "7d", "30": "30d", "90": "90d", "365": "1y", all: "All" };

const preset = (id: string): Partial<Selection> => QUICK_FILTERS.find((f) => f.id === id)?.preset ?? {};

/** The collection narrowed to a selection, measuring change over the same window as this page. */
function collectionOver(partial: Partial<Selection>, range: Range): string {
  const query = withRange(new URLSearchParams(writeSelection({ ...DEFAULT_SELECTION, ...partial })), range).toString();
  return query ? `/collection?${query}` : "/collection";
}

export function Overview() {
  const [params, setParams] = useSearchParams();
  const range = readRange(params);
  const collection = useCollection(range.days);
  const records = useRecords(range.days);

  if (collection.isPending) return <Loading />;
  if (collection.isError) return <ErrorState error={collection.error} />;

  const c = collection.data;
  const all = records.data ?? [];
  const inCollection = all.filter((r) => r.discogs_removed_at === null);
  const moved = inCollection.filter((r) => r.change_minor !== null && r.change_minor !== 0);
  const risers = moved.filter((r) => r.change_minor! > 0).sort((a, b) => b.change_minor! - a.change_minor!).slice(0, 5);
  const fallers = moved.filter((r) => r.change_minor! < 0).sort((a, b) => a.change_minor! - b.change_minor!).slice(0, 5);
  const marketMove = inCollection.reduce((sum, r) => sum + (r.change_minor ?? 0), 0);
  const withPurchase = inCollection.filter((r) => r.gain_minor !== null);
  const gain = withPurchase.reduce((sum, r) => sum + r.gain_minor!, 0);
  // Counted with the same filter the link opens, so the number and the list agree.
  const needsPrice = preset("waiting");
  const waiting = all.filter((r) => matches(r, { ...DEFAULT_SELECTION, ...needsPrice })).length;
  const period = range.label.toLowerCase();

  return (
    <section className="stack">
      <div className="ov-hero">
        <div>
          <h1 className="ov-label">Collection value</h1>
          <div className="ov-figure">
            <span className="ov-total">{c.total}</span>
            {records.data ? (
              <span className={records.isPlaceholderData ? "ov-pills refetching" : "ov-pills"}>
                <ChangePill
                  minor={marketMove}
                  currency={c.currency}
                  period={period}
                  to={collectionOver(preset(marketMove < 0 ? "fallers" : "risers"), range)}
                />
                {withPurchase.length > 0 ? (
                  <Link
                    to={collectionLink({ paid: "yes", sort: "gain", dir: "desc" })}
                    className="ov-pill ov-pill-quiet"
                    title={`Across ${plural(withPurchase.length, "record")} with a price paid`}
                  >
                    <MoneyChange minor={gain} currency={c.currency} />
                    <span>on what I paid</span>
                  </Link>
                ) : null}
              </span>
            ) : null}
          </div>
        </div>
        <div className="ov-meta">
          <Link to="/collection" className="ov-meta-link">
            {plural(c.record_count, "record")}
          </Link>
          {c.last_valued_at ? (
            <span>
              priced <When iso={c.last_valued_at} />
            </span>
          ) : null}
          {waiting > 0 ? (
            <Link to={collectionLink(needsPrice)} className="ov-waiting">
              {count(waiting)} waiting for a price
            </Link>
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="row-between">
          <h2 className="card-title">Value over time</h2>
          <div className="segmented ov-compact" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button
                key={r.value}
                type="button"
                aria-pressed={r === range}
                aria-label={r.label}
                onClick={() => setParams((prev) => withRange(prev, r))}
              >
                {SHORT[r.value]}
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
          </div>
        )}
      </div>

      {records.isError ? <ErrorState error={records.error} /> : null}
      {records.data ? (
        <div className={records.isPlaceholderData ? "refetching" : undefined}>
          <Movers risers={risers} fallers={fallers} range={range} />
        </div>
      ) : null}
    </section>
  );
}

/** The change in value from price moves over the window: green up, red down, grey when nothing moved. */
function ChangePill({ minor, currency, period, to }: { minor: number; currency: string; period: string; to: string }) {
  const tone = minor > 0 ? "up" : minor < 0 ? "down" : "flat";
  const body = (
    <>
      <MoneyChange minor={minor} currency={currency} />
      <span aria-hidden="true">·</span>
      <span>{period}</span>
    </>
  );
  const title = "From price changes, not additions";
  if (minor === 0) {
    return (
      <span className={`ov-pill ov-pill-${tone}`} title={title}>
        {body}
      </span>
    );
  }
  const amount = `${minor > 0 ? "+" : "−"}${formatMinor(Math.abs(minor), currency)}`;
  return (
    <Link to={to} className={`ov-pill ov-pill-${tone}`} title={title} aria-label={`Price moves, ${amount} over ${period}`}>
      {body}
    </Link>
  );
}

type Tab = "up" | "down";

const TABS: { id: Tab; label: string; preset: string; none: string }[] = [
  { id: "up", label: "Risers", preset: "risers", none: "Nothing went up" },
  { id: "down", label: "Fallers", preset: "fallers", none: "Nothing went down" },
];

/** The biggest risers and fallers over the window, one card with a tab each. */
function Movers({ risers, fallers, range }: { risers: ListedRecord[]; fallers: ListedRecord[]; range: Range }) {
  const [picked, setPicked] = useState<Tab | null>(null);
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  if (risers.length === 0 && fallers.length === 0) {
    return (
      <div className="card">
        <h2 className="card-title">Price moves</h2>
        <p className="muted">No price moves {over(range)}.</p>
      </div>
    );
  }

  // Open on whichever side has something to show, unless a tab was chosen.
  const active: Tab = picked ?? (risers.length === 0 ? "down" : "up");
  const tab = TABS.find((t) => t.id === active)!;
  const rows = active === "up" ? risers : fallers;

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next: Tab = active === "up" ? "down" : "up";
    setPicked(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="card">
      <div className="row-between">
        <div className="ov-tabs" role="tablist" aria-label={`Price moves, ${range.label.toLowerCase()}`}>
          {TABS.map((t) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[t.id] = el;
              }}
              type="button"
              role="tab"
              id={`movers-tab-${t.id}`}
              aria-selected={t.id === active}
              aria-controls="movers-panel"
              tabIndex={t.id === active ? 0 : -1}
              className="ov-tab"
              onClick={() => setPicked(t.id)}
              onKeyDown={onKeyDown}
            >
              {t.label}
            </button>
          ))}
        </div>
        {rows.length > 0 ? (
          <Link to={collectionOver(preset(tab.preset), range)} className="ov-more" aria-label={`See all ${tab.label.toLowerCase()}, ${range.label.toLowerCase()}`}>
            See all
          </Link>
        ) : null}
      </div>
      <div role="tabpanel" id="movers-panel" aria-labelledby={`movers-tab-${active}`} tabIndex={0}>
        {rows.length === 0 ? (
          <p className="muted">
            {tab.none} {over(range)}.
          </p>
        ) : (
          <ul className="movers">
            {rows.map((r) => (
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
    </div>
  );
}
