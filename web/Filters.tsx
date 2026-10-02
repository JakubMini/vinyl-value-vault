/**
 * Narrowing the collection: the search box, the two everyday selects, a panel of further
 * criteria behind "More filters", the chips that show which are in force, and the quick
 * filters. Every control writes a whole Selection; the page keeps it in the URL.
 */
import { useEffect, useId, useState } from "react";

import { GRADES, type Grade } from "../src/grades";
import {
  activeFilters,
  clearFilters,
  type FacetOption,
  type FacetOptions,
  QUICK_FILTERS,
  quickFilterActive,
  type Selection,
  STATUSES,
  type Status,
  toggleQuickFilter,
} from "../src/select";
import { count, formatMinor } from "./format";

interface Props {
  selection: Selection;
  options: FacetOptions;
  currency: string;
  onChange: (next: Selection) => void;
}

export function Filters({ selection: s, options, currency, onChange }: Props) {
  const panelId = useId();
  const chips = activeFilters(s, (major) => formatMinor(Math.round(major * 100), currency));
  const [open, setOpen] = useState(chips.length > 0);
  const set = <K extends keyof Selection>(key: K, value: Selection[K]) => onChange({ ...s, [key]: value });

  return (
    <div className="filter-area">
      <div className="filters" role="search">
        <input
          type="search"
          className="input"
          placeholder="Search artist, title, label, catalogue number"
          aria-label="Search the collection"
          value={s.q}
          onChange={(e) => set("q", e.target.value)}
        />
        <select className="input" aria-label="Media grade" value={s.grade} onChange={(e) => set("grade", e.target.value as Grade | "")}>
          <option value="">Any grade</option>
          {GRADES.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select className="input" aria-label="Status" value={s.status} onChange={(e) => set("status", e.target.value as Status)}>
          {STATUSES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button type="button" className="button" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
          More filters
          {chips.length > 0 ? <span className="pill">{chips.length}</span> : null}
        </button>
      </div>

      <div id={panelId} className="facet-panel" hidden={!open}>
        <FacetSelect label="Decade" value={s.decade} options={options.decade} onChange={(v) => set("decade", v)} />
        <FacetSelect label="Format" value={s.kind} options={options.kind} onChange={(v) => set("kind", v as Selection["kind"])} />
        <FacetSelect label="Discs" value={s.discs} options={options.discs} onChange={(v) => set("discs", v as Selection["discs"])} />
        <FacetSelect label="Label" value={s.label} options={options.label} onChange={(v) => set("label", v)} />
        <FacetSelect label="Sleeve grade" value={s.sleeve} options={options.sleeve} onChange={(v) => set("sleeve", v as Grade | "")} />
        <FacetSelect label="Spotify" value={s.spotify} options={options.spotify} onChange={(v) => set("spotify", v as Selection["spotify"])} />
        <FacetSelect label="Price paid" value={s.paid} options={options.paid} onChange={(v) => set("paid", v as Selection["paid"])} />
        <FacetSelect label="Last 30 days" value={s.move} options={options.move} onChange={(v) => set("move", v as Selection["move"])} />
        <FacetSelect label="Against what I paid" value={s.gain} options={options.gain} onChange={(v) => set("gain", v as Selection["gain"])} />
        <MoneyRange min={s.min} max={s.max} currency={currency} onChange={(min, max) => onChange({ ...s, min, max })} />
        {options.desc.length > 0 ? (
          <div className="facet facet-wide">
            <span id={`${panelId}-pressing`}>Pressing</span>
            <div className="toggles" role="group" aria-labelledby={`${panelId}-pressing`}>
              {options.desc.map((o) => {
                const on = s.desc.includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    className="toggle"
                    aria-pressed={on}
                    onClick={() => set("desc", on ? s.desc.filter((d) => d !== o.value) : [...s.desc, o.value])}
                  >
                    {o.label}
                    <small>{count(o.count)}</small>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {chips.length > 0 ? (
        <ul className="chips" aria-label="Filters in force">
          {chips.map((chip) => (
            <li key={chip.key}>
              <button type="button" className="chip" onClick={() => onChange(chip.next)} aria-label={`Remove filter: ${chip.label}`}>
                {chip.label}
                <span aria-hidden="true" className="chip-x">
                  ×
                </span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" className="link-button" onClick={() => onChange(clearFilters(s))}>
              Clear filters
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}

/** A select with a count on every option. The option in force stays listed even when nothing else matches it. */
function FacetSelect({ label, value, options, onChange }: { label: string; value: string; options: FacetOption[]; onChange: (value: string) => void }) {
  const shown = !value || options.some((o) => o.value === value) ? options : [...options, { value, label: value, count: 0 }];
  return (
    <label className="facet">
      <span>{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option>
        {shown.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label} ({count(o.count)})
          </option>
        ))}
      </select>
    </label>
  );
}

/** "" for no bound, a number for a usable one, undefined while what is typed is not a number yet. */
function bound(text: string): number | null | undefined {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/** Two boxes for the value range. What is typed is kept while it is not yet a number; the URL only sees numbers. */
function MoneyRange({ min, max, currency, onChange }: { min: number | null; max: number | null; currency: string; onChange: (min: number | null, max: number | null) => void }) {
  const [minText, setMinText] = useState(min === null ? "" : String(min));
  const [maxText, setMaxText] = useState(max === null ? "" : String(max));
  // A chip removed elsewhere clears the box too.
  useEffect(() => {
    if (bound(minText) !== min) setMinText(min === null ? "" : String(min));
  }, [min]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (bound(maxText) !== max) setMaxText(max === null ? "" : String(max));
  }, [max]); // eslint-disable-line react-hooks/exhaustive-deps

  const symbol = formatMinor(0, currency).replace(/[\d.,\s]/g, "");
  return (
    <div className="facet">
      <span>Value, {symbol}</span>
      <div className="money-range">
        <input
          className="input"
          inputMode="decimal"
          placeholder="from"
          aria-label={`Lowest value in ${currency}`}
          aria-invalid={bound(minText) === undefined}
          value={minText}
          onChange={(e) => {
            setMinText(e.target.value);
            const next = bound(e.target.value);
            if (next !== undefined && next !== min) onChange(next, max);
          }}
        />
        <span aria-hidden="true">–</span>
        <input
          className="input"
          inputMode="decimal"
          placeholder="to"
          aria-label={`Highest value in ${currency}`}
          aria-invalid={bound(maxText) === undefined}
          value={maxText}
          onChange={(e) => {
            setMaxText(e.target.value);
            const next = bound(e.target.value);
            if (next !== undefined && next !== max) onChange(min, next);
          }}
        />
      </div>
    </div>
  );
}

export function QuickFilters({ selection, onChange }: { selection: Selection; onChange: (next: Selection) => void }) {
  return (
    <div className="quick" role="group" aria-label="Quick filters">
      {QUICK_FILTERS.map((f) => (
        <button key={f.id} type="button" className="toggle" aria-pressed={quickFilterActive(selection, f)} onClick={() => onChange(toggleQuickFilter(selection, f))}>
          {f.label}
        </button>
      ))}
    </div>
  );
}
