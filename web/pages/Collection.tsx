import { Fragment, type ReactNode, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";

import type { ListedRecord } from "../../src/api-types";
import { recordsCsv } from "../../src/csv";
import { GRADES, type Grade } from "../../src/grades";
import { applySelection, canPrice, facetOptions, isScarce, readSelection, SELECTION_KEYS, type Selection, type SortKey, writeSelection } from "../../src/select";
import { spotifyAlbumUrl } from "../../src/spotify";
import { type ColumnKey, COLUMNS, loadColumns, saveColumns } from "../columns";
import { ErrorState, Loading, MoneyChange, When } from "../components";
import { CoverGrid } from "../CoverGrid";
import { Filters, QuickFilters } from "../Filters";
import { count, formatMinor } from "../format";
import { useQueueRevalue, useRecords, useUpdateRecord } from "../queries";
import { over, readRange, withRange } from "../range";
import { Totals } from "../Totals";
import { readView, saveView, type View } from "../view";

export function Collection() {
  const [params, setParams] = useSearchParams();
  const range = readRange(params);
  const view = readView(params);
  const records = useRecords(range.days);

  function chooseView(next: View) {
    saveView(next);
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next === "grid") out.set("view", "grid");
        else out.delete("view");
        return out;
      },
      { replace: true },
    );
  }
  // Ticked records. Only the ones on screen count, so a filter never acts on rows you can't see.
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());
  const [columns, setColumns] = useState<ReadonlySet<ColumnKey>>(loadColumns);
  const shownColumns = COLUMNS.filter((c) => columns.has(c.key));

  function chooseColumn(key: ColumnKey, on: boolean) {
    setColumns((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      saveColumns(next);
      return next;
    });
  }

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

  const header = (label: string, options: { sort?: SortKey; numeric?: boolean; narrow?: boolean } = {}) => {
    const className = [options.numeric ? "num" : "", options.narrow ? "hide-narrow" : ""].filter(Boolean).join(" ") || undefined;
    if (!options.sort) {
      return (
        <th scope="col" className={className}>
          {label}
        </th>
      );
    }
    const key = options.sort;
    const active = selection.sort === key;
    const nextDir = active && selection.dir === "asc" ? "desc" : active ? "asc" : options.numeric ? "desc" : "asc";
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

  /** Save whatever is shown, in the order shown, as a spreadsheet. */
  function exportCsv() {
    const blob = new Blob(["\uFEFF", recordsCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vinyl-value-vault-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="stack">
      <div className="row-between">
        <h1>Collection</h1>
        <Totals shown={rows} all={records.data.length} currency={currency} over={over(range)} />
      </div>

      <QuickFilters selection={selection} onChange={select} />
      <Filters
        selection={selection}
        options={options}
        currency={currency}
        range={range}
        onChange={select}
        onRange={(next) => setParams((prev) => withRange(prev, next), { replace: true })}
      />

      <div className="row-between">
        <RevalueBar shown={priceable} selected={selected} onClear={() => setTicked(new Set())} />
        <div className="actions">
          <div className="segmented" role="group" aria-label="View">
            <button type="button" aria-pressed={view === "table"} onClick={() => chooseView("table")}>
              Table
            </button>
            <button type="button" aria-pressed={view === "grid"} onClick={() => chooseView("grid")}>
              Covers
            </button>
          </div>
          {view === "table" ? (
          <details className="menu">
            <summary className="button">Columns</summary>
            <div className="menu-panel">
              {COLUMNS.map((c) => (
                <label key={c.key} className="menu-option">
                  <input type="checkbox" checked={columns.has(c.key)} onChange={(e) => chooseColumn(c.key, e.target.checked)} />
                  {c.key === "change" ? `Change, ${range.label.toLowerCase()}` : c.label}
                </label>
              ))}
            </div>
          </details>
          ) : null}
          <button type="button" className="button" disabled={rows.length === 0} onClick={exportCsv}>
            Export CSV
          </button>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="muted">No records match.</p>
      ) : view === "grid" ? (
        <CoverGrid rows={rows} />
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
                {header("Record", { sort: "artist" })}
                {shownColumns.map((c) => (
                  <Fragment key={c.key}>{header(c.key === "change" ? range.label : c.label, { sort: c.sort, numeric: c.numeric, narrow: c.narrow })}</Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <RecordRow key={r.id} record={r} columns={shownColumns.map((c) => c.key)} ticked={ticked.has(r.id)} onToggle={() => toggle(r.id)} />
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

function RecordRow({ record: r, columns, ticked, onToggle }: { record: ListedRecord; columns: ColumnKey[]; ticked: boolean; onToggle: () => void }) {
  const update = useUpdateRecord();
  const money = (minor: number | null) => (minor !== null && r.current_currency ? formatMinor(minor, r.current_currency) : <span className="muted">—</span>);
  const dash = <span className="muted">—</span>;

  const cells: Record<ColumnKey, () => ReactNode> = {
    year: () => r.year ?? dash,
    label: () => r.label ?? dash,
    catno: () => r.catalogue_number ?? dash,
    format: () => r.format ?? dash,
    media: () => (
      <GradeSelect
        label={`Media grade for ${r.title}`}
        value={r.media_condition}
        disabled={update.isPending}
        onChange={(media_condition) => update.mutate({ id: r.id, patch: { media_condition } })}
      />
    ),
    sleeve: () => (
      <GradeSelect
        label={`Sleeve grade for ${r.title}`}
        value={r.sleeve_condition}
        disabled={update.isPending}
        onChange={(sleeve_condition) => update.mutate({ id: r.id, patch: { sleeve_condition } })}
      />
    ),
    value: () => money(r.current_value_minor),
    change: () => <MoneyChange minor={r.change_minor} currency={r.current_currency} />,
    gain: () => <MoneyChange minor={r.gain_minor} currency={r.current_currency} />,
    forsale: () =>
      r.current_num_for_sale !== null ? (
        <span
          className={isScarce(r) ? "scarce" : undefined}
          title={r.current_lowest_listing_minor !== null && r.current_currency ? `Cheapest copy ${formatMinor(r.current_lowest_listing_minor, r.current_currency)}` : undefined}
        >
          {count(r.current_num_for_sale)}
        </span>
      ) : (
        dash
      ),
    cheapest: () => money(r.current_lowest_listing_minor),
    valued: () =>
      r.last_valuation_error ? (
        <span className="badge badge-warning" title={r.last_valuation_error}>
          <span aria-hidden="true">!</span>No price
        </span>
      ) : r.last_valued_at ? (
        <When iso={r.last_valued_at} />
      ) : (
        <span className="muted">{r.current_value_minor !== null ? "Queued" : "Waiting"}</span>
      ),
    added: () => {
      const when = r.discogs_added_at ?? r.created_at;
      return when ? <When iso={when} /> : dash;
    },
  };
  const spec = new Map(COLUMNS.map((c) => [c.key, c]));

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
      {columns.map((key) => {
        const c = spec.get(key)!;
        const className = [c.numeric ? "num" : "", c.narrow ? "hide-narrow" : "", key === "value" ? "strong" : ""].filter(Boolean).join(" ") || undefined;
        return (
          <td key={key} className={className}>
            {cells[key]()}
          </td>
        );
      })}
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
