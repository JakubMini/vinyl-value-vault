import "../collection.css";

import { Fragment, type ReactNode, useId, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import type { ListedRecord } from "../../src/api-types";
import { recordsCsv } from "../../src/csv";
import { GRADES, type Grade } from "../../src/grades";
import {
  activeFilters,
  applySelection,
  canPrice,
  chooseTab,
  facetOptions,
  FIRST_DIR,
  isScarce,
  matches,
  readSelection,
  SELECTION_KEYS,
  type Selection,
  type SortKey,
  writeSelection,
} from "../../src/select";
import { spotifyAlbumUrl } from "../../src/spotify";
import { Menu, MenuCheckbox, MenuGroup, MenuItem, MenuSeparator } from "../CollectionMenu";
import { type ColumnKey, COLUMNS, loadColumns, saveColumns } from "../columns";
import { ErrorState, Loading, MoneyChange, When } from "../components";
import { CoverGrid } from "../CoverGrid";
import { FilterChips, FilterDrawer, ViewTabs } from "../Filters";
import { count, formatMinor, plural } from "../format";
import { type RecordPatch, useQueueRevalue, useRecords, useUpdateRecord } from "../queries";
import { over, readRange, withRange } from "../range";
import { Totals } from "../Totals";
import { readView, saveView, type View } from "../view";

interface Notice {
  text: string;
  error?: boolean;
}

/** How many grade changes go to the API at once. */
const GRADE_BATCH = 4;

export function Collection() {
  const [params, setParams] = useSearchParams();
  const range = readRange(params);
  const view = readView(params);
  const records = useRecords(range.days);
  const update = useUpdateRecord();
  const queue = useQueueRevalue();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const filtersButton = useRef<HTMLButtonElement>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  // Ticked records. Only the ones on screen count, so an action never reaches rows you can't see.
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set());
  const [columns, setColumns] = useState<ReadonlySet<ColumnKey>>(loadColumns);
  const shownColumns = COLUMNS.filter((c) => columns.has(c.key));

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
  const todo = useMemo(() => {
    const s = chooseTab(selection, "todo");
    return records.data ? records.data.filter((r) => matches(r, s)).length : 0;
  }, [records.data, selection]);

  if (records.isPending || options === null) return <Loading />;
  if (records.isError) return <ErrorState error={records.error} />;

  const currency = records.data.find((r) => r.current_currency)?.current_currency ?? "GBP";
  const chips = activeFilters(selection, (major) => formatMinor(Math.round(major * 100), currency), over(range));
  const priceable = rows.filter(canPrice);
  const tickedRows = rows.filter((r) => ticked.has(r.id));
  const allTicked = rows.length > 0 && tickedRows.length === rows.length;

  function toggle(id: number) {
    setTicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  /**
   * Re-price records: they join the front of the valuation queue, with any not yet priced. The
   * job prices them a batch at a time, and the table refreshes as the prices arrive.
   */
  function revalue(targets: ListedRecord[], after?: () => void) {
    const ids = targets.filter(canPrice).map((r) => r.id);
    if (ids.length === 0) return;
    setNotice({ text: "Queueing…" });
    queue.mutate(ids, {
      onSuccess: (res) => {
        setNotice({ text: res.queued === 0 ? "Nothing to queue." : `Queued ${plural(res.queued, "record")} for a new price.` });
        after?.();
      },
      onError: (error) => setNotice({ text: error instanceof Error ? error.message : String(error), error: true }),
    });
  }

  /** Give every ticked record a grade, one request per record, a few at a time. A new media grade re-prices too. */
  async function grade(targets: ListedRecord[], side: "media" | "sleeve", g: Grade) {
    const changing = targets.filter((r) => (side === "media" ? r.media_condition : r.sleeve_condition) !== g);
    const patch: RecordPatch = side === "media" ? { media_condition: g } : { sleeve_condition: g };
    const what = side === "media" ? "Media grade" : "Sleeve grade";
    if (changing.length === 0) {
      setNotice({ text: `${what} already ${g}.` });
      return;
    }
    setNotice({ text: "Saving…" });
    let failed = 0;
    for (let i = 0; i < changing.length; i += GRADE_BATCH) {
      const batch = changing.slice(i, i + GRADE_BATCH);
      const results = await Promise.allSettled(batch.map((r) => update.mutateAsync({ id: r.id, patch })));
      failed += results.filter((x) => x.status === "rejected").length;
    }
    setNotice(
      failed > 0
        ? { text: `${plural(failed, "record")} could not be changed.`, error: true }
        : { text: `${what} ${g} on ${plural(changing.length, "record")}.` },
    );
  }

  /** Save whatever is shown, in the order shown, as a spreadsheet. */
  function exportCsv() {
    const blob = new Blob(["﻿", recordsCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vinyl-value-vault-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const header = (label: string, o: { sort?: SortKey; numeric?: boolean; narrow?: boolean; hint?: string } = {}) => {
    const className = [o.numeric ? "num" : "", o.narrow ? "hide-narrow" : ""].filter(Boolean).join(" ") || undefined;
    if (!o.sort) {
      return (
        <th scope="col" className={className} title={o.hint}>
          {label}
        </th>
      );
    }
    const key = o.sort;
    const active = selection.sort === key;
    const nextDir = active ? (selection.dir === "asc" ? "desc" : "asc") : FIRST_DIR[key];
    return (
      <th scope="col" className={className} title={o.hint} aria-sort={active ? (selection.dir === "asc" ? "ascending" : "descending") : "none"}>
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
    <section className="collection">
      <div className="collection-head">
        <h1>Collection</h1>
        <Totals shown={rows} all={records.data.length} currency={currency} over={over(range)} />
      </div>

      <ViewTabs selection={selection} todo={todo} onChange={select} />

      <div className="toolbar">
        <div className="toolbar-search" role="search">
          <input
            type="search"
            className="input"
            placeholder="Search artist, title, label"
            aria-label="Search the collection"
            value={selection.q}
            onChange={(e) => select({ ...selection, q: e.target.value })}
          />
        </div>
        <button
          ref={filtersButton}
          type="button"
          className="button toolbar-filters"
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <FilterIcon />
          Filters
          {chips.length > 0 ? (
            <span className="pill">
              {count(chips.length)}
              <span className="sr-only"> in force</span>
            </span>
          ) : null}
        </button>
        <SortControl selection={selection} onChange={select} />
        <ViewToggle view={view} onChange={chooseView} />
        <div className="toolbar-more">
          <Menu trigger={<span aria-hidden="true">⋯</span>} label="More actions" iconOnly className="button tool-icon">
            {(close) => (
              <>
                <MenuItem
                  disabled={priceable.length === 0 || queue.isPending}
                  onSelect={() => {
                    close();
                    revalue(priceable);
                  }}
                >
                  Revalue all {count(priceable.length)}
                </MenuItem>
                <MenuItem
                  disabled={rows.length === 0}
                  onSelect={() => {
                    close();
                    exportCsv();
                  }}
                >
                  Export CSV
                </MenuItem>
                {view === "table" ? (
                  <>
                    <MenuSeparator />
                    <MenuGroup label="Columns">
                      {COLUMNS.map((c) => (
                        <MenuCheckbox key={c.key} checked={columns.has(c.key)} onChange={(on) => chooseColumn(c.key, on)}>
                          {c.key === "change" ? `Change, ${range.label.toLowerCase()}` : c.key === "media" ? "Grade (media)" : c.label}
                        </MenuCheckbox>
                      ))}
                    </MenuGroup>
                  </>
                ) : null}
              </>
            )}
          </Menu>
        </div>
      </div>

      <FilterChips chips={chips} selection={selection} onChange={select} />

      <p className={notice?.error ? "collection-notice is-error" : "collection-notice"} role="status">
        {notice?.text}
      </p>

      {rows.length === 0 ? (
        <p className="muted">No records match.</p>
      ) : view === "grid" ? (
        <CoverGrid rows={rows} />
      ) : (
        <div className="table-wrap records-wrap">
          <table className="table records">
            <thead>
              <tr>
                <th scope="col" className="check-col">
                  <input
                    type="checkbox"
                    aria-label="Select every record shown"
                    checked={allTicked}
                    ref={(el) => {
                      if (el) el.indeterminate = tickedRows.length > 0 && !allTicked;
                    }}
                    onChange={() => setTicked(allTicked ? new Set() : new Set(rows.map((r) => r.id)))}
                  />
                </th>
                <th scope="col" className="cover-col">
                  <span className="sr-only">Cover</span>
                </th>
                {header("Record", { sort: "artist" })}
                {shownColumns.map((c) => (
                  <Fragment key={c.key}>{header(c.key === "change" ? range.label : c.label, { sort: c.sort, numeric: c.numeric, narrow: c.narrow, hint: c.hint })}</Fragment>
                ))}
                <th scope="col" className="spotify-col">
                  <span className="sr-only">Spotify</span>
                </th>
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

      {view === "table" && tickedRows.length > 0 ? (
        <SelectionBar
          rows={tickedRows}
          revaluing={queue.isPending}
          onGrade={(side, g) => void grade(tickedRows, side, g)}
          onRevalue={() => revalue(tickedRows, () => setTicked(new Set()))}
          onClear={() => setTicked(new Set())}
        />
      ) : null}

      <FilterDrawer
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          filtersButton.current?.focus();
        }}
        selection={selection}
        options={options}
        chips={chips}
        currency={currency}
        range={range}
        shown={rows.length}
        onChange={select}
        onRange={(next) => setParams((prev) => withRange(prev, next), { replace: true })}
      />
    </section>
  );
}

/** What every order is called, in the order the sort menu lists them. */
const SORT_LABELS: Record<SortKey, string> = {
  value: "Value",
  change: "Change",
  gain: "Gain on cost",
  artist: "Artist",
  title: "Title",
  year: "Year",
  label: "Label",
  media: "Grade",
  sleeve: "Sleeve grade",
  added: "Date added",
  valued: "Last priced",
  forsale: "Copies for sale",
  cheapest: "Cheapest copy",
};

function SortControl({ selection, onChange }: { selection: Selection; onChange: (next: Selection) => void }) {
  const id = useId();
  const asc = selection.dir === "asc";
  return (
    <div className="sort-control">
      <label htmlFor={id} className="sort-label">
        Sort
      </label>
      <select
        id={id}
        className="input"
        value={selection.sort}
        onChange={(e) => {
          const sort = e.target.value as SortKey;
          onChange({ ...selection, sort, dir: FIRST_DIR[sort] });
        }}
      >
        {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
          <option key={k} value={k}>
            {SORT_LABELS[k]}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="button tool-icon"
        aria-label={`Reverse the order, now ${asc ? "ascending" : "descending"}`}
        title={asc ? "Ascending" : "Descending"}
        onClick={() => onChange({ ...selection, dir: asc ? "desc" : "asc" })}
      >
        <span aria-hidden="true">{asc ? "↑" : "↓"}</span>
      </button>
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  return (
    <div className="view-toggle" role="group" aria-label="View">
      <button type="button" aria-pressed={view === "table"} aria-label="Table" title="Table" onClick={() => onChange("table")}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
        </svg>
      </button>
      <button type="button" aria-pressed={view === "grid"} aria-label="Covers" title="Covers" onClick={() => onChange("grid")}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
          <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
          <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
          <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
        </svg>
      </button>
    </div>
  );
}

function FilterIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2.5 4h11M4.5 8h7M6.5 12h3" />
    </svg>
  );
}

/** What can be done to the ticked records: grade them, re-price them, or let them go. */
function SelectionBar({
  rows,
  revaluing,
  onGrade,
  onRevalue,
  onClear,
}: {
  rows: ListedRecord[];
  revaluing: boolean;
  onGrade: (side: "media" | "sleeve", grade: Grade) => void;
  onRevalue: () => void;
  onClear: () => void;
}) {
  const priceable = rows.some(canPrice);
  return (
    <div className="selection-bar" role="region" aria-label="Selected records">
      <span className="selection-count">{count(rows.length)} selected</span>
      <GradeMenu label="Media grade" onPick={(g) => onGrade("media", g)} />
      <GradeMenu label="Sleeve grade" onPick={(g) => onGrade("sleeve", g)} />
      <button
        type="button"
        className="button"
        disabled={!priceable || revaluing}
        title={priceable ? undefined : "None of these can be priced"}
        onClick={onRevalue}
      >
        {revaluing ? "Queueing…" : "Revalue"}
      </button>
      <button type="button" className="link-button" onClick={onClear}>
        Clear
      </button>
    </div>
  );
}

function GradeMenu({ label, onPick }: { label: string; onPick: (grade: Grade) => void }) {
  return (
    <Menu
      trigger={
        <>
          {label}
          <span aria-hidden="true" className="caret">
            ▾
          </span>
        </>
      }
      label={label}
      align="start"
      up
    >
      {(close) =>
        GRADES.map((g) => (
          <MenuItem
            key={g}
            onSelect={() => {
              close();
              onPick(g);
            }}
          >
            {g}
          </MenuItem>
        ))
      }
    </Menu>
  );
}

function RecordRow({ record: r, columns, ticked, onToggle }: { record: ListedRecord; columns: ColumnKey[]; ticked: boolean; onToggle: () => void }) {
  const dash = <span className="muted">—</span>;
  const money = (minor: number | null) => (minor !== null && r.current_currency ? formatMinor(minor, r.current_currency) : dash);
  /** A change, or a muted dash when there is none to speak of. */
  const delta = (minor: number | null) => (minor === 0 ? dash : <MoneyChange minor={minor} currency={r.current_currency} />);

  const cells: Record<ColumnKey, () => ReactNode> = {
    year: () => r.year ?? dash,
    label: () => r.label ?? dash,
    catno: () => r.catalogue_number ?? dash,
    format: () => r.format ?? dash,
    media: () => r.media_condition,
    sleeve: () => r.sleeve_condition,
    value: () =>
      r.current_value_minor !== null && r.current_currency ? (
        formatMinor(r.current_value_minor, r.current_currency)
      ) : (
        <span className="muted" title={r.last_valuation_error ?? (canPrice(r) ? "Waiting for a price" : undefined)}>
          —
        </span>
      ),
    change: () => delta(r.change_minor),
    gain: () => delta(r.gain_minor),
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
  const gone = r.discogs_removed_at !== null;

  return (
    <tr className={[gone ? "gone" : "", ticked ? "is-ticked" : ""].filter(Boolean).join(" ") || undefined}>
      <td className="check-col">
        <input type="checkbox" aria-label={`Select ${r.title}`} checked={ticked} onChange={onToggle} />
      </td>
      <td className="cover-col">
        {r.thumb_url ? <img src={r.thumb_url} alt="" width={40} height={40} loading="lazy" className="thumb" /> : <span className="thumb thumb-empty" />}
      </td>
      <td className="record-cell">
        <Link to={`/records/${r.id}`} className="row-title" title={r.title}>
          {r.title}
        </Link>
        <div className="row-artist" title={r.artist}>
          {r.artist}
          {gone ? " · gone from Discogs" : ""}
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
      <td className="spotify-col">
        {r.spotify_album_id ? (
          <a className="spotify-link" href={spotifyAlbumUrl(r.spotify_album_id)} target="_blank" rel="noreferrer" aria-label={`Play ${r.title} on Spotify`} title="Play on Spotify">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M6.6 5.4v5.2L10.8 8z" fill="currentColor" />
            </svg>
          </a>
        ) : null}
      </td>
    </tr>
  );
}
