import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createShipment, DomainError, editHblNo, recordMilestone, updateShipment, addAttachment, type Actor } from "@/lib/shipments";
import { fromManila, HOUR, DAY } from "@/lib/time";
import { prisma, fixtures, input } from "./helpers";

let f: Awaited<ReturnType<typeof fixtures>>;
let cs: Actor;
let sup: Actor;
const now = fromManila(2026, 10, 16, 9, 0);
const at = (ms: number) => new Date(now.getTime() + ms);

beforeAll(async () => {
  f = await fixtures();
  cs = { id: f.cs.id, role: "CS" };
  sup = { id: f.sup.id, role: "SUPERVISOR" };
});
afterAll(() => prisma.$disconnect());

const base = () => input({ shipperId: f.shipper.id, assignedCsId: f.cs.id });
const events = (id: string) => prisma.milestoneEvent.findMany({ where: { shipmentId: id }, orderBy: { occurredAt: "asc" } });

describe("createShipment", () => {
  it("assigns Job No. and HBL No., derives status, logs events", async () => {
    const s = await createShipment(prisma, { ...base(), requestedPickupAt: at(5 * HOUR), fsiCutoffAt: at(2 * DAY), etdMnl: at(4 * DAY) }, cs, { now });
    expect(s.jobNo).toMatch(/^EX-O-2610-\d{4}$/);
    expect(s.hblNo).toMatch(/^NNRO26\d{5}$/);
    expect(s.status).toBe("PICKUP_SCHEDULED");
    expect(s.bocDeadlineAt?.getTime()).toBe(at(2 * DAY - DAY).getTime()); // FSI cut-off - 24h
    expect(s.arrastreDeadlineAt?.getTime()).toBe(at(3 * DAY).getTime()); // ETD - 24h
    expect((await events(s.id)).map((e) => e.type)).toEqual(["CREATED", "NUMBERS_ASSIGNED", "PICKUP_SCHEDULED"]);
  });

  it("is BOOKED without a pick-up date", async () => {
    const s = await createShipment(prisma, base(), cs, { now });
    expect(s.status).toBe("BOOKED");
  });

  it("gives unique numbers to concurrent creates", { timeout: 60_000 }, async () => {
    const clients = Array.from({ length: 3 }, () => new PrismaClient());
    try {
      const made = await Promise.all(
        Array.from({ length: 15 }, (_, i) => createShipment(clients[i % 3], base(), cs, { now })),
      );
      expect(new Set(made.map((s) => s.jobNo)).size).toBe(15);
      expect(new Set(made.map((s) => s.hblNo)).size).toBe(15);
    } finally {
      await Promise.all(clients.map((c) => c.$disconnect()));
    }
  });

  it("rejects a non-CS assignee", async () => {
    await expect(createShipment(prisma, { ...base(), assignedCsId: f.field.id }, cs, { now })).rejects.toThrow(DomainError);
  });
});

