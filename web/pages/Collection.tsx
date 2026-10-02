import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";

import type { ListedRecord } from "../../src/api-types";
import { GRADES, type Grade } from "../../src/grades";
import { applySelection, canPrice, facetOptions, isScarce, readSelection, SELECTION_KEYS, type Selection, type SortKey, writeSelection } from "../../src/select";
import { spotifyAlbumUrl } from "../../src/spotify";
import { ErrorState, Loading, MoneyChange, When } from "../components";
import { Filters, QuickFilters } from "../Filters";
import { count, formatMinor } from "../format";
import { useQueueRevalue, useRecords, useUpdateRecord } from "../queries";
import { Totals } from "../Totals";

export function Collection() {
  const records = useRecords();
  const [params, setParams] = useSearchParams();
  // Ticked records. Only the ones on screen count, so a filter never acts on rows you can't see.
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());

  const selection = useMemo(() => readSelection(params), [params]);

  /** Put a selection in the URL, leaving any other parameter alone. */
  function select(next: Selection) {
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        for (const key of SELECTION_KEYS) out.delete(key);
        for (const [k, v] of writeSelection(next)) out.append(k, v);
        return out;
      },
      { replace: true },
    );
  }

  const rows = useMemo(() => (records.data ? applySelection(records.data, selection) : []), [records.data, selection]);
  const options = useMemo(() => (records.data ? facetOptions(records.data, selection) : null), [records.data, selection]);

  if (records.isPending || options === null) return <Loading />;
  if (records.isError) return <ErrorState error={records.error} />;

  const currency = records.data.find((r) => r.current_currency)?.current_currency ?? "GBP";

  const priceable = rows.filter(canPrice);
  const selected = priceable.filter((r) => ticked.has(r.id));
  const allTicked = priceable.length > 0 && selected.length === priceable.length;

  function toggle(id: number) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  const header = (key: SortKey, label: string, options: { numeric?: boolean; narrow?: boolean } = {}) => {
    const active = selection.sort === key;
    const nextDir = active && selection.dir === "asc" ? "desc" : active ? "asc" : options.numeric ? "desc" : "asc";
    const className = [options.numeric ? "num" : "", options.narrow === false ? "hide-narrow" : ""].filter(Boolean).join(" ") || undefined;
    return (
      <th scope="col" className={className} aria-sort={active ? (selection.dir === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" className="sort" onClick={() => select({ ...selection, sort: key, dir: nextDir })}>
          {label}
          <span aria-hidden="true" className="sort-mark">
            {active ? (selection.dir === "asc" ? "↑" : "↓") : ""}
          </span>
        </button>
      </th>
    );
  };

  return (
    <section className="stack">
      <div className="row-between">
        <h1>Collection</h1>
        <Totals shown={rows} all={records.data.length} currency={currency} />
      </div>

      <QuickFilters selection={selection} onChange={select} />
      <Filters selection={selection} options={options} currency={currency} onChange={select} />

      <RevalueBar shown={priceable} selected={selected} onClear={() => setTicked(new Set())} />

      {rows.length === 0 ? (
        <p className="muted">No records match.</p>
      ) : (
        <div className="table-wrap">
          <table className="table records">
            <thead>
              <tr>
                <th scope="col" className="check-col">
                  <input
                    type="checkbox"
                    aria-label="Select every record shown"
                    checked={allTicked}
                    ref={(el) => {
                      if (el) el.indeterminate = selected.length > 0 && !allTicked;
                    }}
                    disabled={priceable.length === 0}
                    onChange={() => setTicked(allTicked ? new Set() : new Set(priceable.map((r) => r.id)))}
                  />
                </th>
                <th scope="col" className="cover-col">
                  <span className="sr-only">Cover</span>
                </th>
                {header("artist", "Record")}
                {header("year", "Year", { numeric: true, narrow: false })}
                {header("media", "Media")}
                {header("sleeve", "Sleeve", { narrow: false })}
                {header("value", "Value", { numeric: true })}
                {header("change", "30 days", { numeric: true, narrow: false })}
                {header("gain", "Gain", { numeric: true, narrow: false })}
                {header("forsale", "For sale", { numeric: true, narrow: false })}
                {header("valued", "Priced", { narrow: false })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <RecordRow key={r.id} record={r} ticked={ticked.has(r.id)} onToggle={() => toggle(r.id)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Re-price the ticked records, or every one shown when none is ticked. They join the front of the
 * valuation queue, with any record not yet priced; the job prices them a batch at a time and the
 * table refreshes as they arrive.
 */
function RevalueBar({ shown, selected, onClear }: { shown: ListedRecord[]; selected: ListedRecord[]; onClear: () => void }) {
  const queue = useQueueRevalue();
  const targets = selected.length > 0 ? selected : shown;
  const label = selected.length > 0 ? `Revalue ${count(selected.length)} selected` : `Revalue all ${count(shown.length)}`;

  return (
    <div className="actions bulk">
      <button
        type="button"
        className="button"
        disabled={targets.length === 0 || queue.isPending}
        onClick={() => queue.mutate(targets.map((r) => r.id), { onSuccess: onClear })}
      >
        {queue.isPending ? "Queueing…" : label}
      </button>
      {selected.length > 0 ? (
        <button type="button" className="button" onClick={onClear}>
          Clear selection
        </button>
      ) : null}
      {queue.isSuccess ? (
        <p className="muted small" role="status">
          {queue.data.queued === 0
            ? "Nothing to queue: none of those can be priced."
            : `Queued ${count(queue.data.queued)} for a fresh price from Discogs. The valuation job takes queued records first, a few at a time, and the Priced column fills in as they arrive.`}
        </p>
      ) : null}
      {queue.isError ? <ErrorState error={queue.error} /> : null}
    </div>
  );
}

function RecordRow({ record: r, ticked, onToggle }: { record: ListedRecord; ticked: boolean; onToggle: () => void }) {
  const update = useUpdateRecord();
  return (
    <tr className={r.discogs_removed_at ? "gone" : undefined}>
      <td className="check-col">
        <input
          type="checkbox"
          aria-label={`Select ${r.title}`}
          checked={ticked}
          disabled={!canPrice(r)}
          title={canPrice(r) ? undefined : "Only records on Discogs, still in the collection, can be priced"}
          onChange={onToggle}
        />
      </td>
      <td className="cover-col">
        {r.thumb_url ? <img src={r.thumb_url} alt="" width={40} height={40} loading="lazy" className="thumb" /> : <span className="thumb thumb-empty" />}
      </td>
      <td className="record-cell">
        <div className="record-title">
          <Link to={`/records/${r.id}`} className="record-link">
            {r.title}
          </Link>
          {r.spotify_album_id ? (
            <a className="play-link" href={spotifyAlbumUrl(r.spotify_album_id)} target="_blank" rel="noreferrer" aria-label={`Play ${r.title} on Spotify`}>
              <span aria-hidden="true">▶</span> Spotify
            </a>
          ) : null}
          {r.discogs_removed_at ? <span className="badge badge-neutral">Gone from Discogs</span> : null}
        </div>
        <div className="record-sub" title={[r.artist, r.format].filter(Boolean).join(" · ")}>
          {r.artist}
          {r.format ? ` · ${r.format}` : ""}
        </div>
      </td>
      <td className="num hide-narrow">{r.year ?? "—"}</td>
      <td>
        <GradeSelect
          label={`Media grade for ${r.title}`}
          value={r.media_condition}
          disabled={update.isPending}
          onChange={(media_condition) => update.mutate({ id: r.id, patch: { media_condition } })}
        />
      </td>
      <td className="hide-narrow">
        <GradeSelect
          label={`Sleeve grade for ${r.title}`}
          value={r.sleeve_condition}
          disabled={update.isPending}
          onChange={(sleeve_condition) => update.mutate({ id: r.id, patch: { sleeve_condition } })}
        />
      </td>
      <td className="num strong">
        {r.current_value_minor !== null && r.current_currency ? formatMinor(r.current_value_minor, r.current_currency) : <span className="muted">—</span>}
      </td>
      <td className="num hide-narrow">
        <MoneyChange minor={r.change_30d_minor} currency={r.current_currency} />
      </td>
      <td className="num hide-narrow">
        <MoneyChange minor={r.gain_minor} currency={r.current_currency} />
      </td>
      <td className="num hide-narrow">
        {r.current_num_for_sale !== null ? (
          <span
            className={isScarce(r) ? "scarce" : undefined}
            title={r.current_lowest_listing_minor !== null && r.current_currency ? `Cheapest copy ${formatMinor(r.current_lowest_listing_minor, r.current_currency)}` : undefined}
          >
            {count(r.current_num_for_sale)}
          </span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td className="hide-narrow">
        {r.last_valuation_error ? (
          <span className="badge badge-warning" title={r.last_valuation_error}>
            <span aria-hidden="true">!</span>No price
          </span>
        ) : r.last_valued_at ? (
          <When iso={r.last_valued_at} />
        ) : (
          <span className="muted">{r.current_value_minor !== null ? "Queued" : "Waiting"}</span>
        )}
      </td>
    </tr>
  );
}

function GradeSelect({ label, value, disabled, onChange }: { label: string; value: Grade; disabled: boolean; onChange: (g: Grade) => void }) {
  return (
    <select className="grade" aria-label={label} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as Grade)}>
      {GRADES.map((g) => (
        <option key={g} value={g}>
          {g}
        </option>
      ))}
    </select>
  );
}
