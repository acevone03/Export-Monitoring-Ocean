import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyFieldUpdate, createFieldLink, resolveFieldLink, revokeFieldLink } from "@/lib/field-links";
import { createShipment, recordMilestone, type Actor } from "@/lib/shipments";
import { hashToken } from "@/lib/tokens";
import { prisma, fixtures, input } from "./helpers";

let f: Awaited<ReturnType<typeof fixtures>>;
let cs: Actor;
const now = new Date();

beforeAll(async () => {
  f = await fixtures();
  cs = { id: f.cs.id, role: "CS" };
});
afterAll(() => prisma.$disconnect());

const newShipment = () => createShipment(prisma, { ...input({ shipperId: f.shipper.id, assignedCsId: f.cs.id }), requestedPickupAt: now }, cs, { now });
const events = (id: string) => prisma.milestoneEvent.findMany({ where: { shipmentId: id }, orderBy: { occurredAt: "asc" } });

describe("field links", () => {
  it("stores only the token hash and expires in 7 days", async () => {
    const s = await newShipment();
    const { token, expiresAt } = await createFieldLink(prisma, s.id, cs, f.field.id);
    const row = await prisma.fieldLink.findFirstOrThrow({ where: { shipmentId: s.id } });
    expect(row.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(Math.round((expiresAt.getTime() - Date.now()) / 86_400_000)).toBe(7);
    expect(await resolveFieldLink(prisma, token)).toMatchObject({ ok: true, assignee: { id: f.field.id } });
  });

  it("refuses unknown, expired, revoked links and closed shipments", async () => {
    const s = await newShipment();
    expect(await resolveFieldLink(prisma, "x".repeat(43))).toEqual({ ok: false, reason: "invalid" });
    expect(await resolveFieldLink(prisma, "../../etc")).toEqual({ ok: false, reason: "invalid" });

    const a = await createFieldLink(prisma, s.id, cs, null);
    await prisma.fieldLink.updateMany({ where: { tokenHash: hashToken(a.token) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await resolveFieldLink(prisma, a.token)).toEqual({ ok: false, reason: "expired" });

    const b = await createFieldLink(prisma, s.id, cs, null);
    const linkB = await prisma.fieldLink.findUniqueOrThrow({ where: { tokenHash: hashToken(b.token) } });
    await revokeFieldLink(prisma, linkB.id, s.id);
    expect(await resolveFieldLink(prisma, b.token)).toEqual({ ok: false, reason: "revoked" });

    const c = await createFieldLink(prisma, s.id, cs, null);
    await recordMilestone(prisma, s.id, { kind: "CANCELLED", reason: "test" }, cs, { now, source: "WEB" });
    expect(await resolveFieldLink(prisma, c.token)).toEqual({ ok: false, reason: "closed" });
    await expect(createFieldLink(prisma, s.id, cs, null)).rejects.toThrow(/closed/);
  });

  it("only field staff can be the assignee", async () => {
    const s = await newShipment();
    await expect(createFieldLink(prisma, s.id, cs, f.cs.id)).rejects.toThrow(/field person/);
  });
});

describe("applyFieldUpdate", () => {
  it("records pick-up and declaration as FIELD_LINK events under the field person's name", async () => {
    const s = await newShipment();
    const { token } = await createFieldLink(prisma, s.id, cs, f.field.id);
    expect(await applyFieldUpdate(prisma, token, "PICKED_UP", { note: "Loaded 2 units", photo: null, now })).toMatchObject({ ok: true, message: /recorded/ });
    expect(await applyFieldUpdate(prisma, token, "DECLARATION_FILED", { note: null, photo: null, now })).toMatchObject({ ok: true });
    expect(await applyFieldUpdate(prisma, token, "DECLARATION_RELEASED", { note: null, photo: null, now })).toMatchObject({ ok: true });

    const after = await prisma.shipment.findUniqueOrThrow({ where: { id: s.id } });
    expect(after.actualPickupAt).not.toBeNull();
    expect(after.exportDeclarationStatus).toBe("RELEASED");
    expect(after.status).toBe("DECLARED");
    const ev = (await events(s.id)).filter((e) => e.source === "FIELD_LINK");
    expect(ev.map((e) => e.type)).toEqual(["PICKED_UP", "DECLARATION_STATUS", "DECLARATION_STATUS"]);
    expect(ev.every((e) => e.actorId === f.field.id)).toBe(true);
    expect(ev[0].note).toBe("Loaded 2 units");
  });

  it("answers a repeated tap with 'already recorded' and writes nothing", async () => {
    const s = await newShipment();
    const { token } = await createFieldLink(prisma, s.id, cs, null);
    await applyFieldUpdate(prisma, token, "PICKED_UP", { note: null, photo: null, now });
    const n = (await events(s.id)).length;
    expect(await applyFieldUpdate(prisma, token, "PICKED_UP", { note: null, photo: null, now })).toMatchObject({ ok: true, message: /already recorded/ });
    expect((await events(s.id)).length).toBe(n);
  });

  it("logs notes and photos, and refuses an empty note", async () => {
    const s = await newShipment();
    const { token } = await createFieldLink(prisma, s.id, cs, null);
    expect(await applyFieldUpdate(prisma, token, "NOTE", { note: " ", photo: null, now })).toMatchObject({ ok: false });
    await applyFieldUpdate(prisma, token, "NOTE", {
      note: "Truck delayed 30 min",
      photo: { storageKey: "x/p.jpg", originalName: "p.jpg", mimeType: "image/jpeg", sizeBytes: 5 },
      now,
    });
    const note = (await events(s.id)).at(-1)!;
    expect(note).toMatchObject({ type: "NOTE", source: "FIELD_LINK", note: "Truck delayed 30 min", actorId: null });
    const att = await prisma.attachment.findFirstOrThrow({ where: { shipmentId: s.id } });
    expect(att.kind).toBe("FIELD_PHOTO");
    expect(JSON.parse(note.value!)).toMatchObject({ attachmentId: att.id });
  });

  it("refuses updates through a dead link", async () => {
    const s = await newShipment();
    const { token } = await createFieldLink(prisma, s.id, cs, null);
    await prisma.fieldLink.updateMany({ where: { shipmentId: s.id }, data: { revokedAt: new Date() } });
    expect(await applyFieldUpdate(prisma, token, "PICKED_UP", { note: null, photo: null, now })).toMatchObject({ ok: false, message: /no longer active/ });
  });
});