describe("milestones drive the status machine", () => {
  it("walks the whole ocean flow and logs every step", async () => {
    let s = await createShipment(prisma, { ...base(), requestedPickupAt: at(-2 * DAY), etdMnl: at(-HOUR) }, cs, { now: at(-3 * DAY) });
    const step = async (m: Parameters<typeof recordMilestone>[2], expected: string) => {
      s = await recordMilestone(prisma, s.id, m, cs, { now, source: "WEB" });
      expect(s.status).toBe(expected);
    };
    await step({ kind: "PICKED_UP", at: at(-40 * HOUR) }, "PICKED_UP");
    await step({ kind: "FSI_SUBMITTED", at: at(-30 * HOUR) }, "FSI_DONE");
    await step({ kind: "PREADVISE_SENT", at: at(-29 * HOUR) }, "PREADVISED");
    await step({ kind: "DECLARATION_STATUS", status: "FILED" }, "DECLARED");
    await step({ kind: "BOC_UPLOADED", at: at(-20 * HOUR) }, "BOC_UPLOADED");
    const proof = await addAttachment(prisma, s.id, "ARRASTRE_PROOF", { storageKey: "x/y.png", originalName: "or.png", mimeType: "image/png", sizeBytes: 10 }, cs.id);
    await step({ kind: "ARRASTRE_PAID", at: at(-10 * HOUR), attachmentId: proof.id }, "ARRASTRE_PAID");
    await step({ kind: "DOCS_SENT", at: at(-5 * HOUR), recipient: "ops@shipper.test", subject: "Export docs" }, "DOCS_SENT");
    await step({ kind: "DEPARTED", at: at(-HOUR), eta: at(10 * DAY) }, "DEPARTED");
    // ATA must be after ATD and not in the future: record it "later".
    s = await recordMilestone(prisma, s.id, { kind: "ARRIVED", at: at(9 * DAY) }, cs, { now: at(9 * DAY), source: "WEB" });
    expect(s.status).toBe("ARRIVED");
    s = await recordMilestone(prisma, s.id, { kind: "CLOSED" }, cs, { now: at(9 * DAY), source: "WEB" });
    expect(s.status).toBe("CLOSED");

    const types = (await events(s.id)).map((e) => e.type);
    expect(types.slice(-10)).toEqual([
      "PICKED_UP", "FSI_SUBMITTED", "PREADVISE_SENT", "DECLARATION_STATUS", "BOC_UPLOADED",
      "ARRASTRE_PAID", "DOCS_SENT", "DEPARTED", "ARRIVED", "CLOSED",
    ]);
    await expect(updateShipment(prisma, s.id, base(), cs, { now })).rejects.toThrow(/closed/);
  });

  it("rejects duplicates, future times, and out-of-place steps", async () => {
    const s = await createShipment(prisma, base(), cs, { now });
    await recordMilestone(prisma, s.id, { kind: "PICKED_UP", at: now }, cs, { now, source: "WEB" });
    await expect(recordMilestone(prisma, s.id, { kind: "PICKED_UP", at: now }, cs, { now, source: "WEB" })).rejects.toThrow(/already recorded/);
    await expect(recordMilestone(prisma, s.id, { kind: "FSI_SUBMITTED", at: at(2 * HOUR) }, cs, { now, source: "WEB" })).rejects.toThrow(/future/);
    await expect(recordMilestone(prisma, s.id, { kind: "ARRIVED", at: now }, cs, { now, source: "WEB" })).rejects.toThrow(/departure/);
    await expect(recordMilestone(prisma, s.id, { kind: "CLOSED" }, cs, { now, source: "WEB" })).rejects.toThrow(/arrived/);
  });

  it("requires proof for arrastre and skips it when the shipper pays", async () => {
    const s = await createShipment(prisma, base(), cs, { now });
    await expect(recordMilestone(prisma, s.id, { kind: "ARRASTRE_PAID", at: now, attachmentId: "00000000-0000-4000-8000-000000000000" }, cs, { now, source: "WEB" })).rejects.toThrow(/proof/);
    const byShipper = await createShipment(prisma, { ...base(), arrastreResponsibility: "SHIPPER", etdMnl: at(3 * DAY) }, cs, { now });
    expect(byShipper.arrastreDeadlineAt).toBeNull();
    await expect(recordMilestone(prisma, byShipper.id, { kind: "ARRASTRE_PAID", at: now, attachmentId: "x" }, cs, { now, source: "WEB" })).rejects.toThrow(/shipper/);
  });

  it("records the source and note for updates made on behalf of field staff", async () => {
    const s = await createShipment(prisma, base(), cs, { now });
    await recordMilestone(prisma, s.id, { kind: "PICKED_UP", at: now }, cs, { now, source: "CS_ON_BEHALF", note: "Carlo texted 08:55" });
    const e = (await events(s.id)).at(-1)!;
    expect(e).toMatchObject({ type: "PICKED_UP", source: "CS_ON_BEHALF", note: "Carlo texted 08:55", actorId: cs.id });
  });

  it("cancels without deleting, and blocks further changes", async () => {
    const s = await createShipment(prisma, base(), cs, { now });
    const c = await recordMilestone(prisma, s.id, { kind: "CANCELLED", reason: "Buyer postponed" }, cs, { now, source: "WEB" });
    expect(c.status).toBe("CANCELLED");
    expect(await prisma.shipment.findUnique({ where: { id: s.id } })).not.toBeNull();
    await expect(recordMilestone(prisma, s.id, { kind: "PICKED_UP", at: now }, cs, { now, source: "WEB" })).rejects.toThrow(/cancelled/);
  });
});

describe("updateShipment", () => {
  it("logs exactly the changed fields and recomputes deadlines", async () => {
    const s = await createShipment(prisma, { ...base(), fsiCutoffAt: at(2 * DAY) }, cs, { now });
    const u = await updateShipment(prisma, s.id, { ...base(), fsiCutoffAt: at(3 * DAY), carrierName: "ONE" }, cs, { now });
    expect(u.bocDeadlineAt?.getTime()).toBe(at(2 * DAY).getTime());
    const e = (await events(s.id)).at(-1)!;
    expect(e.type).toBe("FIELD_CHANGED");
    expect(Object.keys(JSON.parse(e.value!)).sort()).toEqual(["carrierName", "fsiCutoffAt"]);
  });

  it("writes nothing when nothing changed", async () => {
    const s = await createShipment(prisma, base(), cs, { now });
    const n = (await events(s.id)).length;
    await updateShipment(prisma, s.id, base(), cs, { now });
    expect((await events(s.id)).length).toBe(n);
  });

  it("writes nothing for an unchanged LCL shipment (no container plan)", async () => {
    const lcl = { ...base(), cargoType: "LCL" as const, containerPlan: [], lclQty: 6, lclUnit: "PALLET" as const };
    const s = await createShipment(prisma, lcl, cs, { now });
    const n = (await events(s.id)).length;
    await updateShipment(prisma, s.id, lcl, cs, { now });
    expect((await events(s.id)).length).toBe(n);
  });

  it("moves BOOKED to PICKUP_SCHEDULED when a pick-up date is added", async () => {
    const s = await createShipment(prisma, base(), cs, { now });
    const u = await updateShipment(prisma, s.id, { ...base(), requestedPickupAt: at(DAY) }, cs, { now });
    expect(u.status).toBe("PICKUP_SCHEDULED");
  });
});

describe("editHblNo", () => {
  it("is supervisor-only, audited, and never reuses a retired number", async () => {
    const a = await createShipment(prisma, base(), cs, { now });
    const old = a.hblNo!;
    await expect(editHblNo(prisma, a.id, "NNRO2699999", "typo", cs, { now })).rejects.toThrow(/supervisor/);
    await editHblNo(prisma, a.id, "NNRO2699999", "Carrier requested", sup, { now });
    const e = (await events(a.id)).at(-1)!;
    expect(e).toMatchObject({ type: "HBL_EDITED", note: "Carrier requested" });
    const b = await createShipment(prisma, base(), cs, { now });
    await expect(editHblNo(prisma, b.id, old, "reuse", sup, { now })).rejects.toThrow(/cannot be reused/);
    await expect(editHblNo(prisma, b.id, "NNRO2699999", "dup", sup, { now })).rejects.toThrow(/already uses/);
  });
});
