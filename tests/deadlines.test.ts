import { describe, expect, it } from "vitest";
import { computeCachedDeadlines, computeDueAt, DEFAULT_RULES, type DeadlineShipment } from "@/lib/deadlines";

const ship = (o: Partial<DeadlineShipment> = {}): DeadlineShipment => ({
  requestedPickupAt: new Date("2026-10-20T01:00:00Z"),
  fsiCutoffAt: new Date("2026-10-21T08:00:00Z"),
  preadviseCutoffAt: new Date("2026-10-22T08:00:00Z"),
  etdMnl: new Date("2026-10-24T04:00:00Z"),
  arrastreCutoffAt: new Date("2026-10-23T05:00:00Z"),
  arrastreResponsibility: "NNR",
  ...o,
});
const rule = (t: string) => DEFAULT_RULES.find((r) => r.deadlineType === t)!;

describe("deadline computation", () => {
  it("BOC upload = FSI cut-off - 24h by default", () => {
    expect(computeDueAt(rule("BOC_UPLOAD"), ship())?.toISOString()).toBe("2026-10-20T08:00:00.000Z");
  });

  it("arrastre = the arrastre cut-off entered by CS", () => {
    expect(computeDueAt(rule("ARRASTRE"), ship())?.toISOString()).toBe("2026-10-23T05:00:00.000Z");
    expect(computeDueAt(rule("ARRASTRE"), ship({ arrastreCutoffAt: null }))).toBeNull();
  });

  it("skips arrastre unless NNR is responsible", () => {
    expect(computeDueAt(rule("ARRASTRE"), ship({ arrastreResponsibility: "SHIPPER" }))).toBeNull();
  });

  it("returns null when the base date is unknown", () => {
    expect(computeDueAt(rule("BOC_UPLOAD"), ship({ fsiCutoffAt: null }))).toBeNull();
  });

  it("honours an edited rule and a disabled rule", () => {
    const edited = { ...rule("BOC_UPLOAD"), offsetMinutes: -48 * 60 };
    expect(computeDueAt(edited, ship())?.toISOString()).toBe("2026-10-19T08:00:00.000Z");
    expect(computeDueAt({ ...edited, enabled: false }, ship())).toBeNull();
  });

  it("rejects an unknown base field instead of silently skipping", () => {
    expect(() => computeDueAt({ ...rule("FSI"), baseField: "fsiCutoff" }, ship())).toThrow(/Unknown base field/);
  });

  it("computes both cached deadlines", () => {
    const r = computeCachedDeadlines(DEFAULT_RULES, ship());
    expect(r.bocDeadlineAt?.toISOString()).toBe("2026-10-20T08:00:00.000Z");
    expect(r.arrastreDeadlineAt?.toISOString()).toBe("2026-10-23T05:00:00.000Z");
  });
});
