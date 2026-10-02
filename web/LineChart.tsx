/**
 * A small time-series chart in plain SVG: one value over time.
 *
 * Quiet by design: hairline gridlines, a 2px line, a 10% area wash down to zero, and the latest
 * value labelled at the end of the line. A crosshair snaps to the nearest point on hover, and
 * the arrow keys walk the points when the chart has focus. Every number is also in a table on
 * the same page, so the tooltip never holds information hostage.
 */
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

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

/** A round step for about `count` gridlines between zero and max. */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  const ticks: number[] = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Math.round(v));
  return ticks;
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

export function LineChart<P extends ChartPoint>({ points, label, formatValue, formatTime, describe, height = 240 }: Props<P>) {
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
    const ticks = niceTicks(Math.max(...points.map((p) => p.value)));
    const yMax = ticks[ticks.length - 1]!;
    const x = (t: number) => MARGIN.left + ((t - t0) / (t1 - t0)) * innerW;
    const y = (v: number) => MARGIN.top + innerH - (v / yMax) * innerH;
    const coords = points.map((p) => ({ x: x(p.t), y: y(p.value) }));
    const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join("");
    const base = y(0);
    const area = `${line}L${coords[coords.length - 1]!.x.toFixed(1)},${base}L${coords[0]!.x.toFixed(1)},${base}Z`;
    const format = tickFormat(t1 - t0);
    const candidates = first === last ? [first] : [0, 1 / 3, 2 / 3, 1].map((f) => t0 + f * (t1 - t0));
    // Neighbouring ticks that would print the same label say nothing new; keep the first.
    const timeTicks = candidates
      .map((t) => ({ t, text: format(t) }))
      .filter((tick, i, all) => i === 0 || tick.text !== all[i - 1]!.text);
    return { innerW, innerH, ticks, y, x, coords, line, area, timeTicks, base };
  }, [points, width, height]);

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
              <line className={tick === 0 ? "chart-axis" : "chart-grid"} x1={MARGIN.left} x2={width - MARGIN.right} y1={geometry.y(tick)} y2={geometry.y(tick)} />
              <text className="chart-tick" x={MARGIN.left - 8} y={geometry.y(tick)} textAnchor="end" dominantBaseline="middle">
                {formatValue(tick)}
              </text>
            </g>
          ))}
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
