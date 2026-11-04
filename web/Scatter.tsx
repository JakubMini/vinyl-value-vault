/**
 * Every record as a dot: copies for sale across, value up, both on log scales, since a few
 * releases have hundreds of copies and a few records are worth a hundred times the rest. One hue; the dots carry a ring in the page colour so overlaps stay legible.
 * The nearest dot to the pointer is picked out with its title and figures, and a click opens it.
 * A hairline marks the scarcity line. The figures are also in a table for screen readers.
 */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { SrTable } from "./ColumnChart";
import { useWidth } from "./chart";

export interface Dot {
  id: number;
  title: string;
  artist: string;
  x: number;
  y: number;
}

const MARGIN = { top: 16, right: 16, bottom: 30, left: 48 };
const LOG_TICKS = [0, 1, 3, 10, 30, 100, 300, 1000, 3000];
/** Value ticks, in minor units: 10p to £10,000. */
const VALUE_TICKS = [10, 30, 100, 300, 1000, 3000, 10_000, 30_000, 100_000, 300_000, 1_000_000];
/** How close, in pixels, the pointer must come to a dot to pick it. */
const REACH = 28;

export function Scatter({
  dots,
  label,
  formatY,
  xLabel,
  marker,
  height = 300,
}: {
  dots: Dot[];
  label: string;
  formatY: (value: number) => string;
  xLabel: string;
  /** A vertical hairline at this x, with a word beside it. */
  marker?: { x: number; label: string };
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const navigate = useNavigate();

  const geo = useMemo(() => {
    if (dots.length === 0 || width === 0) return null;
    const innerW = Math.max(1, width - MARGIN.left - MARGIN.right);
    const innerH = height - MARGIN.top - MARGIN.bottom;
    const lx = (v: number) => Math.log10(v + 1);
    const xMax = Math.max(...dots.map((d) => d.x), 10);
    const xTop = lx(xMax);
    const values = dots.map((d) => Math.max(d.y, VALUE_TICKS[0]!));
    const lo = [...VALUE_TICKS].reverse().find((t) => t <= Math.min(...values)) ?? VALUE_TICKS[0]!;
    const hi = VALUE_TICKS.find((t) => t >= Math.max(...values)) ?? VALUE_TICKS[VALUE_TICKS.length - 1]!;
    const yTicks = VALUE_TICKS.filter((t) => t >= lo && t <= hi);
    const x = (v: number) => MARGIN.left + (lx(v) / xTop) * innerW;
    const y = (v: number) => MARGIN.top + innerH - ((Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * innerH;
    const xTicks = LOG_TICKS.filter((t) => t <= xMax * 1.05);
    return { x, y, yTicks, xTicks, base: MARGIN.top + innerH, points: dots.map((d) => ({ cx: x(d.x), cy: y(d.y) })) };
  }, [dots, width, height]);

  function pick(clientX: number, clientY: number, rect: DOMRect): number | null {
    if (!geo) return null;
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    let best: number | null = null;
    let bestD = REACH * REACH;
    geo.points.forEach((p, i) => {
      const d = (p.cx - px) ** 2 + (p.cy - py) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  const shown = active !== null ? dots[active] : undefined;
  const at = active !== null ? geo?.points[active] : undefined;

  return (
    <div className="chart" ref={ref}>
      {geo ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          className={active !== null ? "scatter is-picking" : "scatter"}
          onPointerMove={(e) => setActive(pick(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect()))}
          onPointerLeave={() => setActive(null)}
          onClick={() => {
            if (shown) navigate(`/records/${shown.id}`);
          }}
        >
          {geo.yTicks.map((t) => (
            <g key={t}>
              <line className="chart-grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={geo.y(t)} y2={geo.y(t)} />
              <text className="chart-tick" x={MARGIN.left - 8} y={geo.y(t)} textAnchor="end" dominantBaseline="middle">
                {formatY(t)}
              </text>
            </g>
          ))}
          <line className="chart-axis" x1={MARGIN.left} x2={width - MARGIN.right} y1={geo.base} y2={geo.base} />
          {geo.xTicks.map((t) => (
            <text key={t} className="chart-tick" x={geo.x(t)} y={geo.base + 18} textAnchor="middle">
              {t}
            </text>
          ))}
          {marker ? (
            <g>
              <line className="chart-marker" x1={geo.x(marker.x)} x2={geo.x(marker.x)} y1={MARGIN.top} y2={geo.base} />
              <text className="chart-tick" x={geo.x(marker.x) - 6} y={MARGIN.top + 4} textAnchor="end" dominantBaseline="hanging">
                {marker.label}
              </text>
            </g>
          ) : null}
          {geo.points.map((p, i) => (
            <circle key={dots[i]!.id} className="dot" cx={p.cx} cy={p.cy} r={4} />
          ))}
          {at ? <circle className="dot dot-active" cx={at.cx} cy={at.cy} r={6} /> : null}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      <p className="chart-axis-label">{xLabel}</p>
      {shown && at ? (
        <div className="chart-tooltip" role="status" style={{ left: Math.min(Math.max(at.cx, 110), width - 110), top: Math.max(at.cy - 12, 0) }}>
          <strong>{shown.title}</strong>
          <span>{shown.artist}</span>
          <span>
            {formatY(shown.y)} · {shown.x} for sale
          </span>
        </div>
      ) : null}
      <SrTable caption={label} rows={dots.map((d) => [`${d.title}, ${d.artist}`, formatY(d.y), `${d.x} for sale`])} />
    </div>
  );
}
