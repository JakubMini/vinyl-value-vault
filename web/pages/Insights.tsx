/**
 * Insights: the collection taken apart, one question per section, each a chart or two and no
 * commentary. Everything is built from the collection list the other pages already load, so
 * no extra reads.
 */
import type { ReactNode } from "react";
import { Link } from "react-router";

import type { ListedRecord } from "../../src/api-types";
import { breakdown, type BreakdownKey, byYear, concentration, growth, listening, scarcity, type Slice, tiers, valueBands } from "../../src/insights";
import { SCARCE_COPIES } from "../../src/select";
import { type Bar, BarChart } from "../BarChart";
import { ColumnChart } from "../ColumnChart";
import { ErrorState, Loading, Stat } from "../components";
import { CoverGrid } from "../CoverGrid";
import { count, dateTime, formatWhole, plural, timeAgo } from "../format";
import { LineChart } from "../LineChart";
import { collectionLink } from "../links";
import { useCollection, useRecords } from "../queries";
import { Scatter } from "../Scatter";
import { type Part, SplitBar } from "../SplitBar";
import "../insights.css";

const percent = (share: number) => `${Math.round(share * 100)}%`;

/** How many rows the ranked lists show before folding the rest. */
const TOP = 8;

export function Insights() {
  const records = useRecords();
  const collection = useCollection();

  if (records.isPending || collection.isPending) return <Loading />;
  if (records.isError) return <ErrorState error={records.error} />;
  if (collection.isError) return <ErrorState error={collection.error} />;

  const currency = collection.data.currency;
  const rows = records.data.filter((r) => r.discogs_removed_at === null);
  const conc = concentration(rows, currency);
  const t = tiers(rows, currency);
  const l = listening(rows, currency);
  const sc = scarcity(rows, currency);
  const money = (minor: number) => formatWhole(minor, currency);

  return (
    <section className="stack ins">
      <header className="ins-head">
        <h1>Insights</h1>
      </header>

      <ul className="stats">
        <Stat value={conc.median_minor !== null ? money(conc.median_minor) : "—"} label="a typical record" title={conc.mean_minor !== null ? `The median; the average is ${money(conc.mean_minor)}` : undefined} />
        <Stat value={count(t.half_count)} label="records hold half the value" to={collectionLink({ status: "priced", sort: "value", dir: "desc" })} />
        <Stat value={count(sc.scarce.count)} label={`scarce, ${SCARCE_COPIES} or fewer for sale`} to={collectionLink({ scarce: true, sort: "forsale", dir: "asc" })} />
        <Stat value={rows.length > 0 ? percent(l.played / rows.length) : "—"} label="played at least once" to={collectionLink({ sort: "plays", dir: "desc" })} />
      </ul>

      <Money rows={rows} currency={currency} />
      <Era rows={rows} currency={currency} />
      <Sound rows={rows} currency={currency} />
      <People rows={rows} currency={currency} />
      <Condition rows={rows} currency={currency} />
      <Rarity rows={rows} currency={currency} />
      <Listening rows={rows} currency={currency} />
      <Growth rows={rows} />
    </section>
  );
}

interface Props {
  rows: ListedRecord[];
  currency: string;
}

/** A section: its question as a small label, then the charts. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card ins-section">
      <h2 className="card-title">{title}</h2>
      {children}
    </section>
  );
}

/** A labelled part of a section: a small heading over one chart. */
function Subsection({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div className="ins-part">
      <div className="ins-part-head">
        <h3>{title}</h3>
        {aside}
      </div>
      {children}
    </div>
  );
}

const average = (s: Slice) => (s.priced > 0 ? Math.round(s.value_minor / s.priced) : null);

/**
 * Slices as ranked bars of how many records, with the share and the average value after. The
 * folded remainder is left out: summed over many small slices it would set the scale for all.
 */
function countBars(slices: Slice[], total: number, currency: string): Bar[] {
  return slices.filter((s) => s.key !== "others").map((s) => {
    const avg = average(s);
    return {
      key: s.key,
      label: s.label,
      value: s.count,
      detail: [percent(s.count / Math.max(1, total)), avg !== null ? `avg ${formatWhole(avg, currency)}` : null].filter(Boolean).join(" · "),
      to: s.selection ? collectionLink({ ...s.selection, sort: "value", dir: "desc" }) : null,
      muted: s.selection === null,
    };
  });
}

