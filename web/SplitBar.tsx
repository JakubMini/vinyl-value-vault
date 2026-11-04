/**
 * One whole split into a few parts: a thin bar with no text on it, and a legend beside it that
 * carries every name and figure. The parts are ordered (value tiers, grades), so they take steps
 * of one hue, strongest first; `tone` 0 is the de-emphasis grey for a remainder.
 */
import { Link } from "react-router";

export interface Part {
  key: string;
  label: string;
  value: number;
  /** 4 the strongest step of the accent ramp, 1 the lightest, 0 grey. */
  tone: 0 | 1 | 2 | 3 | 4;
  /** After the value, quietly: a share, a count. */
  detail?: string;
  to?: string | null;
}

export function SplitBar({ parts, label, format }: { parts: Part[]; label: string; format: (value: number) => string }) {
  const shown = parts.filter((p) => p.value > 0);
  const total = shown.reduce((sum, p) => sum + p.value, 0);
  if (total === 0) return null;
  return (
    <div className="split-chart">
      <div className="split-bar" role="img" aria-label={`${label}: ${shown.map((p) => `${p.label} ${format(p.value)}`).join(", ")}`}>
        {shown.map((p) => (
          <span key={p.key} className={`split-seg tone-${p.tone}`} style={{ flexGrow: p.value }} title={`${p.label}: ${format(p.value)}`} />
        ))}
      </div>
      <ul className="split-legend">
        {shown.map((p) => {
          const body = (
            <>
              <span className={`split-swatch tone-${p.tone}`} aria-hidden="true" />
              <span className="split-name">{p.label}</span>
              <span className="split-value">{format(p.value)}</span>
              {p.detail ? <span className="split-detail">{p.detail}</span> : null}
            </>
          );
          return (
            <li key={p.key}>
              {p.to ? (
                <Link to={p.to} className="split-item">
                  {body}
                </Link>
              ) : (
                <span className="split-item">{body}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
