import { type FormEvent, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import type { RecordDetail, ValuationPoint } from "../../src/api-types";
import { GRADES, type Grade } from "../../src/grades";
import { ApiError } from "../api";
import { ErrorState, Loading, When } from "../components";
import { count, dateTime, formatMinor } from "../format";
import { LineChart } from "../LineChart";
import { Listen } from "../Listen";
import { type RecordPatch, useDeleteRecord, useRecord, useRevalue, useUpdateRecord } from "../queries";

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
        <div className="actions">
          {r.discogs_url ? (
            <a className="button" href={r.discogs_url} target="_blank" rel="noreferrer">
              View on Discogs ↗
            </a>
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

function ValueCard({ record: r }: { record: RecordDetail }) {
  const revalue = useRevalue(r.id);
  const how =
    r.latest_method === "lowest_listing"
      ? "The cheapest copy for sale on Discogs."
      : r.latest_method === "price_suggestion"
        ? `Discogs' suggested price for a ${r.media_condition} copy.`
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
          "Being re-priced after a grade change."
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
        <p className="muted">
          {r.latest_method === null
            ? "Shown once the record has a price."
            : "Discogs is not giving this account price suggestions, so the value is the cheapest copy for sale and does not change with the grade. Filling in seller settings on Discogs turns suggestions on."}
        </p>
      )}
    </div>
  );
}

function History({ record: r }: { record: RecordDetail }) {
  const points = [...r.valuations].reverse().map((v) => ({ t: Date.parse(v.valued_at), value: v.value_minor, hollow: v.source === "regrade", v }));
  const currency = r.current_currency ?? points[0]?.v.currency ?? "GBP";
  return (
    <div className="card">
      <h2 className="card-title">Price history</h2>
      {points.length === 0 ? (
        <p className="muted">No prices yet.</p>
      ) : (
        <>
          <LineChart
            points={points}
            label={`Value of ${r.title} over time, ${count(points.length)} prices`}
            formatValue={(v) => formatMinor(v, currency)}
            formatTime={(t) => dateTime(new Date(t).toISOString())}
            describe={(p) => <span>{describe(p.v)}</span>}
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
  return v.method === "lowest_listing" ? "Cheapest for sale" : `Suggested for ${v.media_condition ?? "its grade"}`;
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
