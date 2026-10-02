import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import type { RecordDetail, ValuationPoint } from "../../src/api-types";
import { GRADES, type Grade } from "../../src/grades";
import { annualisedReturn, standing } from "../../src/insights";
import { ApiError } from "../api";
import { ErrorState, Loading, MoneyChange, Tile, When } from "../components";
import { count, dateTime, formatMinor, plural } from "../format";
import { LineChart } from "../LineChart";
import { collectionLink } from "../links";
import { Listen } from "../Listen";
import { type RecordPatch, useDeleteRecord, useRecord, useRecords, useRevalue, useUpdateRecord } from "../queries";
import { RANGES, readRange, withRange } from "../range";

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
      <StandingTiles record={r} />
      <div className="split">
        <ValueCard record={r} />
        <GradeLadder record={r} />
      </div>
      <History record={r} />
      <Listen record={r} />
      <EditCopy key={r.updated_at} record={r} />
      <Danger record={r} />
    </section>
  );
}

function Header({ record: r }: { record: RecordDetail }) {
  const details = [r.label, r.catalogue_number, r.country, r.year, r.format].filter(Boolean).join(" · ");
  return (
    <div className="record-head">
      {r.cover_image_url ? <img src={r.cover_image_url} alt={`Cover of ${r.title}`} className="cover" /> : <div className="cover cover-empty" />}
      <div>
        <h1>{r.title}</h1>
        <p className="record-artist">{r.artist}</p>
        {details ? <p className="muted">{details}</p> : null}
        {r.genres.length + r.styles.length > 0 ? (
          <div className="chips" aria-label="Genres and styles, each a link to more like it">
            {r.genres.map((g) => (
              <Link key={`genre:${g}`} className="chip" to={collectionLink({ genre: g })}>
                {g}
              </Link>
            ))}
            {r.styles.map((st) => (
              <Link key={`style:${st}`} className="chip chip-quiet" to={collectionLink({ style: st })}>
                {st}
              </Link>
            ))}
          </div>
        ) : null}
        <div className="actions">
          {r.discogs_url ? (
            <a className="button" href={r.discogs_url} target="_blank" rel="noreferrer">
              View on Discogs ↗
            </a>
          ) : null}
          <Link className="button" to={collectionLink({ artist: r.artist, status: "all" })}>
            More by {r.artist}
          </Link>
          {r.label ? (
            <Link className="button" to={collectionLink({ label: r.label, status: "all" })}>
              More on {r.label}
            </Link>
          ) : null}
          {r.discogs_removed_at ? (
            <span className="badge badge-neutral">
              Gone from Discogs <When iso={r.discogs_removed_at} />
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Where this record stands in the collection, and what the purchase has returned. Uses the list the table already caches. */
function StandingTiles({ record: r }: { record: RecordDetail }) {
  const records = useRecords();
  const currency = r.current_currency ?? "GBP";
  const rank = records.data ? standing(records.data, r.id, currency) : null;
  const paid = r.purchase_price_minor !== null && r.purchase_currency === r.current_currency && r.current_value_minor !== null;
  const gain = paid ? r.current_value_minor! - r.purchase_price_minor! : null;
  const yearly = annualisedReturn(r);
  if (!rank && gain === null) return null;

  const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10 > 3 ? 0 : n % 10]}`;
  return (
    <div className="tiles">
      {rank ? (
        <Tile
          label="In the collection"
          value={`${ordinal(rank.position)} of ${count(rank.of)} by value`}
          detail={rank.of > 1 ? `Worth more than ${Math.round(rank.above * 100)}% of the priced records` : "The only priced record so far"}
          to={collectionLink({ status: "priced", sort: "value", dir: "desc" })}
        />
      ) : null}
      {gain !== null ? (
        <Tile
          label="Against what I paid"
          value={<MoneyChange minor={gain} currency={currency} />}
          detail={
            yearly !== null
              ? `${yearly >= 0 ? "+" : "−"}${Math.round(Math.abs(yearly) * 100)}% a year since ${r.purchased_on}`
              : r.purchased_on
                ? `Bought on ${r.purchased_on}; a yearly rate needs a month`
                : "Add the date bought below for a yearly rate"
          }
        />
      ) : null}
    </div>
  );
}

function ValueCard({ record: r }: { record: RecordDetail }) {
  const revalue = useRevalue(r.id);
  const how =
    r.current_method === "lowest_listing"
      ? cheapest(r.current_num_for_sale)
      : r.current_method === "price_suggestion"
        ? `Discogs' suggested price for ${article(r.media_condition)} ${r.media_condition} copy, based on its sales history. ${market(r)}`.trim()
        : null;

  let result: string | null = null;
  if (revalue.isSuccess) {
    const o = revalue.data.outcome;
    result = o.status === "valued" ? `Priced just now at ${formatMinor(o.valueMinor, r.current_currency ?? "GBP")}.` : `No price this time: ${o.reason}.`;
  } else if (revalue.isError) {
    const status = revalue.error instanceof ApiError && revalue.error.body ? (revalue.error.body as { upstream_status?: number }).upstream_status : undefined;
    result =
      status === 429
        ? "Discogs is busy right now (it limits requests from Cloudflare). The vault will try again on its own."
        : `Could not price it: ${revalue.error.message}.`;
  }

  return (
    <div className="card">
      <div className="hero-label">Worth now</div>
      <div className="value-big">{r.current_value ?? "Not priced yet"}</div>
      {how ? <p className="muted">{how}</p> : null}
      <p className="muted">
        {r.last_valued_at ? (
          <>
            Priced <When iso={r.last_valued_at} />.
          </>
        ) : r.current_value ? (
          "Queued for a fresh price."
        ) : (
          "Waiting for its first price."
        )}
      </p>
      {r.last_valuation_error ? <p className="note">Last attempt: {r.last_valuation_error}</p> : null}
      {r.discogs_release_id ? (
        <div className="actions">
          <button type="button" className="button" disabled={revalue.isPending} onClick={() => revalue.mutate()}>
            {revalue.isPending ? "Asking Discogs…" : "Revalue now"}
          </button>
        </div>
      ) : null}
      {result ? (
        <p className="muted" role="status">
          {result}
        </p>
      ) : null}
    </div>
  );
}

/** "an M", "an NM", "an F", but "a VG+": grades are read out letter by letter. */
function article(grade: Grade): string {
  return /^[MNF]/.test(grade) ? "an" : "a";
}

/** The market behind a suggested price: how many copies are up for sale, and from how much. */
function market(r: RecordDetail): string {
  if (r.current_num_for_sale === null) return "";
  if (r.current_num_for_sale === 0) return "None for sale right now.";
  const from = r.current_lowest_listing_minor !== null && r.current_currency ? `, from ${formatMinor(r.current_lowest_listing_minor, r.current_currency)}` : "";
  return `${count(r.current_num_for_sale)} ${r.current_num_for_sale === 1 ? "copy" : "copies"} for sale${from}.`;
}

/** How a value taken from the cheapest listing is described: it is what a seller asks, not what a copy sold for. */
function cheapest(forSale: number | null): string {
  const which = forSale !== null && forSale > 1 ? `The cheapest of ${count(forSale)} copies` : forSale === 1 ? "The only copy" : "The cheapest copy";
  return `${which} for sale on Discogs, in any grade: an asking price, not a sale.`;
}

/** Why there is no price at every grade, and what would change that. */
function noLadder(r: RecordDetail, currency: string): string {
  switch (r.suggestions) {
    case null:
      return "Shown once the record has a price.";
    case "no_data":
      return "Discogs has no suggested price for this release yet, because too few copies have sold. Until it does, the value is the cheapest copy for sale and does not change with the grade.";
    case "wrong_currency":
      return `Discogs is suggesting prices in a currency other than ${currency}, so the value is the cheapest copy for sale. Set the selling currency in your Discogs seller settings to ${currency}.`;
    default:
      return "Discogs is not giving this account price suggestions, so the value is the cheapest copy for sale and does not change with the grade. Filling in seller settings on Discogs turns suggestions on.";
  }
}

function GradeLadder({ record: r }: { record: RecordDetail }) {
  const currency = r.current_currency ?? "GBP";
  return (
    <div className="card">
      <h2 className="card-title">Price at every grade</h2>
      {r.price_by_grade ? (
        <ul className="ladder">
          {r.price_by_grade.map(({ grade, value_minor }) => (
            <li key={grade} className={grade === r.media_condition ? "current" : undefined}>
              <span className="ladder-grade">{grade}</span>
              <span className="ladder-value">{value_minor !== null ? formatMinor(value_minor, currency) : "—"}</span>
              {grade === r.media_condition ? <span className="ladder-note">your copy</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">{noLadder(r, currency)}</p>
      )}
    </div>
  );
}

function History({ record: r }: { record: RecordDetail }) {
  const [params, setParams] = useSearchParams();
  const range = readRange(params);
  const since = Date.now() - range.days * 86_400_000;
  const all = [...r.valuations].reverse().map((v) => ({ t: Date.parse(v.valued_at), value: v.value_minor, hollow: v.source === "regrade", v }));
  const points = all.filter((p) => p.t >= since);
  const currency = r.current_currency ?? all[0]?.v.currency ?? "GBP";
  const cheapest = points.filter((p) => p.v.lowest_listing_minor !== null).map((p) => ({ t: p.t, value: p.v.lowest_listing_minor! }));
  return (
    <div className="card">
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
        <p className="muted">No prices in the last {range.period}. The last was {dateTime(all[all.length - 1]!.v.valued_at)}.</p>
      ) : (
        <>
          <LineChart
            points={points}
            label={`Value of ${r.title} over the last ${range.period}, ${count(points.length)} prices`}
            seriesLabel="Value"
            secondary={cheapest.length > 0 ? { points: cheapest, label: "Cheapest copy for sale, any grade" } : undefined}
            formatValue={(v) => formatMinor(v, currency)}
            formatTime={(t) => dateTime(new Date(t).toISOString())}
            describe={(p) => (
              <span>
                {describe(p.v)}
                {p.v.lowest_listing_minor !== null ? ` · cheapest ${formatMinor(p.v.lowest_listing_minor, p.v.currency)}` : ""}
              </span>
            )}
          />
          {points.some((p) => p.hollow) ? <p className="muted small">Hollow points are prices worked out from a grade change.</p> : null}
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

function EditCopy({ record: r }: { record: RecordDetail }) {
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
    if (dirty && priceValid) update.mutate({ id: r.id, patch });
  }

  return (
    <form className="card form" onSubmit={submit}>
      <h2 className="card-title">Your copy</h2>
      <div className="form-grid">
        <label>
          <span>Media grade</span>
          <select className="input" value={media} onChange={(e) => setMedia(e.target.value as Grade)}>
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
          <input
            className="input"
            inputMode="decimal"
            placeholder="0.00"
            value={price}
            aria-invalid={!priceValid}
            onChange={(e) => setPrice(e.target.value)}
          />
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
      <label className="form-wide">
        <span>Notes</span>
        <textarea className="input" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {!priceValid ? <p className="note">The price paid should be a number, like 18.50.</p> : null}
      {update.isError ? <ErrorState error={update.error} /> : null}
      <div className="actions">
        <button type="submit" className="button button-primary" disabled={!dirty || !priceValid || update.isPending}>
          {update.isPending ? "Saving…" : "Save"}
        </button>
        {media !== r.media_condition ? <span className="muted small">A new media grade re-prices the record.</span> : null}
      </div>
    </form>
  );
}

function Danger({ record: r }: { record: RecordDetail }) {
  const remove = useDeleteRecord();
  const navigate = useNavigate();
  const fromDiscogs = r.discogs_instance_id !== null;
  return (
    <div className="danger">
      <button
        type="button"
        className="button button-danger"
        disabled={remove.isPending}
        onClick={() => {
          const message = fromDiscogs
            ? `Delete "${r.title}" and its price history? It stays in your Discogs collection, and future syncs will leave it out.`
            : `Delete "${r.title}" and its price history?`;
          if (window.confirm(message)) remove.mutate(r.id, { onSuccess: () => navigate("/collection") });
        }}
      >
        Delete from the vault
      </button>
      {remove.isError ? <ErrorState error={remove.error} /> : null}
    </div>
  );
}