function Money({ rows, currency }: Props) {
  const t = tiers(rows, currency);
  if (t.priced === 0) return null;
  const tones: Record<string, Part["tone"]> = { top: 4, middle: 3, bottom: 2 };
  const best = [...rows].filter((r) => r.current_value_minor !== null && r.current_currency === currency).sort((a, b) => b.current_value_minor! - a.current_value_minor!);
  const bands = valueBands(rows, currency);
  return (
    <Section title="Where the money is">
      <SplitBar
        label="Value by tier"
        format={(v) => formatWhole(v, currency)}
        parts={t.tiers.map((x) => ({ key: x.key, label: `${x.label}, ${plural(x.count, "record")}`, value: x.value_minor, tone: tones[x.key]!, detail: percent(x.share) }))}
      />
      <Subsection title="The most valuable" aside={<Link className="more-link" to={collectionLink({ status: "priced", sort: "value", dir: "desc" })}>See all</Link>}>
        <div className="shelf">
          <CoverGrid rows={best.slice(0, 6)} />
        </div>
      </Subsection>
      <Subsection title="Value bands">
        <BarChart
          label="Records in each value band"
          format={(v) => plural(v, "record")}
          bars={bands.map((b) => ({
            key: b.key,
            label: b.label,
            value: b.count,
            detail: b.count > 0 ? `${formatWhole(b.value_minor, currency)} · ${percent(b.share)} of value` : undefined,
            to: b.count > 0 && b.selection ? collectionLink({ ...b.selection, sort: "value", dir: "desc" }) : null,
          }))}
        />
      </Subsection>
    </Section>
  );
}

function Era({ rows, currency }: Props) {
  const { years, unknown } = byYear(rows, currency);
  if (years.length === 0) return null;
  const decades = breakdown(rows, "decade", currency).filter((s) => s.selection !== null);
  return (
    <Section title="When it was pressed">
      <Subsection title="Records by release year" aside={unknown > 0 ? <span className="ins-note">{count(unknown)} without a year</span> : undefined}>
        <ColumnChart
          label="Records by release year"
          format={(v) => count(v)}
          columns={years.map((y) => ({
            key: String(y.year),
            label: String(y.year),
            value: y.count,
            detail: y.count > 0 ? `${plural(y.count, "record")} · ${formatWhole(y.value_minor, currency)}` : undefined,
          }))}
          showLabel={(c, i) => Number(c.key) % 10 === 0 || (i === 0 && Number(c.key) % 10 < 7)}
        />
      </Subsection>
      <Subsection title="Average value by decade">
        <BarChart
          label="Average value per record, by decade"
          format={(v) => formatWhole(v, currency)}
          bars={decades.map((s) => ({
            key: s.key,
            label: s.label,
            value: average(s) ?? 0,
            detail: plural(s.count, "record"),
            to: collectionLink({ ...s.selection, sort: "value", dir: "desc" }),
          }))}
        />
      </Subsection>
    </Section>
  );
}

function Sound({ rows, currency }: Props) {
  const genres = breakdown(rows, "genre", currency, TOP, "count");
  const styles = breakdown(rows, "style", currency, TOP, "count");
  if (genres.length === 0) return null;
  return (
    <Section title="What it sounds like">
      <div className="ins-pair">
        <Subsection title="Genres">
          <BarChart label="Records by genre" format={count} bars={countBars(genres, rows.length, currency)} />
        </Subsection>
        <Subsection title="Styles">
          <BarChart label="Records by style" format={count} bars={countBars(styles, rows.length, currency)} />
        </Subsection>
      </div>
    </Section>
  );
}

