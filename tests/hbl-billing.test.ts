import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createShipment, DomainError, recordMilestone, revertMilestone, updateShipment, type Actor } from "@/lib/shipments";
import { parseShipmentForm } from "@/lib/shipment-input";
import { MilestoneFormSchema } from "@/lib/milestone-input";
import { formatInstructionDate, fromManila, toManilaInput, HOUR, DAY } from "@/lib/time";
import { UNBILLED_WHERE } from "@/lib/unbilled";
import { prisma, fixtures, input } from "./helpers";

let f: Awaited<ReturnType<typeof fixtures>>;
let cs: Actor;
let sup: Actor;
const now = fromManila(2026, 10, 19, 9, 0);
const at = (ms: number) => new Date(now.getTime() + ms);

beforeAll(async () => {
  f = await fixtures();
  cs = { id: f.cs.id, role: "CS" };
  sup = { id: f.sup.id, role: "SUPERVISOR" };
});
afterAll(() => prisma.$disconnect());

const uuid = "8c1f1d0e-3b7a-4b8e-9a51-1d2f3c4b5a69";
const form = (o: Record<string, string>) => {
  const fd = new FormData();
  const base: Record<string, string> = {
    shipperId: uuid, assignedCsId: uuid, destinationPort: "USLAX Los Angeles", pod: "USLGB Long Beach",
    cargoType: "FCL", containerPlan: JSON.stringify([{ size: "40HC", qty: "1" }]), arrastreResponsibility: "NNR",
  };
  for (const [k, v] of Object.entries({ ...base, ...o })) fd.set(k, v);
  return fd;
};
const base = () => input({ shipperId: f.shipper.id, assignedCsId: f.cs.id });

describe("HBL: NNR consolidation or Direct", () => {
  it("Direct needs a booking number, and no destination code", () => {
    const r = parseShipmentForm(form({ hblType: "DIRECT", destinationPort: "Somewhere", pod: "Somewhere" }));
    expect(!r.ok && r.fieldErrors.carrierBookingRef).toMatch(/required/);
    expect(!r.ok && r.fieldErrors.podCode).toBeUndefined();
    expect(parseShipmentForm(form({ hblType: "DIRECT", carrierBookingRef: "maeu 123" })).ok).toBe(false); // space not allowed
    expect(parseShipmentForm(form({ hblType: "DIRECT", carrierBookingRef: "MAEU240001" })).ok).toBe(true);
  });

  it("uses the booking number as the HBL and keeps them in step on edit", async () => {
    const s = await createShipment(prisma, { ...base(), hblType: "DIRECT", carrierBookingRef: "maeu240001" }, cs, { now });
    expect(s.hblNo).toBe("MAEU240001");
    const e = await updateShipment(prisma, s.id, { ...base(), hblType: "DIRECT", carrierBookingRef: "MAEU240002" }, cs, { now });
    expect(e.hblNo).toBe("MAEU240002");
    const ev = await prisma.milestoneEvent.findFirst({ where: { shipmentId: s.id, type: "HBL_EDITED" } });
    expect(JSON.parse(ev!.value!)).toEqual({ from: "MAEU240001", to: "MAEU240002" });
  });

  it("refuses a booking number that is already another shipment's HBL", async () => {
    await createShipment(prisma, { ...base(), hblType: "DIRECT", carrierBookingRef: "ONEY777" }, cs, { now });
    await expect(createShipment(prisma, { ...base(), hblType: "DIRECT", carrierBookingRef: "ONEY777" }, cs, { now })).rejects.toBeInstanceOf(DomainError);
  });

  it("switching Direct back to NNR issues an NNR number", async () => {
    const s = await createShipment(prisma, { ...base(), hblType: "DIRECT", carrierBookingRef: "COSU555" }, cs, { now });
    const e = await updateShipment(prisma, s.id, { ...base(), hblType: "NNR", carrierBookingRef: "COSU555" }, cs, { now });
    expect(e.hblNo).toMatch(/^NNRMNLLAXF\d{4,}$/);
  });
});

