/**
 * Horizontal bars in plain HTML: a label, a bar from a common baseline, the value and a note.
 * One hue, since the rows are one series; the list is its own table, so every figure is on the
 * page as text. A row with somewhere to go is a link to the collection narrowed to it.
 */
import { Link } from "react-router";

export interface Bar {
  key: string;
  label: string;
  value: number;
  /** Shown after the value, quietly. */
  detail?: string;
  /** Where the row leads, or null for a row that is several things folded together. */
  to?: string | null;
  /** Drawn in the de-emphasis gray: a tail, a remainder. */
  muted?: boolean;
  /** Hover text, for a row that needs a word of explanation, such as a folded remainder. */
  title?: string;
}

export function BarChart({ bars, format, label }: { bars: Bar[]; format: (value: number) => string; label: string }) {
  const max = Math.max(0, ...bars.map((b) => b.value));
  return (
    <ol className="bars" aria-label={label}>
      {bars.map((b) => {
        const width = max > 0 ? `${((b.value / max) * 100).toFixed(2)}%` : "0%";
        const body = (
          <>
            <span className="bar-label">{b.label}</span>
            <span className="bar-track" aria-hidden="true">
              <span className={b.muted ? "bar-fill bar-fill-muted" : "bar-fill"} style={{ width }} />
            </span>
            <span className="bar-figures">
              <span className="bar-value">{format(b.value)}</span>
              {b.detail ? <span className="bar-detail">{b.detail}</span> : null}
            </span>
          </>
        );
        return (
          <li key={b.key}>
            {b.to ? (
              <Link to={b.to} className="bar-row" title={b.title}>
                {body}
              </Link>
            ) : (
              <span className="bar-row" title={b.title}>
                {body}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
