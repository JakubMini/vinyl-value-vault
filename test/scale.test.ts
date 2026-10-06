import { describe, expect, it } from "vitest";
import { valueScale } from "../src/scale";

describe("valueScale", () => {
  it("runs from the lowest value to the highest, not from zero", () => {
    const scale = valueScale([312_000, 318_450, 315_200]);
    expect(scale.lo).toBe(312_000);
    expect(scale.hi).toBe(318_450);
    expect(scale.ticks).toEqual([312_000, 314_000, 316_000, 318_000]);
  });

  it("keeps every gridline inside the span", () => {
    const { lo, hi, ticks } = valueScale([1_234, 1_871]);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    for (const tick of ticks) {
      expect(tick).toBeGreaterThanOrEqual(lo);
      expect(tick).toBeLessThanOrEqual(hi);
    }
  });

  it("never steps by less than one, since values are whole pence or counts", () => {
    const { ticks } = valueScale([1_000, 1_002]);
    expect(ticks).toEqual([1_000, 1_001, 1_002]);
    expect(valueScale([0, 10]).ticks.every(Number.isInteger)).toBe(true);
  });

  it("gives a flat line room either side, never below zero", () => {
    expect(valueScale([2_000, 2_000])).toMatchObject({ lo: 1_900, hi: 2_100 });
    expect(valueScale([0]).lo).toBe(0);
    expect(valueScale([0]).hi).toBe(1);
  });
});
