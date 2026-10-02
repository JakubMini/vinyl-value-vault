import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";

import type { ListedRecord } from "../../src/api-types";
import { GRADES, type Grade } from "../../src/grades";
import { ErrorState, Loading, MoneyChange, When } from "../components";
import { count, formatMinor } from "../format";
import { useRecords, useUpdateRecord } from "../queries";

type SortKey = "artist" | "title" | "year" | "media" | "sleeve" | "value" | "change" | "gain" | "valued" | "added";
type Status = "collection" | "priced" | "waiting" | "problem" | "gone" | "all";

const STATUSES: { value: Status; label: string }[] = [
  { value: "collection", label: "In the collection" },
  { value: "priced", label: "Priced" },
  { value: "waiting", label: "Waiting for a price" },
  { value: "problem", label: "Price problem" },
  { value: "gone", label: "Gone from Discogs" },
  { value: "all", label: "Everything" },
];

const GRADE_RANK = new Map(GRADES.map((g, i) => [g, i]));
const text = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });

/** How each column sorts. Missing values always sink to the bottom, whichever the direction. */
const SORTS: Record<SortKey, (r: ListedRecord) => string | number | null> = {
  artist: (r) => r.artist,
  title: (r) => r.title,
  year: (r) => r.year,
  media: (r) => GRADE_RANK.get(r.media_condition) ?? null,
  sleeve: (r) => GRADE_RANK.get(r.sleeve_condition) ?? null,
  value: (r) => r.current_value_minor,
  change: (r) => r.change_30d_minor,
  gain: (r) => r.gain_minor,
  valued: (r) => r.last_valued_at,
  added: (r) => r.discogs_added_at ?? r.created_at,
};

function compare(a: string | number | null, b: string | number | null): number {
  if (typeof a === "string" && typeof b === "string") return text.compare(a, b);
  return (a as number) - (b as number);
}

function matchesStatus(r: ListedRecord, status: Status): boolean {
  const gone = r.discogs_removed_at !== null;
  switch (status) {
    case "collection":
      return !gone;
    case "priced":
      return !gone && r.current_value_minor !== null;
    case "waiting":
      return !gone && r.current_value_minor === null && r.last_valuation_error === null;
    case "problem":
      return !gone && r.last_valuation_error !== null;
    case "gone":
      return gone;
    case "all":
      return true;
  }
}

export function Collection() {
  const records = useRecords();
  const [params, setParams] = useSearchParams();

  const q = params.get("q") ?? "";
  const grade = (params.get("grade") ?? "") as Grade | "";
  const status = (params.get("status") ?? "collection") as Status;
  const sort = (params.get("sort") ?? "artist") as SortKey;
  const dir = params.get("dir") === "desc" ? "desc" : "asc";

  function update(changes: Record<string, string | null>) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) {
          if (v === null || v === "") next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );
  }

  const rows = useMemo(() => {
    if (!records.data) return [];
    const needle = q.trim().toLocaleLowerCase("en-GB");
    const key = SORTS[sort] ?? SORTS.artist;
    return records.data
      .filter((r) => matchesStatus(r, STATUSES.some((s) => s.value === status) ? status : "collection"))
      .filter((r) => !grade || r.media_condition === grade)
      .filter(
        (r) =>
          !needle ||
          [r.artist, r.title, r.label, r.catalogue_number].some((f) => f?.toLocaleLowerCase("en-GB").includes(needle)),
      )
      .sort((a, b) => {
        const x = key(a);
        const y = key(b);
        if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
        const order = compare(x, y);
        return (dir === "asc" ? order : -order) || text.compare(a.artist, b.artist) || text.compare(a.title, b.title);
      });
  }, [records.data, q, grade, status, sort, dir]);

  if (records.isPending) return <Loading />;
  if (records.isError) return <ErrorState error={records.error} />;

  const header = (key: SortKey, label: string, options: { numeric?: boolean; narrow?: boolean } = {}) => {
    const active = sort === key;
    const nextDir = active && dir === "asc" ? "desc" : active ? "asc" : options.numeric ? "desc" : "asc";
    const className = [options.numeric ? "num" : "", options.narrow === false ? "hide-narrow" : ""].filter(Boolean).join(" ") || undefined;
    return (
      <th scope="col" className={className} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
        <button type="button" className="sort" onClick={() => update({ sort: key === "artist" ? null : key, dir: nextDir === "asc" ? null : "desc" })}>
          {label}
          <span aria-hidden="true" className="sort-mark">
            {active ? (dir === "asc" ? "↑" : "↓") : ""}
          </span>
        </button>
      </th>
    );
  };

  return (
    <section className="stack">
      <div className="row-between">
        <h1>Collection</h1>
        <p className="muted">
          {count(rows.length)} of {count(records.data.length)} records
        </p>
      </div>

      <div className="filters" role="search">
        <input
          type="search"
          className="input"
          placeholder="Search artist, title, label, catalogue number"
          aria-label="Search the collection"
          value={q}
          onChange={(e) => update({ q: e.target.value })}
        />
        <select className="input" aria-label="Media grade" value={grade} onChange={(e) => update({ grade: e.target.value })}>
          <option value="">Any grade</option>
          {GRADES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Status"
          value={status}
          onChange={(e) => update({ status: e.target.value === "collection" ? null : e.target.value })}
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {rows.length === 0 ? (
        <p className="muted">No records match.</p>
      ) : (
        <div className="table-wrap">
          <table className="table records">
            <thead>
              <tr>
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
                {header("valued", "Priced", { narrow: false })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <RecordRow key={r.id} record={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RecordRow({ record: r }: { record: ListedRecord }) {
  const update = useUpdateRecord();
  return (
    <tr className={r.discogs_removed_at ? "gone" : undefined}>
      <td className="cover-col">
        {r.thumb_url ? <img src={r.thumb_url} alt="" width={40} height={40} loading="lazy" className="thumb" /> : <span className="thumb thumb-empty" />}
      </td>
      <td className="record-cell">
        <div className="record-title">
          <Link to={`/records/${r.id}`} className="record-link">
            {r.title}
          </Link>
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
      <td className="hide-narrow">
        {r.last_valuation_error ? (
          <span className="badge badge-warning" title={r.last_valuation_error}>
            <span aria-hidden="true">!</span>No price
          </span>
        ) : r.last_valued_at ? (
          <When iso={r.last_valued_at} />
        ) : (
          <span className="muted">{r.current_value_minor !== null ? "Re-pricing" : "Waiting"}</span>
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
