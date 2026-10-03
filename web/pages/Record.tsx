import { type FormEvent, type ReactNode, useId, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import type { RecordDetail, ValuationPoint } from "../../src/api-types";
import { GRADES, type Grade } from "../../src/grades";
import { annualisedReturn, standing } from "../../src/insights";
import { spotifyAlbumUrl } from "../../src/spotify";
import { ApiError } from "../api";
import { ErrorState, Loading, MoneyChange, When } from "../components";
import { count, dateTime, formatMinor } from "../format";
import { LineChart } from "../LineChart";
import { collectionLink } from "../links";
import { Listen } from "../Listen";
import { type RecordPatch, useDeleteRecord, useRecord, useRecords, useRevalue, useUpdateRecord } from "../queries";
import { over, RANGES, readRange, withRange } from "../range";
import { ActionsMenu, type MenuAction, useReturnFocus } from "../RecordMenu";
import "../record.css";

export function Record() {
  const id = Number(useParams().id);
  const record = useRecord(id);

  if (!Number.isInteger(id) || id <= 0) return <ErrorState error={new Error("No such record")} />;
  if (record.isPending) return <Loading />;
  if (record.isError) return <ErrorState error={record.error} />;

  const r = record.data;
  return (
    <section className="stack">
      <Link to="/collection" className="back">
        ← Collection
      </Link>
      <Header record={r} />
      <div className="card rec-prices">
        <History record={r} />
        <ByGrade record={r} />
      </div>
      <div className="rec-rows">
        <YourCopy record={r} />
        <Listen record={r} />
      </div>
    </section>
  );
}

/** Genres show first, up to this many; the rest, and every style, fold behind "+N". */
const TAGS_SHOWN = 3;

/** A catalogue number this short fits on the meta line; a longer one is left to the hover text. */
const SHORT_CATALOGUE = 14;

function Header({ record: r }: { record: RecordDetail }) {
  const catalogue = r.catalogue_number && r.catalogue_number.length <= SHORT_CATALOGUE ? r.catalogue_number : null;
  const meta = [r.artist, r.label, catalogue, r.year, r.format].filter(Boolean).join(" · ");
  const hidden = Boolean(r.country) || catalogue !== r.catalogue_number;
  const everything = [r.artist, r.label, r.catalogue_number, r.country, r.year, r.format].filter(Boolean).join(" · ");
  return (
    <div className="rec-head">
      {r.cover_image_url ? <img src={r.cover_image_url} alt={`Cover of ${r.title}`} className="cover" /> : <div className="cover" />}
      <div className="rec-title">
        <h1>{r.title}</h1>
        <p className="rec-meta" title={hidden ? everything : undefined}>
          {meta}
        </p>
      </div>
      <Figure record={r} />
      <div className="rec-extra">
        <Tags record={r} />
        <ul className="rec-dots rec-links">
          {r.spotify_album_id ? (
            <li>
              <a href={spotifyAlbumUrl(r.spotify_album_id)} target="_blank" rel="noreferrer" aria-label={`Play ${r.title} on Spotify`}>
                <span aria-hidden="true">▶ </span>Play
              </a>
            </li>
          ) : null}
          {r.discogs_url ? (
            <li>
              <a href={r.discogs_url} target="_blank" rel="noreferrer">
                Discogs ↗
              </a>
            </li>
          ) : null}
          <li>
            <Link to={collectionLink({ artist: r.artist, status: "all" })}>More by {r.artist}</Link>
          </li>
          {r.label ? (
            <li>
              <Link to={collectionLink({ label: r.label, status: "all" })}>More on {r.label}</Link>
            </li>
          ) : null}
        </ul>
        {r.discogs_removed_at ? (
          <p>
            <span className="badge">
              Gone from Discogs <When iso={r.discogs_removed_at} />
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Genres and styles, each a link to more like it. A few genres show; the rest wait behind "+N". */
function Tags({ record: r }: { record: RecordDetail }) {
  const [all, setAll] = useState(false);
  const tags = [...r.genres.map((name) => ({ kind: "genre" as const, name })), ...r.styles.map((name) => ({ kind: "style" as const, name }))];
  if (tags.length === 0) return null;
  const first = Math.min(r.genres.length > 0 ? r.genres.length : r.styles.length, TAGS_SHOWN);
  const rest = tags.slice(first);
  return (
    <ul className="rec-tags" aria-label="Genres and styles">
      {(all ? tags : tags.slice(0, first)).map((t) => (
        <li key={`${t.kind}:${t.name}`}>
          <Link className={t.kind === "genre" ? "rec-tag" : "rec-tag rec-tag-style"} to={collectionLink(t.kind === "genre" ? { genre: t.name } : { style: t.name })}>
            {t.name}
          </Link>
        </li>
      ))}
      {rest.length > 0 ? (
        <li>
          <button
            type="button"
            className="rec-tag rec-tag-more"
            aria-expanded={all}
            title={all ? undefined : rest.map((t) => t.name).join(", ")}
            onClick={() => setAll((open) => !open)}
          >
            {all ? "Fewer" : `+${rest.length}`}
            {all ? null : <span className="sr-only"> more</span>}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

/** The value, where it ranks, the grades, and the "⋯" menu with the rarer actions. */
function Figure({ record: r }: { record: RecordDetail }) {
  const records = useRecords();
  const revalue = useRevalue(r.id);
  const remove = useDeleteRecord();
  const navigate = useNavigate();
  const currency = r.current_currency ?? "GBP";
  const rank = records.data ? standing(records.data, r.id, currency) : null;

  const actions: MenuAction[] = [];
  if (r.discogs_release_id) {
    actions.push({ key: "revalue", label: revalue.isPending ? "Asking Discogs…" : "Revalue now", disabled: revalue.isPending, onSelect: () => revalue.mutate() });
  }
  actions.push({
    key: "delete",
    label: "Delete from the vault",
    danger: true,
    disabled: remove.isPending,
    onSelect: () => {
      const message =
        r.discogs_instance_id !== null
          ? `Delete "${r.title}" and its price history? It stays in your Discogs collection, and future syncs will leave it out.`
          : `Delete "${r.title}" and its price history?`;
      if (window.confirm(message)) remove.mutate(r.id, { onSuccess: () => navigate("/collection") });
    },
  });

  let status = "";
  if (revalue.isPending) status = "Asking Discogs…";
  else if (revalue.isSuccess) {
    const o = revalue.data.outcome;
    status = o.status === "valued" ? `Priced just now at ${formatMinor(o.valueMinor, currency)}.` : `No price this time: ${o.reason}.`;
  } else if (revalue.isError) {
    const upstream = revalue.error instanceof ApiError && revalue.error.body ? (revalue.error.body as { upstream_status?: number }).upstream_status : undefined;
    status = upstream === 429 ? "Discogs is busy right now. The vault will try again on its own." : `Could not price it: ${revalue.error.message}.`;
  }

  return (
    <div className="rec-figure">
      <div className="rec-figure-top">
        <div className={r.current_value ? "rec-value" : "rec-value rec-value-none"}>
          <span className="sr-only">Worth now: </span>
          {r.current_value ?? "Not priced yet"}
        </div>
        <ActionsMenu label="More actions" actions={actions} />
      </div>
      <ul className="rec-dots rec-standing">
        {rank ? (
          <li>
            <Link
              to={collectionLink({ status: "priced", sort: "value", dir: "desc" })}
              title={rank.of > 1 ? `Worth more than ${Math.round(rank.above * 100)}% of the priced records` : "The only priced record so far"}
            >
              #{rank.position} of {count(rank.of)}
            </Link>
          </li>
        ) : null}
        <li title="Media grade / sleeve grade">
          {r.media_condition} / {r.sleeve_condition}
        </li>
      </ul>
      <p className="rec-status" role="status">
        {status}
      </p>
      {remove.isError ? <ErrorState error={remove.error} /> : null}
    </div>
  );
}

/** How many grades show around the record's own before "Show all grades". */
const GRADES_SHOWN = 3;

function ByGrade({ record: r }: { record: RecordDetail }) {
  const [all, setAll] = useState(false);
  const listId = useId();
  const currency = r.current_currency ?? "GBP";
  const ladder = r.price_by_grade;

  let shown = ladder ?? [];
  if (ladder && !all) {
    const at = ladder.findIndex((g) => g.grade === r.media_condition);
    const from = at < 0 ? 0 : Math.max(0, Math.min(at - 1, ladder.length - GRADES_SHOWN));
    shown = ladder.slice(from, from + GRADES_SHOWN);
  }
  const why = ladder ? null : noLadder(r, currency);

  return (
    <div className="rec-col rec-grades">
      <h2 className="card-title">Price by grade</h2>
      {ladder ? (
        <>
          <ul id={listId} className="ladder">
            {shown.map(({ grade, value_minor }) => (
              <li key={grade} className={grade === r.media_condition ? "current" : undefined}>
                <span className="ladder-grade">{grade}</span>
                <span className="ladder-value">{value_minor !== null ? formatMinor(value_minor, currency) : "—"}</span>
                {grade === r.media_condition ? <span className="ladder-note">yours</span> : null}
              </li>
            ))}
          </ul>
          {ladder.length > GRADES_SHOWN ? (
            <button type="button" className="rec-text-button" aria-expanded={all} aria-controls={listId} onClick={() => setAll((open) => !open)}>
              {all ? "Show fewer" : "Show all grades"}
            </button>
          ) : null}
        </>
      ) : (
        <p className="muted" title={why?.more}>
          {why?.short}
        </p>
      )}
      <ValueNote record={r} />
    </div>
  );
}

/** Why there is no price at every grade, in a line, with what would change that on hover. */
function noLadder(r: RecordDetail, currency: string): { short: string; more?: string } {
  switch (r.suggestions) {
    case null:
      return { short: "Shown once the record has a price." };
    case "no_data":
      return {
        short: "Too few sales for Discogs to suggest prices.",
        more: "Until it can, the value is the cheapest copy for sale and does not change with the grade.",
      };
    case "wrong_currency":
      return {
        short: `Discogs suggests prices in a currency other than ${currency}.`,
        more: `So the value is the cheapest copy for sale. Set the selling currency in your Discogs seller settings to ${currency}.`,
      };
    default:
      return {
        short: "Discogs gives this account no price suggestions.",
        more: "So the value is the cheapest copy for sale and does not change with the grade. Filling in seller settings on Discogs turns suggestions on.",
      };
  }
}

/** Where the value came from, in one quiet line: "Discogs suggestion for VG+ · 59 for sale from £12.81 · priced yesterday". */
function ValueNote({ record: r }: { record: RecordDetail }) {
  const parts: { key: string; node: ReactNode; title?: string }[] = [];
  if (r.current_method === "price_suggestion") {
    parts.push({
      key: "how",
      node: `Discogs suggestion for ${r.media_condition}`,
      title: `Discogs' suggested price for ${article(r.media_condition)} ${r.media_condition} copy, based on its sales history`,
    });
    const m = market(r);
    if (m) parts.push({ key: "market", node: m });
  } else if (r.current_method === "lowest_listing") {
    parts.push({ key: "how", node: cheapest(r.current_num_for_sale), title: "The cheapest copy for sale on Discogs, in any grade: an asking price, not a sale" });
  }
  parts.push({
    key: "when",
    node: r.last_valued_at ? (
      <>
        priced <When iso={r.last_valued_at} />
      </>
    ) : r.current_value ? (
      "queued for a fresh price"
    ) : (
      "waiting for its first price"
    ),
  });

  return (
    <>
      <ul className="rec-dots rec-note">
        {parts.map((p) => (
          <li key={p.key} title={p.title}>
            {p.node}
          </li>
        ))}
      </ul>
      {r.last_valuation_error ? <p className="rec-note">Last attempt: {r.last_valuation_error}</p> : null}
    </>
  );
}

/** "an M", "an NM", "an F", but "a VG+": grades are read out letter by letter. */
function article(grade: Grade): string {
  return /^[MNF]/.test(grade) ? "an" : "a";
}

/** The market behind a suggested price: "59 for sale from £12.81". */
function market(r: RecordDetail): string {
  if (r.current_num_for_sale === null) return "";
  if (r.current_num_for_sale === 0) return "none for sale";
  const from = r.current_lowest_listing_minor !== null && r.current_currency ? ` from ${formatMinor(r.current_lowest_listing_minor, r.current_currency)}` : "";
  return `${count(r.current_num_for_sale)} for sale${from}`;
}

/** A value taken from the cheapest listing: what a seller asks, in any grade. */
function cheapest(forSale: number | null): string {
  if (forSale !== null && forSale > 1) return `Cheapest of ${count(forSale)} for sale, any grade`;
  return forSale === 1 ? "The only copy for sale" : "Cheapest copy for sale, any grade";
}

function History({ record: r }: { record: RecordDetail }) {
  const [params, setParams] = useSearchParams();
  const range = readRange(params);
  const since = Date.now() - range.days * 86_400_000;
  const all = [...r.valuations].reverse().map((v) => ({ t: Date.parse(v.valued_at), value: v.value_minor, hollow: v.source === "regrade", v }));
  const points = all.filter((p) => p.t >= since);
  const currency = r.current_currency ?? all[0]?.v.currency ?? "GBP";
  const lowest = points.filter((p) => p.v.lowest_listing_minor !== null).map((p) => ({ t: p.t, value: p.v.lowest_listing_minor! }));
  return (
    <div className="rec-col">
      <div className="row-between">
        <h2 className="card-title">Price history</h2>
        {all.length > 0 ? (
          <div className="segmented" role="group" aria-label="Time range">
            {RANGES.map((o) => (
              <button key={o.value} type="button" aria-pressed={o === range} onClick={() => setParams((prev) => withRange(prev, o), { replace: true })}>
                {o.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {all.length === 0 ? (
        <p className="muted">No prices yet.</p>
      ) : points.length === 0 ? (
        <p className="muted">
          No prices {over(range)}. The last was {dateTime(all[all.length - 1]!.v.valued_at)}.
        </p>
      ) : (
        <>
          <LineChart
            points={points}
            label={`Value of ${r.title} over the last ${range.period}, ${count(points.length)} prices`}
            seriesLabel="Value"
            secondary={lowest.length > 0 ? { points: lowest, label: "Cheapest copy for sale, any grade" } : undefined}
            formatValue={(v) => formatMinor(v, currency)}
            formatTime={(t) => dateTime(new Date(t).toISOString())}
            describe={(p) => (
              <span>
                {describe(p.v)}
                {p.v.lowest_listing_minor !== null ? ` · cheapest ${formatMinor(p.v.lowest_listing_minor, p.v.currency)}` : ""}
              </span>
            )}
          />
          {points.some((p) => p.hollow) ? (
            <p className="rec-legend">
              <span className="rec-hollow" aria-hidden="true" />
              Worked out from a grade change
            </p>
          ) : null}
          <details className="history-table">
            <summary>Every price ({count(points.length)})</summary>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Grade</th>
                    <th scope="col">How</th>
                    <th scope="col" className="num">
                      Value
                    </th>
                    <th scope="col" className="num">
                      Cheapest
                    </th>
                    <th scope="col" className="num">
                      For sale
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {r.valuations.map((v) => (
                    <tr key={v.id}>
                      <td>{dateTime(v.valued_at)}</td>
                      <td>{v.media_condition ?? "—"}</td>
                      <td>{describe(v)}</td>
                      <td className="num">{formatMinor(v.value_minor, v.currency)}</td>
                      <td className="num">{v.lowest_listing_minor !== null ? formatMinor(v.lowest_listing_minor, v.currency) : "—"}</td>
                      <td className="num">{v.num_for_sale ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function describe(v: ValuationPoint): string {
  if (v.source === "regrade") return `Regraded to ${v.media_condition ?? "?"}`;
  return v.method === "lowest_listing" ? "Cheapest listed (asking)" : `Suggested for ${v.media_condition ?? "its grade"}`;
}

const dayFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** "2024-03-01" as "1 Mar 2024". */
function day(date: string): string {
  const t = Date.parse(`${date}T00:00:00.000Z`);
  return Number.isFinite(t) ? dayFormat.format(t) : date;
}

/** What is said about this copy, in one line, with the form one click away. Grading happens here. */
function YourCopy({ record: r }: { record: RecordDetail }) {
  const [editing, setEditing] = useState(false);
  const editButton = useReturnFocus<HTMLButtonElement>(editing);
  if (editing) return <EditCopy key={r.updated_at} record={r} onClose={() => setEditing(false)} />;

  const paid = r.purchase_price_minor !== null ? formatMinor(r.purchase_price_minor, r.purchase_currency ?? "GBP") : null;
  const bought = r.purchased_on ? day(r.purchased_on) : null;
  const gain = r.purchase_price_minor !== null && r.purchase_currency === r.current_currency && r.current_value_minor !== null ? r.current_value_minor - r.purchase_price_minor : null;
  const yearly = annualisedReturn(r);
  const notes = r.notes?.replace(/\s+/g, " ").trim() || null;

  return (
    <div className="rec-row">
      <h2 className="rec-row-label">Your copy</h2>
      <ul className="rec-dots rec-row-body">
        <li>
          {r.media_condition} media, {r.sleeve_condition} sleeve
        </li>
        <li>{paid && bought ? `paid ${paid} on ${bought}` : paid ? `paid ${paid}` : bought ? `bought ${bought}` : "purchase not noted"}</li>
        {gain !== null ? (
          <li title="Worth now against what was paid">
            <MoneyChange minor={gain} currency={r.current_currency} />
            {yearly !== null ? ` (${yearly >= 0 ? "+" : "−"}${Math.round(Math.abs(yearly) * 100)}% a year)` : null}
          </li>
        ) : null}
        <li>
          {notes ? (
            <span className="rec-copy-notes" title={r.notes ?? undefined}>
              {notes}
            </span>
          ) : (
            "no notes"
          )}
        </li>
      </ul>
      <button ref={editButton} type="button" className="rec-text-button rec-row-action" aria-label="Edit your copy" onClick={() => setEditing(true)}>
        Edit
      </button>
    </div>
  );
}

function EditCopy({ record: r, onClose }: { record: RecordDetail; onClose: () => void }) {
  const update = useUpdateRecord();
  const [media, setMedia] = useState<Grade>(r.media_condition);
  const [sleeve, setSleeve] = useState<Grade>(r.sleeve_condition);
  const [price, setPrice] = useState(r.purchase_price_minor !== null ? (r.purchase_price_minor / 100).toFixed(2) : "");
  const [currency, setCurrency] = useState(r.purchase_currency ?? "GBP");
  const [bought, setBought] = useState(r.purchased_on ?? "");
  const [notes, setNotes] = useState(r.notes ?? "");

  const priceMinor = price.trim() === "" ? null : Math.round(Number(price) * 100);
  const priceValid = priceMinor === null || (Number.isFinite(priceMinor) && priceMinor >= 0);

  const patch: RecordPatch = {};
  if (media !== r.media_condition) patch.media_condition = media;
  if (sleeve !== r.sleeve_condition) patch.sleeve_condition = sleeve;
  if (priceValid && priceMinor !== r.purchase_price_minor) patch.purchase_price_minor = priceMinor;
  if ((priceMinor === null ? r.purchase_currency : currency) !== r.purchase_currency) patch.purchase_currency = priceMinor === null ? null : currency;
  if ((bought || null) !== r.purchased_on) patch.purchased_on = bought || null;
  if ((notes.trim() || null) !== r.notes) patch.notes = notes.trim() || null;
  const dirty = Object.keys(patch).length > 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (dirty && priceValid) update.mutate({ id: r.id, patch }, { onSuccess: onClose });
  }

  return (
    <form className="rec-row rec-row-open form" onSubmit={submit}>
      <h2 className="rec-row-label">Your copy</h2>
      <div className="rec-row-body">
        <div className="form-grid">
          <label>
            <span>Media grade</span>
            {/* The form opens on the field it is mostly for: grading. */}
            <select className="input" value={media} autoFocus onChange={(e) => setMedia(e.target.value as Grade)}>
              {GRADES.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Sleeve grade</span>
            <select className="input" value={sleeve} onChange={(e) => setSleeve(e.target.value as Grade)}>
              {GRADES.map((g) => (
                <option key={g}>{g}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Paid</span>
            <input className="input" inputMode="decimal" placeholder="0.00" value={price} aria-invalid={!priceValid} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label>
            <span>Currency</span>
            <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {[...new Set(["GBP", "EUR", "USD", currency])].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Bought on</span>
            <input className="input" type="date" value={bought} onChange={(e) => setBought(e.target.value)} />
          </label>
        </div>
        <label>
          <span>Notes</span>
          <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        {!priceValid ? <p className="note">The price paid should be a number, like 18.50.</p> : null}
        {update.isError ? <ErrorState error={update.error} /> : null}
        <div className="actions rec-form-actions">
          <button type="submit" className="button button-primary" disabled={!dirty || !priceValid || update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </button>
          <button type="button" className="button" disabled={update.isPending} onClick={onClose}>
            Cancel
          </button>
          {media !== r.media_condition ? <span className="muted small">Saving re-prices it at {media}.</span> : null}
        </div>
      </div>
    </form>
  );
}