function People({ rows, currency }: Props) {
  const artists = breakdown(rows, "artist", currency, TOP, "count").filter((s) => !/^various( artists)?$/i.test(s.key));
  const labels = breakdown(rows, "label", currency, TOP, "count");
  if (artists.length === 0 && labels.length === 0) return null;
  return (
    <Section title="Who is on the shelf">
      <div className="ins-pair">
        <Subsection title="Artists">
          <BarChart label="Records by artist" format={count} bars={countBars(artists, rows.length, currency)} />
        </Subsection>
        <Subsection title="Labels">
          <BarChart label="Records by label" format={count} bars={countBars(labels, rows.length, currency)} />
        </Subsection>
      </div>
    </Section>
  );
}

/** Grades as steps of the accent: the best grade the strongest, anything below VG in grey. */
const GRADE_TONE: Record<string, Part["tone"]> = { M: 4, NM: 3, "VG+": 2, VG: 1 };

function gradeParts(rows: ListedRecord[], by: Extract<BreakdownKey, "grade" | "sleeve">, currency: string): Part[] {
  return breakdown(rows, by, currency).map((s) => ({
    key: s.key,
    label: s.label,
    value: s.count,
    tone: GRADE_TONE[s.key] ?? 0,
    detail: percent(s.count / rows.length),
    to: s.selection ? collectionLink({ ...s.selection, sort: "value", dir: "desc" }) : null,
  }));
}

function Condition({ rows, currency }: Props) {
  if (rows.length === 0) return null;
  return (
    <Section title="Condition">
      <div className="ins-pair">
        <Subsection title="Media">
          <SplitBar label="Media grades" format={count} parts={gradeParts(rows, "grade", currency)} />
        </Subsection>
        <Subsection title="Sleeve">
          <SplitBar label="Sleeve grades" format={count} parts={gradeParts(rows, "sleeve", currency)} />
        </Subsection>
      </div>
    </Section>
  );
}

function Rarity({ rows, currency }: Props) {
  const dots = rows
    .filter((r) => r.current_num_for_sale !== null && r.current_value_minor !== null && r.current_currency === currency)
    .map((r) => ({ id: r.id, title: r.title, artist: r.artist, x: r.current_num_for_sale!, y: r.current_value_minor! }));
  if (dots.length === 0) return null;
  return (
    <Section title="Rarity and value">
      <Scatter
        dots={dots}
        label="Value against copies for sale, one dot per record"
        formatY={(v) => (v < 100 && currency === "GBP" ? `${v}p` : formatWhole(v, currency))}
        xLabel="Copies for sale on Discogs →"
        marker={{ x: SCARCE_COPIES, label: "scarce" }}
      />
    </Section>
  );
}

function Listening({ rows, currency }: Props) {
  const l = listening(rows, currency);
  if (l.played === 0) {
    return (
      <Section title="Listening">
        {null}
      </Section>
    );
  }
  return (
    <Section title="Listening">
      <SplitBar
        label="Played and never played"
        format={count}
        parts={[
          { key: "played", label: "Played", value: l.played, tone: 4, detail: percent(l.played / l.records), to: collectionLink({ sort: "plays", dir: "desc" }) },
          { key: "unplayed", label: "Never played", value: l.records - l.played, tone: 0, detail: percent(1 - l.played / l.records) },
        ]}
      />
      <Subsection title="Most played">
        <BarChart
          label="Most played records"
          format={(v) => plural(v, "play")}
          bars={l.most.map((r) => ({
            key: String(r.id),
            label: r.title,
            value: r.play_count,
            detail: r.last_played_at ? timeAgo(r.last_played_at) : undefined,
            to: `/records/${r.id}`,
            title: `${r.title} · ${r.artist}`,
          }))}
        />
      </Subsection>
    </Section>
  );
}

/** How the collection grew. Hidden until records have joined on more than one day: one day is a dot, not a line. */
function Growth({ rows }: { rows: ListedRecord[] }) {
  const points = growth(rows).map((p) => ({ t: p.t, value: p.count, p }));
  if (points.length < 2) return null;
  const day = (t: number) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return (
    <Section title="How the collection grew">
      <LineChart
        points={points}
        label={`Records in the collection over time, from ${dateTime(new Date(points[0]!.t).toISOString())}`}
        formatValue={(v) => count(v)}
        formatTime={day}
        describe={(pt) => <span>{`${plural(pt.p.added, "record")} added that day`}</span>}
      />
    </Section>
  );
}
