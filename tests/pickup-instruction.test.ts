import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createShipment, type Actor } from "@/lib/shipments";
import { parseShipmentForm } from "@/lib/shipment-input";
import { buildInstructionMail, getTransportEmails, instructionChanges, parseEmailList, sendPickupInstruction, setTransportEmails } from "@/lib/pickup-instruction";
import { formatInstructionDate, formatInstructionDateTime, fromManila } from "@/lib/time";
import { prisma, fixtures, input } from "./helpers";

let f: Awaited<ReturnType<typeof fixtures>>;
let cs: Actor;
const now = fromManila(2026, 10, 19, 9, 0);

beforeAll(async () => {
  f = await fixtures();
  cs = { id: f.cs.id, role: "CS" };
  delete process.env.SMTP_HOST; // mail goes to the outbox folder
  process.env.OUTBOX_DIR = await mkdtemp(path.join(tmpdir(), "nnr-outbox-"));
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

describe("instruction date formats", () => {
  it("writes dates as 13/NOV/2026 and 13/NOV/2026 13:00H in Manila time", () => {
    const d = fromManila(2026, 11, 13, 13, 0);
    expect(formatInstructionDate(d)).toBe("13/NOV/2026");
    expect(formatInstructionDateTime(d)).toBe("13/NOV/2026 13:00H");
    expect(formatInstructionDateTime(fromManila(2026, 1, 5, 7, 5))).toBe("05/JAN/2026 07:05H");
  });
});

describe("pick-up instruction fields", () => {
  it("reads the FCL fields, including reefers, and drops the LCL ones", () => {
    const r = parseShipmentForm(form({
      containerPlan: JSON.stringify([{ size: "20RF", qty: "2" }, { size: "40", qty: "1" }]),
      positioningAt: "2026-11-13T13:00", containerYard: "NYK CY Pasig", portOfLoading: "MICP/NORTH", cyCutoffAt: "2026-11-13",
      grossWeightKg: "1200", cbm: "4.5", pickupRemarks: "Genset needed",
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.containerPlan).toEqual([{ size: "20RF", qty: 2 }, { size: "40", qty: 1 }]);
    expect(formatInstructionDateTime(r.data.positioningAt)).toBe("13/NOV/2026 13:00H");
    expect(formatInstructionDate(r.data.cyCutoffAt)).toBe("13/NOV/2026");
    expect(r.data.portOfLoading).toBe("MICP/NORTH");
    expect(r.data.grossWeightKg).toBeNull(); // LCL-only, cleared for FCL
    expect(r.data.pickupRemarks).toBe("Genset needed");
  });

  it("reads the LCL fields and drops the FCL ones", () => {
    const r = parseShipmentForm(form({
      cargoType: "LCL", lclQty: "6", lclUnit: "PALLET", consolidator: "ACME Consol", grossWeightKg: "1,250.5", cbm: "7.25",
      cargoDescription: "Dried mango", cargoDimensions: "6 @ 120x100x150 cm", deliveryWarehouse: "CFS Pier 3", portOfLoading: "SUBIC",
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ consolidator: "ACME Consol", grossWeightKg: 1250.5, cbm: 7.25, deliveryWarehouse: "CFS Pier 3", portOfLoading: null });
  });

  it("rejects a port of loading that is not in the list, and bad numbers", () => {
    const r = parseShipmentForm(form({ portOfLoading: "MANILA" }));
    expect(!r.ok && r.fieldErrors.portOfLoading).toBeTruthy();
    const n = parseShipmentForm(form({ cargoType: "LCL", lclQty: "1", lclUnit: "BOX", cbm: "abc" }));
    expect(!n.ok && n.fieldErrors.cbm).toBeTruthy();
  });
});

describe("commodity, freight terms, Incoterms, vessel", () => {
  it("keeps the commodity for FCL and reads the booking-sheet fields", () => {
    const r = parseShipmentForm(form({ cargoDescription: "Coconut", freightTerms: "PREPAID", incoterm: "FOB", vesselName: "MAERSK KOWLOON", voyageNo: "245S" }));
    expect(r.ok && r.data).toMatchObject({ cargoDescription: "Coconut", freightTerms: "PREPAID", incoterm: "FOB", vesselName: "MAERSK KOWLOON", voyageNo: "245S" });
  });

  it("rejects values not in the lists", () => {
    const r = parseShipmentForm(form({ freightTerms: "MAYBE", incoterm: "XYZ" }));
    expect(!r.ok && Object.keys(r.fieldErrors).sort()).toEqual(["freightTerms", "incoterm"]);
  });
});

describe("required for FCL", () => {
  it("needs positioning and port of loading on new FCL shipments only", () => {
    const missing = parseShipmentForm(form({}), { requireInstruction: true });
    expect(!missing.ok && missing.fieldErrors).toMatchObject({ positioningAt: expect.any(String), portOfLoading: expect.any(String) });
    expect(parseShipmentForm(form({ positioningAt: "2026-11-13T13:00", portOfLoading: "SUBIC" }), { requireInstruction: true }).ok).toBe(true);
    expect(parseShipmentForm(form({ cargoType: "LCL", lclQty: "2", lclUnit: "BOX" }), { requireInstruction: true }).ok).toBe(true);
    expect(parseShipmentForm(form({})).ok).toBe(true); // not required unless asked (e.g. after pick-up)
  });

  it("lists the required fields together with other errors", () => {
    const r = parseShipmentForm(form({ shipperId: "" }), { requireInstruction: true });
    expect(!r.ok && Object.keys(r.fieldErrors).sort()).toEqual(["portOfLoading", "positioningAt", "shipperId"]);
  });
});

describe("transport emails", () => {
  it("parses a list, dropping duplicates and flagging bad ones", () => {
    expect(parseEmailList("a@x.com, B@x.com\nb@x.com; nope")).toEqual({ emails: ["a@x.com", "B@x.com"], invalid: ["nope"] });
  });

  it("does not send without a saved address, then sends and logs it", async () => {
    const s = await createShipment(prisma, input({
      shipperId: f.shipper.id, assignedCsId: f.cs.id, carrierBookingRef: "MAEU123",
      containerPlan: [{ size: "40HC", qty: 1 }], positioningAt: fromManila(2026, 11, 13, 13, 0), portOfLoading: "SOUTH/ATI",
    }), cs, { now });

    await setTransportEmails(prisma, []);
    expect(await sendPickupInstruction(prisma, s.id, f.cs.id, now)).toEqual({ status: "no_recipients" });

    await setTransportEmails(prisma, ["dispatch@truck.test"]);
    expect(await getTransportEmails(prisma)).toEqual(["dispatch@truck.test"]);
    const r = await sendPickupInstruction(prisma, s.id, f.cs.id, now);
    expect(r).toEqual({ status: "sent", to: ["dispatch@truck.test"] });

    const after = await prisma.shipment.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.pickupInstructionSentAt?.getTime()).toBe(now.getTime());
    const ev = await prisma.milestoneEvent.findFirst({ where: { shipmentId: s.id, type: "PICKUP_INSTRUCTION_SENT" } });
    expect(ev).not.toBeNull();

    const files = await readdir(process.env.OUTBOX_DIR!);
    const mail = JSON.parse(await readFile(path.join(process.env.OUTBOX_DIR!, files[0]), "utf8"));
    expect(mail.to).toEqual(["dispatch@truck.test"]);
    expect(mail.subject).toBe(`ATW for ${f.shipper.name} / MAEU123 / 1x40HC / ${s.hblNo}`);
    expect(mail.text).toContain("13/NOV/2026 13:00H");
    expect(mail.text).toContain("SOUTH/ATI");
    expect(mail.text).toContain("1x40HC");
    expect(mail.text).toContain("MAEU123");
  });

  it("sends a REVISED instruction after the first one, and only then", async () => {
    await setTransportEmails(prisma, ["dispatch@truck.test"]);
    const s = await createShipment(prisma, input({ shipperId: f.shipper.id, assignedCsId: f.cs.id }), cs, { now });
    await sendPickupInstruction(prisma, s.id, f.cs.id, now, { revised: true }); // nothing sent before: not "revised"
    await sendPickupInstruction(prisma, s.id, f.cs.id, now, { revised: true });
    const evs = await prisma.milestoneEvent.findMany({ where: { shipmentId: s.id, type: "PICKUP_INSTRUCTION_SENT" }, orderBy: { id: "asc" } });
    expect(evs.map((e) => JSON.parse(e.value!).revised).sort()).toEqual([false, true]);
    const full = await prisma.shipment.findUniqueOrThrow({ where: { id: s.id }, include: { shipper: true } });
    const mail = buildInstructionMail(full, { revised: true, previousSentAt: fromManila(2026, 10, 19, 9, 0) });
    expect(mail.subject).toMatch(/^REVISED ATW for /);
    expect(mail.text).toContain("REVISED PICK-UP INSTRUCTION (FCL)");
    expect(mail.text).toContain("19/OCT/2026 09:00H");
  });

  it("detects edits that change the instruction", async () => {
    const s = await createShipment(prisma, input({ shipperId: f.shipper.id, assignedCsId: f.cs.id }), cs, { now });
    expect(instructionChanges(s, { ...s, carrierName: "Other line" })).toEqual([]);
    expect(instructionChanges(s, { ...s, positioningAt: now, containerPlan: [{ size: "20RF", qty: 1 }] })).toEqual(["containerPlan", "positioningAt"]);
  });

  it("escapes HTML in the email", async () => {
    const s = await createShipment(prisma, input({ shipperId: f.shipper.id, assignedCsId: f.cs.id, pickupRemarks: "<b>fragile</b>" }), cs, { now });
    const full = await prisma.shipment.findUniqueOrThrow({ where: { id: s.id }, include: { shipper: true } });
    const mail = buildInstructionMail(full);
    expect(mail.html).toContain("&lt;b&gt;fragile&lt;/b&gt;");
    expect(mail.html).not.toContain("<b>fragile</b>");
  });
});
