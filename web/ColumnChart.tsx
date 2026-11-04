/**
 * Columns along an ordered axis (release years): one series in one hue, from a zero baseline,
 * thin columns with rounded tops and air between them. Hovering, or the arrow keys once focused,
 * picks out a column and shows its figures. Only some x labels are printed (`tickEvery`); the
 * full figures are in a table for screen readers, so the tooltip never holds them hostage.
 */
import { type ReactNode, useMemo, useState } from "react";

import { useWidth, zeroTicks } from "./chart";

export interface Column {
  key: string;
  label: string;
  value: number;
  /** Extra lines for the tooltip and the table. */
  detail?: string;
}

const MARGIN = { top: 12, right: 8, bottom: 26, left: 36 };

export function ColumnChart({
  columns,
  label,
  format,
  showLabel,
  height = 200,
}: {
  columns: Column[];
  label: string;
  format: (value: number) => string;
  /** Whether the x label under this column is printed. */
  showLabel: (column: Column, index: number) => boolean;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const geo = useMemo(() => {
    if (columns.length === 0 || width === 0) return null;
    const innerW = Math.max(1, width - MARGIN.left - MARGIN.right);
    const innerH = height - MARGIN.top - MARGIN.bottom;
    const ticks = zeroTicks(Math.max(...columns.map((c) => c.value)), 3);
    const top = ticks[ticks.length - 1]!;
    const slot = innerW / columns.length;
    const barW = Math.max(1, Math.min(24, slot - 2));
    const y = (v: number) => MARGIN.top + innerH - (v / top) * innerH;
    const x = (i: number) => MARGIN.left + i * slot + (slot - barW) / 2;
    return { innerH, ticks, slot, barW, y, x, base: MARGIN.top + innerH };
  }, [columns, width, height]);

  const last = columns.length - 1;
  const shown = active !== null ? columns[active] : undefined;

  return (
    <div className="chart" ref={ref}>
      {geo ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          tabIndex={0}
          onPointerMove={(e) => {
            const px = e.clientX - e.currentTarget.getBoundingClientRect().left - MARGIN.left;
            setActive(Math.min(last, Math.max(0, Math.floor(px / geo.slot))));
          }}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? last + 1) - 1));
            else if (e.key === "ArrowRight") setActive((i) => Math.min(last, (i ?? -1) + 1));
            else if (e.key === "Escape") setActive(null);
            else return;
            e.preventDefault();
          }}
        >
          {geo.ticks.map((t) => (
            <g key={t}>
              <line className="chart-grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={geo.y(t)} y2={geo.y(t)} />
              <text className="chart-tick" x={MARGIN.left - 8} y={geo.y(t)} textAnchor="end" dominantBaseline="middle">
                {format(t)}
              </text>
            </g>
          ))}
          {columns.map((c, i) => {
            const h = geo.base - geo.y(c.value);
            if (h <= 0) return null;
            const x = geo.x(i);
            const r = Math.min(4, geo.barW / 2, h);
            // Rounded at the top, square on the baseline.
            const d = `M${x},${geo.base}V${geo.base - h + r}Q${x},${geo.base - h} ${x + r},${geo.base - h}H${x + geo.barW - r}Q${x + geo.barW},${geo.base - h} ${x + geo.barW},${geo.base - h + r}V${geo.base}Z`;
            return <path key={c.key} d={d} className={i === active ? "column column-active" : "column"} />;
          })}
          <line className="chart-axis" x1={MARGIN.left} x2={width - MARGIN.right} y1={geo.base} y2={geo.base} />
          {columns.map((c, i) =>
            showLabel(c, i) ? (
              <text key={c.key} className="chart-tick" x={geo.x(i) + geo.barW / 2} y={height - 8} textAnchor="middle">
                {c.label}
              </text>
            ) : null,
          )}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      {shown && geo && active !== null ? (
        <div className="chart-tooltip" role="status" style={{ left: Math.min(Math.max(geo.x(active) + geo.barW / 2, 70), width - 70), top: Math.max(geo.y(shown.value) - 8, 0) }}>
          <strong>{shown.label}</strong>
          <span>{format(shown.value)}</span>
          {shown.detail ? <span>{shown.detail}</span> : null}
        </div>
      ) : null}
      <SrTable caption={label} rows={columns.filter((c) => c.value > 0).map((c) => [c.label, format(c.value), c.detail ?? ""])} />
    </div>
  );
}

/** The figures behind a chart, for screen readers. */
export function SrTable({ caption, rows }: { caption: string; rows: ReactNode[][] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <tbody>
        {rows.map((cells, i) => (
          <tr key={i}>
            {cells.map((cell, j) => (
              <td key={j}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
