/**
 * A small time-series chart in plain SVG: one value over time.
 *
 * Quiet by design: hairline gridlines, a 2px line, a 10% area wash down to the bottom of the plot,
 * and the latest value labelled at the end of the line. The value axis is tight: it spans the
 * values shown, not zero to the top, so small moves are visible. A crosshair snaps to the nearest point on hover, and
 * the arrow keys walk the points when the chart has focus. Every number is also in a table on
 * the same page, so the tooltip never holds information hostage. A second series, for context
 * rather than the point, is drawn dashed in grey on the same scale, with a legend.
 */
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { valueScale } from "../src/scale";

export interface ChartPoint {
  t: number;
  value: number;
  /** Drawn hollow, e.g. a price worked out from a regrade rather than fetched. */
  hollow?: boolean;
}

interface Props<P extends ChartPoint> {
  points: P[];
  label: string;
  formatValue: (value: number) => string;
  /** For the tooltip. Axis labels pick their own format from the span of time shown. */
  formatTime: (t: number) => string;
  /** Extra lines for the tooltip, under the value and the date. */
  describe?: (point: P) => ReactNode;
  /** A second series on the same scale, drawn dashed and grey: context for the first, never the point. */
  secondary?: { points: ChartPoint[]; label: string };
  /** What the first series is called in the legend, shown only when there is a second. */
  seriesLabel?: string;
  height?: number;
}

const MARGIN = { top: 28, right: 16, bottom: 28, left: 64 };

const HOUR = 3_600_000;
const timeOfDay = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayMonth = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const monthYear = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric" });

