import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createShipment, recordMilestone, revertMilestone, DomainError, type Actor } from "@/lib/shipments";
import { runAlertTick } from "@/lib/alerts";
import { describeEvent } from "@/lib/event-text";
import { DEFAULT_RULES } from "@/lib/deadlines";
import { fromManila, HOUR, DAY } from "@/lib/time";
import { prisma, fixtures, input } from "./helpers";

let f: Awaited<ReturnType<typeof fixtures>>;
let cs: Actor;
let sup: Actor;
const due = fromManila(2026, 11, 3, 8, 0);
const at = (ms: number) => new Date(due.getTime() + ms);

beforeAll(async () => {
  f = await fixtures();
  cs = { id: f.cs.id, role: "CS" };
  sup = { id: f.sup.id, role: "SUPERVISOR" };
  if ((await prisma.deadlineRule.count()) === 0) for (const r of DEFAULT_RULES) await prisma.deadlineRule.create({ data: r });
});
afterAll(() => prisma.$disconnect());

const base = () => input({ shipperId: f.shipper.id, assignedCsId: f.cs.id });
const lastEvent = (id: string) => prisma.milestoneEvent.findFirstOrThrow({ where: { shipmentId: id }, orderBy: { occurredAt: "desc" } });

describe("revertMilestone", () => {
  it("is supervisor-only and needs a reason", async () => {
    const s = await createShipment(prisma, { ...base(), requestedPickupAt: due }, cs, { now: at(-DAY) });
    await recordMilestone(prisma, s.id, { kind: "PICKED_UP", at: at(-HOUR) }, cs, { now: at(-HOUR), source: "WEB" });
    await expect(revertMilestone(prisma, s.id, "PICKED_UP", "wrong job", cs, { now: due })).rejects.toThrow(/supervisor/);
    await expect(revertMilestone(prisma, s.id, "PICKED_UP", "  ", sup, { now: due })).rejects.toThrow(/reason/);
    await expect(revertMilestone(prisma, s.id, "FSI_SUBMITTED", "x", sup, { now: due })).rejects.toThrow(/not recorded/);
  });

  it("records and reverts docs sent to the overseas office", async () => {
    const s = await createShipment(prisma, base(), cs, { now: at(-DAY) });
    await recordMilestone(prisma, s.id, { kind: "DOCS_TO_OVERSEAS", at: at(-HOUR) }, cs, { now: at(-HOUR), source: "WEB" });
    expect(describeEvent(await lastEvent(s.id))).toBe("Export docs sent to overseas office at 03-Nov-2026 07:00");
    await expect(recordMilestone(prisma, s.id, { kind: "DOCS_TO_OVERSEAS", at: due }, cs, { now: due, source: "WEB" })).rejects.toThrow(/already recorded/);
    const after = await revertMilestone(prisma, s.id, "DOCS_TO_OVERSEAS", "Wrong shipment", sup, { now: due });
    expect(after.exportDocsToOverseasAt).toBeNull();
    expect(describeEvent(await lastEvent(s.id))).toBe("Reverted: docs sent to overseas office (was 03-Nov-2026 07:00)");
  });

  it("clears the step, logs old value and reason, recomputes status, and reopens the deadline's alerts", async () => {
    const s = await createShipment(prisma, { ...base(), requestedPickupAt: due }, cs, { now: at(-DAY) });
    await runAlertTick(prisma, at(MINUTES(1)), []); // DUE alert for pick-up
    await recordMilestone(prisma, s.id, { kind: "PICKED_UP", at: at(MINUTES(2)) }, cs, { now: at(MINUTES(2)), source: "WEB" });
    expect((await prisma.alert.findFirstOrThrow({ where: { shipmentId: s.id } })).resolution).toBe("COMPLETED");

    const after = await revertMilestone(prisma, s.id, "PICKED_UP", "Tapped on the wrong job", sup, { now: at(MINUTES(3)) });
    expect(after).toMatchObject({ actualPickupAt: null, status: "PICKUP_SCHEDULED" });
    const ev = await lastEvent(s.id);
    expect(ev).toMatchObject({ type: "REVERTED", note: "Tapped on the wrong job", actorId: f.sup.id });
    expect(describeEvent(ev)).toBe("Reverted: pick-up (was 03-Nov-2026 08:02)");
    expect(await prisma.alert.findFirstOrThrow({ where: { shipmentId: s.id } })).toMatchObject({ resolvedAt: null, resolution: null });

    // The deadline is watched again: escalation continues from here.
    await runAlertTick(prisma, at(2 * HOUR + MINUTES(1)), []);
    const levels = (await prisma.alert.findMany({ where: { shipmentId: s.id }, orderBy: { createdAt: "asc" } })).map((a) => a.level);
    expect(levels).toEqual(["DUE", "OVERDUE"]);
    // ...and the original pick-up event is still in the audit trail.
    expect(await prisma.milestoneEvent.count({ where: { shipmentId: s.id, type: "PICKED_UP" } })).toBe(1);
  });

  it("keeps the order of steps: arrival before departure, close before anything, un-cancel", async () => {
    const s = await createShipment(prisma, base(), cs, { now: at(-DAY) });
    await recordMilestone(prisma, s.id, { kind: "DEPARTED", at: at(-HOUR), eta: at(5 * DAY) }, cs, { now: at(-HOUR), source: "WEB" });
    await recordMilestone(prisma, s.id, { kind: "ARRIVED", at: at(4 * DAY) }, cs, { now: at(4 * DAY), source: "WEB" });
    await recordMilestone(prisma, s.id, { kind: "CLOSED" }, cs, { now: at(4 * DAY), source: "WEB" });
    await expect(revertMilestone(prisma, s.id, "ARRIVED", "x", sup, { now: at(4 * DAY) })).rejects.toThrow(/Re-open/);
    await revertMilestone(prisma, s.id, "CLOSED", "closed too early", sup, { now: at(4 * DAY) });
    await expect(revertMilestone(prisma, s.id, "DEPARTED", "x", sup, { now: at(4 * DAY) })).rejects.toThrow(/arrival/);
    const reopened = await revertMilestone(prisma, s.id, "ARRIVED", "wrong ATA", sup, { now: at(1 * DAY) });
    expect(reopened.status).toBe("DEPARTED");

    const c = await createShipment(prisma, base(), cs, { now: at(-DAY) });
    await recordMilestone(prisma, c.id, { kind: "CANCELLED", reason: "mistake" }, cs, { now: at(-HOUR), source: "WEB" });
    await expect(revertMilestone(prisma, c.id, "PICKED_UP", "x", sup, { now: due })).rejects.toThrow(DomainError);
    const back = await revertMilestone(prisma, c.id, "CANCELLED", "customer confirmed after all", sup, { now: due });
    expect(back).toMatchObject({ status: "BOOKED", cancelledAt: null, cancelReason: null });
    expect(JSON.parse((await lastEvent(c.id)).value!)).toMatchObject({ kind: "CANCELLED", cancelReason: "mistake" });
  });
});

function MINUTES(n: number) {
  return n * 60_000;
}
