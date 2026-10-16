import type { PrismaClient, Shipment } from "@prisma/client";
import { hashToken, newToken } from "./tokens";
import { DomainError, recordMilestone, addAttachment, type Actor } from "./shipments";
import { EVENT } from "./milestones";
import { formatDateTime } from "./time";

// Field magic links (spec section 9). One link = one shipment, no login, 7-day expiry.
// Only the SHA-256 of the token is stored; the URL is shown to CS once, when created.
// Expiry and revocation use the real clock (security), not the simulated demo clock.

export const FIELD_LINK_DAYS = 7;

export async function createFieldLink(
  db: PrismaClient,
  shipmentId: string,
  createdBy: Actor,
  assigneeId: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const s = await db.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
  if (s.status === "CANCELLED" || s.status === "CLOSED") throw new DomainError("This shipment is closed; no field link needed.");
  if (assigneeId) {
    const u = await db.user.findUnique({ where: { id: assigneeId } });
    if (!u || u.role !== "FIELD" || !u.active) throw new DomainError("Pick an active field person.");
  }
  const token = newToken();
  const expiresAt = new Date(Date.now() + FIELD_LINK_DAYS * 24 * 60 * 60 * 1000);
  await db.fieldLink.create({
    data: { tokenHash: hashToken(token), shipmentId, createdById: createdBy.id, assigneeId, expiresAt },
  });
  return { token, expiresAt };
}

export async function revokeFieldLink(db: PrismaClient, linkId: string, shipmentId: string) {
  await db.fieldLink.updateMany({ where: { id: linkId, shipmentId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export type ResolvedLink =
  | { ok: true; linkId: string; shipment: Shipment & { shipper: { name: string; defaultPickupAddress: string | null } }; assignee: { id: string; name: string } | null }
  | { ok: false; reason: "invalid" | "expired" | "revoked" | "closed" };

/** Looks up a link by its raw token. Unknown, expired, revoked and closed-shipment links are refused. */
export async function resolveFieldLink(db: PrismaClient, token: string): Promise<ResolvedLink> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { ok: false, reason: "invalid" };
  const link = await db.fieldLink.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      shipment: { include: { shipper: { select: { name: true, defaultPickupAddress: true } } } },
      assignee: { select: { id: true, name: true, active: true } },
    },
  });
  if (!link) return { ok: false, reason: "invalid" };
  if (link.revokedAt) return { ok: false, reason: "revoked" };
  if (link.expiresAt <= new Date()) return { ok: false, reason: "expired" };
  if (link.shipment.status === "CANCELLED" || link.shipment.status === "CLOSED") return { ok: false, reason: "closed" };
  const assignee = link.assignee?.active ? { id: link.assignee.id, name: link.assignee.name } : null;
  return { ok: true, linkId: link.id, shipment: link.shipment, assignee };
}

export const FIELD_ACTIONS = ["PICKED_UP", "DECLARATION_FILED", "DECLARATION_RELEASED", "NOTE"] as const;
export type FieldAction = (typeof FIELD_ACTIONS)[number];

export type FieldPhoto = { storageKey: string; originalName: string; mimeType: string; sizeBytes: number };

/**
 * Applies one tap from the field page. Repeated taps (double tap, flaky connection retry) are
 * answered with "already recorded" instead of an error, so the field person is never confused.
 */
export async function applyFieldUpdate(
  db: PrismaClient,
  token: string,
  action: FieldAction,
  input: { note: string | null; photo: FieldPhoto | null; now: Date },
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  const link = await resolveFieldLink(db, token);
  if (!link.ok) return { ok: false, message: "This link is no longer active. Ask CS for a new one." };
  const s = link.shipment;
  const actor: Actor | null = link.assignee ? { id: link.assignee.id, role: "FIELD" } : null;
  const note = input.note?.trim() || null;

  if (action === "NOTE" && !note && !input.photo) return { ok: false, message: "Type a note or add a photo first." };

  let message: string;
  try {
    if (action === "PICKED_UP") {
      if (s.actualPickupAt) return { ok: true, message: `Pick-up was already recorded (${formatDateTime(s.actualPickupAt)}).` };
      await recordMilestone(db, s.id, { kind: "PICKED_UP", at: input.now }, actor, { now: input.now, source: "FIELD_LINK", note });
      message = "Pick-up recorded. Thank you!";
    } else if (action === "DECLARATION_FILED") {
      if (s.exportDeclarationStatus !== "PENDING") return { ok: true, message: `Declaration is already ${s.exportDeclarationStatus}.` };
      await recordMilestone(db, s.id, { kind: "DECLARATION_STATUS", status: "FILED" }, actor, { now: input.now, source: "FIELD_LINK", note });
      message = "Export declaration marked FILED. Thank you!";
    } else if (action === "DECLARATION_RELEASED") {
      if (s.exportDeclarationStatus === "RELEASED") return { ok: true, message: "Declaration is already RELEASED." };
      await recordMilestone(db, s.id, { kind: "DECLARATION_STATUS", status: "RELEASED" }, actor, { now: input.now, source: "FIELD_LINK", note });
      message = "Export declaration marked RELEASED. Thank you!";
    } else {
      message = "Note sent to CS.";
    }
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, message: e.message };
    throw e;
  }

  // A note with no milestone, or a photo, is logged as its own NOTE event.
  if (input.photo || (action === "NOTE" && note)) {
    const att = input.photo ? await addAttachment(db, s.id, "FIELD_PHOTO", input.photo, actor?.id ?? null) : null;
    await db.milestoneEvent.create({
      data: {
        shipmentId: s.id,
        type: EVENT.NOTE,
        value: att ? JSON.stringify({ attachmentId: att.id, photo: att.originalName }) : null,
        note: action === "NOTE" ? note : null,
        actorId: actor?.id ?? null,
        source: "FIELD_LINK",
        occurredAt: input.now,
      },
    });
    if (att && action !== "NOTE") message += " Photo attached.";
  }
  await db.fieldLink.update({ where: { id: link.linkId }, data: { lastUsedAt: new Date() } });
  return { ok: true, message };
}
