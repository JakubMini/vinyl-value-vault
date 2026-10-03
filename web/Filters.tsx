/**
 * Narrowing the collection: the tabs over the toolbar, the drawer that holds every criterion,
 * and the chips under the toolbar that say which are in force. Every control writes a whole
 * Selection; the page keeps it in the URL, so filters apply as they are chosen.
 */
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { type ActiveFilter, chooseTab, clearFilters, type FacetOption, type FacetOptions, type Selection, type Status, TABS, tabOf } from "../src/select";
import { count, formatMinor, plural } from "./format";
import { type Range, RANGES } from "./range";

// --- Tabs -------------------------------------------------------------------------------------

export function ViewTabs({ selection, todo, onChange }: { selection: Selection; todo: number; onChange: (next: Selection) => void }) {
  const current = tabOf(selection).id;
  return (
    <div className="view-tabs" role="group" aria-label="Show">
      {TABS.map((t) => (
        <button key={t.id} type="button" className="view-tab" aria-pressed={t.id === current} onClick={() => onChange(chooseTab(selection, t.id))}>
          {t.label}
          {t.id === "todo" && todo > 0 ? <span className="tab-count">{count(todo)}</span> : null}
        </button>
      ))}
    </div>
  );
}

// --- Chips in force ---------------------------------------------------------------------------

export function FilterChips({ chips, selection, onChange }: { chips: ActiveFilter[]; selection: Selection; onChange: (next: Selection) => void }) {
  if (chips.length === 0) return null;
  return (
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
        <button type="button" className="link-button" onClick={() => onChange(clearFilters(selection))}>
          Clear
        </button>
      </li>
    </ul>
  );
}

// --- The drawer -------------------------------------------------------------------------------

type SectionId = "release" | "condition" | "music" | "value" | "paid" | "status";

/** Which drawer section each chip belongs to, so a section can say what is set inside it. */
function sectionOf(key: string): SectionId {
  if (key.startsWith("desc:") || ["decade", "kind", "discs"].includes(key)) return "release";
  if (key === "grade" || key === "sleeve") return "condition";
  if (["artist", "genre", "style", "label"].includes(key)) return "music";
  if (["value", "move", "how", "scarce"].includes(key)) return "value";
  if (key === "paid" || key === "gain") return "paid";
  return "status";
}

interface DrawerProps {
  open: boolean;
  /** Called however the drawer closes: the close button, Escape, the backdrop, or "Show". */
  onClose: () => void;
  selection: Selection;
  options: FacetOptions;
  chips: ActiveFilter[];
  currency: string;
  /** The window the change figures cover. */
  range: Range;
  /** How many records the selection shows. */
  shown: number;
  onChange: (next: Selection) => void;
  onRange: (range: Range) => void;
}

/**
 * Every criterion, in a side sheet (full screen on a phone). A native modal dialog: the page
 * behind is inert, Escape closes it, and a click on the backdrop does too.
 */
export function FilterDrawer({ open, onClose, ...body }: DrawerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pressed = useRef<EventTarget | null>(null);
  const titleId = useId();

  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  const close = () => dialog.current?.close();

  return (
    <dialog
      ref={dialog}
      className="filter-drawer"
      aria-modal="true"
      aria-labelledby={titleId}
      onClose={onClose}
      onMouseDown={(e) => {
        pressed.current = e.target;
      }}
      onClick={(e) => {
        // Only a click that starts and ends on the backdrop, so dragging out of a box never closes it.
        if (e.target === e.currentTarget && pressed.current === e.currentTarget) close();
      }}
    >
      {/* Rendered only while open, so each opening starts with the folds worked out afresh. */}
      {open ? <DrawerBody {...body} titleId={titleId} onDone={close} /> : null}
    </dialog>
  );
}

