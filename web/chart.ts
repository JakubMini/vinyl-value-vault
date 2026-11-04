/** What the hand-drawn charts share: their width as laid out, and clean ticks for an axis from zero. */
import { useEffect, useRef, useState } from "react";

export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
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

/** Ticks from zero to at least `max` in steps of 1, 2 or 5 times a power of ten: about `count` of them. */
export function zeroTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw)!;
  const ticks = [];
  for (let t = 0; t < max + step; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return ticks;
}