describe("dates", () => {
  it("keeps the entered cut-off date; ETD/ETA are dates only", () => {
    const r = parseShipmentForm(form({ positioningAt: "2026-11-13T13:00", cyCutoffAt: "2026-11-20", etdMnl: "2026-11-15", eta: "2026-12-01" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(formatInstructionDate(r.data.cyCutoffAt)).toBe("20/NOV/2026");
    expect(toManilaInput(r.data.cyCutoffAt)).toBe("2026-11-20T00:00");
    expect(toManilaInput(r.data.etdMnl)).toBe("2026-11-15T00:00");
    expect(toManilaInput(r.data.eta)).toBe("2026-12-01T00:00");
  });

  it("keeps only the date when a date and time is given (spreadsheet import)", () => {
    const r = parseShipmentForm(form({ etdMnl: "2026-11-15T22:30" }));
    expect(r.ok && toManilaInput(r.data.etdMnl)).toBe("2026-11-15T00:00");
  });

  it("allows ETA on the ETD date, not before it", () => {
    expect(parseShipmentForm(form({ etdMnl: "2026-11-15", eta: "2026-11-15" })).ok).toBe(true);
    expect(parseShipmentForm(form({ etdMnl: "2026-11-15", eta: "2026-11-14" })).ok).toBe(false);
  });

  it("departure ETA is a date", () => {
    const r = MilestoneFormSchema.parse({ kind: "DEPARTED", at: "2026-11-15T22:00", eta: "2026-11-30" });
    expect(r.kind === "DEPARTED" && toManilaInput(r.eta)).toBe("2026-11-30T00:00");
  });
});

describe("payments, billing and the unbilled list", () => {
  it("records E-track, shipping line and billing, even after closing; billing removes it from Unbilled", async () => {
    const s = await createShipment(prisma, { ...base(), requestedPickupAt: at(-5 * DAY), etdMnl: at(-3 * DAY) }, cs, { now });
    const unbilled = () => prisma.shipment.count({ where: { AND: [UNBILLED_WHERE, { id: s.id }] } });
    expect(await unbilled()).toBe(1);

    await recordMilestone(prisma, s.id, { kind: "DEPARTED", at: at(-3 * DAY), eta: at(-1 * DAY) }, cs, { now, source: "WEB" });
    await recordMilestone(prisma, s.id, { kind: "ARRIVED", at: at(-HOUR) }, cs, { now, source: "WEB" });
    await recordMilestone(prisma, s.id, { kind: "CLOSED" }, cs, { now, source: "WEB" });

    await recordMilestone(prisma, s.id, { kind: "ETRACK_PAID", at: at(-2 * HOUR) }, cs, { now, source: "WEB" });
    await recordMilestone(prisma, s.id, { kind: "SHIPPING_LINE_PAID", at: at(-2 * HOUR) }, cs, { now, source: "WEB" });
    const billed = await recordMilestone(prisma, s.id, { kind: "INVOICED", at: now, invoiceNo: "SI-0042" }, cs, { now, source: "WEB" });
    expect(billed).toMatchObject({ status: "CLOSED", invoiceNo: "SI-0042" });
    expect(await unbilled()).toBe(0);

    await expect(recordMilestone(prisma, s.id, { kind: "INVOICED", at: now, invoiceNo: null }, cs, { now, source: "WEB" })).rejects.toThrow(/already recorded/);

    // A supervisor can undo a billing recorded by mistake, even on a closed shipment.
    const undone = await revertMilestone(prisma, s.id, "INVOICED", "wrong shipment", sup, { now });
    expect(undone).toMatchObject({ invoicedAt: null, invoiceNo: null, status: "CLOSED" });
    expect(await unbilled()).toBe(1);
  });

  it("cancelled shipments are not billable and not listed", async () => {
    const s = await createShipment(prisma, base(), cs, { now });
    await recordMilestone(prisma, s.id, { kind: "CANCELLED", reason: "customer cancelled" }, cs, { now, source: "WEB" });
    await expect(recordMilestone(prisma, s.id, { kind: "INVOICED", at: now, invoiceNo: null }, cs, { now, source: "WEB" })).rejects.toBeInstanceOf(DomainError);
    expect(await prisma.shipment.count({ where: { AND: [UNBILLED_WHERE, { id: s.id }] } })).toBe(0);
  });
});