function DrawerBody({
  selection: s,
  options,
  chips,
  currency,
  range,
  shown,
  onChange,
  onRange,
  titleId,
  onDone,
}: Omit<DrawerProps, "open" | "onClose"> & { titleId: string; onDone: () => void }) {
  const set = <K extends keyof Selection>(key: K, value: Selection[K]) => onChange({ ...s, [key]: value });
  /** One choice at a time: picking the chosen option again takes it off. */
  const one = <K extends keyof Selection>(key: K, off: Selection[K]) => ({
    selected: s[key] === off ? [] : [String(s[key])],
    onPick: (value: string, on: boolean) => set(key, (on ? value : off) as Selection[K]),
  });
  const said = (id: SectionId) => chips.filter((c) => sectionOf(c.key) === id).map((c) => c.label);

  return (
    <div className="drawer">
      <header className="drawer-head">
        <h2 id={titleId}>Filters</h2>
        <button type="button" className="drawer-close" aria-label="Close filters" onClick={onDone}>
          <span aria-hidden="true">×</span>
        </button>
      </header>

      <div className="drawer-body">
        <Section title="Release" summary={said("release")}>
          <Chips label="Decade" options={options.decade} {...one("decade", "")} />
          <Chips label="Format" options={options.kind} {...one("kind", "")} />
          <Chips label="Discs" options={options.discs} {...one("discs", "")} />
          <Chips
            label="Pressing"
            options={options.desc}
            selected={s.desc}
            onPick={(value, on) => set("desc", on ? [...s.desc, value] : s.desc.filter((d) => d !== value))}
          />
        </Section>

        <Section title="Condition" summary={said("condition")}>
          <Chips label="Media grade" options={options.grade} {...one("grade", "")} />
          <Chips label="Sleeve grade" options={options.sleeve} {...one("sleeve", "")} />
        </Section>

        <Section title="Music" summary={said("music")}>
          {s.artist ? <Chips label="Artist" options={[{ value: s.artist, label: s.artist }]} {...one("artist", "")} /> : null}
          <FacetSelect label="Genre" value={s.genre} options={options.genre} onChange={(v) => set("genre", v)} />
          <FacetSelect label="Style" value={s.style} options={options.style} onChange={(v) => set("style", v)} />
          <FacetSelect label="Label" value={s.label} options={options.label} onChange={(v) => set("label", v)} />
        </Section>

        <Section title="Value and price" summary={said("value")}>
          <MoneyRange min={s.min} max={s.max} currency={currency} onChange={(min, max) => onChange({ ...s, min, max })} />
          <Chips label="Price move" options={options.move} {...one("move", "")} />
          <Chips
            label="Measured over"
            options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
            selected={[range.value]}
            onPick={(value) => onRange(RANGES.find((r) => r.value === value) ?? range)}
          />
          <Chips label="Priced from" options={options.how} {...one("how", "")} />
          <Chips label="Copies for sale" options={options.scarce} selected={s.scarce ? ["yes"] : []} onPick={(_, on) => set("scarce", on)} />
        </Section>

        <Section title="What I paid" summary={said("paid")}>
          <Chips label="Price paid" options={options.paid} {...one("paid", "")} />
          <Chips label="Against what I paid" options={options.gain} {...one("gain", "")} />
        </Section>

        <Section title="Spotify and status" summary={said("status")}>
          <Chips label="Spotify" options={options.spotify} {...one("spotify", "")} />
          <Chips
            label="Status"
            options={options.status}
            selected={[s.status]}
            onPick={(value, on) => set("status", on ? (value as Status) : "collection")}
          />
        </Section>
      </div>

      <footer className="drawer-foot">
        <button type="button" className="button" disabled={chips.length === 0} onClick={() => onChange(clearFilters(s))}>
          Clear all
        </button>
        <button type="button" className="button button-primary" onClick={onDone}>
          Show {plural(shown, "record")}
        </button>
      </footer>
    </div>
  );
}

/** A fold in the drawer. It starts open only when something inside it is set, and says what. */
function Section({ title, summary, children }: { title: string; summary: string[]; children: ReactNode }) {
  const [open, setOpen] = useState(summary.length > 0);
  const id = useId();
  return (
    <section className="fsec">
      <h3>
        <button type="button" className="fsec-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
          <span className="fsec-title">{title}</span>
          {summary.length > 0 ? <span className="fsec-summary">{summary.join(" · ")}</span> : null}
          <span className="fsec-chevron" aria-hidden="true" />
        </button>
      </h3>
      <div id={id} className="fsec-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** A short set of options as toggle chips, each with how many records it would show. Nothing to choose, nothing shown. */
function Chips({
  label,
  options,
  selected,
  onPick,
}: {
  label: string;
  options: (Omit<FacetOption, "count"> & { count?: number })[];
  selected: readonly string[];
  onPick: (value: string, on: boolean) => void;
}) {
  const id = useId();
  if (options.length === 0) return null;
  return (
    <div className="facet">
      <span id={id}>{label}</span>
      <div className="toggles" role="group" aria-labelledby={id}>
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <button key={o.value} type="button" className="toggle" aria-pressed={on} onClick={() => onPick(o.value, !on)}>
              {o.label}
              {o.count !== undefined ? <small>{count(o.count)}</small> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A long list as a select, with a count on every option. */
function FacetSelect({ label, value, options, onChange }: { label: string; value: string; options: FacetOption[]; onChange: (value: string) => void }) {
  if (options.length === 0) return null;
  return (
    <label className="facet">
      <span>{label}</span>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option>
        {options.map((o) => (
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