/** Axis labels: times within a day and a half, days within four months, months beyond. */
function tickFormat(span: number): (t: number) => string {
  if (span <= 36 * HOUR) return (t) => timeOfDay.format(t);
  if (span <= 120 * 24 * HOUR) return (t) => dayMonth.format(t);
  return (t) => monthYear.format(t);
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export function LineChart<P extends ChartPoint>({ points, label, formatValue, formatTime, describe, secondary, seriesLabel = "Value", height = 240 }: Props<P>) {
  const [containerRef, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const geometry = useMemo(() => {
    if (points.length === 0 || width === 0) return null;
    const innerW = Math.max(1, width - MARGIN.left - MARGIN.right);
    const innerH = height - MARGIN.top - MARGIN.bottom;
    const first = points[0]!.t;
    const last = points[points.length - 1]!.t;
    // A single point sits in the middle of a day-wide window.
    const [t0, t1] = first === last ? [first - 43_200_000, last + 43_200_000] : [first, last];
    // The second series shares the scale but never sets the time window: it is context inside the first.
    const second = (secondary?.points ?? []).filter((p) => p.t >= t0 && p.t <= t1);
    const { lo, hi, ticks } = valueScale([...points.map((p) => p.value), ...second.map((p) => p.value)]);
    const x = (t: number) => MARGIN.left + ((t - t0) / (t1 - t0)) * innerW;
    const y = (v: number) => MARGIN.top + innerH - ((v - lo) / (hi - lo)) * innerH;
    const path = (cs: { x: number; y: number }[]) => cs.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join("");
    const coords = points.map((p) => ({ x: x(p.t), y: y(p.value) }));
    const line = path(coords);
    const secondLine = second.length > 1 ? path(second.map((p) => ({ x: x(p.t), y: y(p.value) }))) : null;
    const secondDot = second.length === 1 ? { x: x(second[0]!.t), y: y(second[0]!.value) } : null;
    const base = MARGIN.top + innerH;
    const area = `${line}L${coords[coords.length - 1]!.x.toFixed(1)},${base}L${coords[0]!.x.toFixed(1)},${base}Z`;
    const format = tickFormat(t1 - t0);
    const candidates = first === last ? [first] : [0, 1 / 3, 2 / 3, 1].map((f) => t0 + f * (t1 - t0));
    // Neighbouring ticks that would print the same label say nothing new; keep the first.
    const timeTicks = candidates
      .map((t) => ({ t, text: format(t) }))
      .filter((tick, i, all) => i === 0 || tick.text !== all[i - 1]!.text);
    return { innerW, innerH, ticks, y, x, coords, line, area, timeTicks, base, secondLine, secondDot };
  }, [points, secondary, width, height]);

  function nearest(clientX: number, rect: DOMRect): number {
    if (!geometry) return 0;
    const px = clientX - rect.left;
    let best = 0;
    for (let i = 1; i < geometry.coords.length; i++) {
      if (Math.abs(geometry.coords[i]!.x - px) < Math.abs(geometry.coords[best]!.x - px)) best = i;
    }
    return best;
  }

  const shown = active ?? null;
  const lastIndex = points.length - 1;
  const point = shown !== null ? points[shown] : undefined;
  const coord = shown !== null ? geometry?.coords[shown] : undefined;

  return (
    <div className="chart" ref={containerRef}>
      {geometry ? (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          tabIndex={0}
          onPointerMove={(e) => setActive(nearest(e.clientX, e.currentTarget.getBoundingClientRect()))}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setActive((i) => Math.max(0, (i ?? lastIndex) - 1));
            else if (e.key === "ArrowRight") setActive((i) => Math.min(lastIndex, (i ?? -1) + 1));
            else if (e.key === "Escape") setActive(null);
            else return;
            e.preventDefault();
          }}
        >
          {geometry.ticks.map((tick) => (
            <g key={tick}>
              <line className="chart-grid" x1={MARGIN.left} x2={width - MARGIN.right} y1={geometry.y(tick)} y2={geometry.y(tick)} />
              <text className="chart-tick" x={MARGIN.left - 8} y={geometry.y(tick)} textAnchor="end" dominantBaseline="middle">
                {formatValue(tick)}
              </text>
            </g>
          ))}
          <line className="chart-axis" x1={MARGIN.left} x2={width - MARGIN.right} y1={geometry.base} y2={geometry.base} />
          {geometry.timeTicks.map(({ t, text }) => {
            const x = geometry.x(t);
            const anchor = x <= MARGIN.left + 1 ? "start" : x >= width - MARGIN.right - 1 ? "end" : "middle";
            return (
              <text key={t} className="chart-tick" x={x} y={height - 8} textAnchor={points.length === 1 ? "middle" : anchor}>
                {text}
              </text>
            );
          })}
          <path className="chart-area" d={geometry.area} />
          {geometry.secondLine ? <path className="chart-line-secondary" d={geometry.secondLine} /> : null}
          {geometry.secondDot ? <circle className="chart-dot-secondary" cx={geometry.secondDot.x} cy={geometry.secondDot.y} r={3} /> : null}
          <path className="chart-line" d={geometry.line} />
          {points.map((p, i) =>
            p.hollow ? <circle key={i} className="chart-dot chart-dot-hollow" cx={geometry.coords[i]!.x} cy={geometry.coords[i]!.y} r={4} /> : null,
          )}
          <circle className="chart-dot" cx={geometry.coords[lastIndex]!.x} cy={geometry.coords[lastIndex]!.y} r={4} />
          <text className="chart-end-label" x={geometry.coords[lastIndex]!.x} y={geometry.coords[lastIndex]!.y - 12} textAnchor={lastIndex === 0 ? "middle" : "end"}>
            {formatValue(points[lastIndex]!.value)}
          </text>
          {coord ? (
            <>
              <line className="chart-crosshair" x1={coord.x} x2={coord.x} y1={MARGIN.top} y2={geometry.base} />
              <circle className="chart-dot chart-dot-active" cx={coord.x} cy={coord.y} r={5} />
            </>
          ) : null}
        </svg>
      ) : (
        <div style={{ height }} />
      )}
      {secondary ? (
        <div className="chart-legend" aria-label="Series">
          <span>
            <svg width="22" height="8" aria-hidden="true">
              <line className="chart-line" x1="1" x2="21" y1="4" y2="4" />
            </svg>
            {seriesLabel}
          </span>
          <span>
            <svg width="22" height="8" aria-hidden="true">
              <line className="chart-line-secondary" x1="1" x2="21" y1="4" y2="4" />
            </svg>
            {secondary.label}
          </span>
        </div>
      ) : null}
      {point && coord ? (
        <div
          className="chart-tooltip"
          role="status"
          style={{ left: Math.min(Math.max(coord.x, 90), width - 90), top: Math.max(coord.y - 12, 0) }}
        >
          <strong>{formatValue(point.value)}</strong>
          <span>{formatTime(point.t)}</span>
          {describe ? describe(point) : null}
        </div>
      ) : null}
    </div>
  );
}
