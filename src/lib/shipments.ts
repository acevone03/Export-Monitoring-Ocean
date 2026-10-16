import { Prisma, type PrismaClient, type Role, type Shipment, type EventSource, type ShipmentSource, type DeclarationStatus, type AttachmentKind } from "@prisma/client";
import { nextHblNo, nextJobNo } from "./numbering";
import { deriveStatus } from "./status";
import { DEFAULT_RULES, computeCachedDeadlines, type RuleLike } from "./deadlines";
import { EVENT } from "./milestones";
import type { ShipmentInput } from "./shipment-input";
import { formatDateTime } from "./time";
import { reopenAlerts, resolveStaleAlerts } from "./alerts";

// The only module that writes shipments. Every write:
//   1. validates the transition,
//   2. recomputes status and cached deadlines,
//   3. appends milestone_events,
// all inside one transaction, so status, deadlines and the audit trail cannot drift apart.

type Tx = Prisma.TransactionClient;
export type Actor = { id: string; role: Role };

/** A rule violation the user can fix. Message is safe to show in the UI. */
export class DomainError extends Error {}

// Actual times may be a few minutes ahead of the server clock (phone clocks drift).
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000;

async function loadRules(tx: Tx): Promise<RuleLike[]> {
  const rules = await tx.deadlineRule.findMany();
  return rules.length ? rules : DEFAULT_RULES;
}

function derive(s: Shipment, rules: RuleLike[], now: Date) {
  return { status: deriveStatus(s, now), ...computeCachedDeadlines(rules, s) };
}

function inputToData(input: ShipmentInput) {
  const { containerPlan, ...rest } = input;
  return { ...rest, containerPlan: containerPlan.length ? containerPlan : Prisma.DbNull };
}

async function assertAssignable(tx: Tx, shipperId: string, assignedCsId: string) {
  const shipper = await tx.shipper.findUnique({ where: { id: shipperId } });
  if (!shipper) throw new DomainError("Unknown shipper");
  const cs = await tx.user.findUnique({ where: { id: assignedCsId } });
  if (!cs || !cs.active || (cs.role !== "CS" && cs.role !== "SUPERVISOR")) {
    throw new DomainError("Assigned CS must be an active CS or supervisor");
  }
}

// ---------------------------------------------------------------- create

export async function createShipment(
  db: PrismaClient,
  input: ShipmentInput,
  actor: Actor,
  opts: { source?: ShipmentSource; now: Date },
): Promise<Shipment> {
  const source = opts.source ?? "CS";
  return db.$transaction(async (tx) => {
    // Numbers first: the counter UPDATE takes the write lock up front (see numbering.ts).
    const jobNo = await nextJobNo(tx, opts.now);
    const hblNo = await nextHblNo(tx, input.podCode, input.cargoType);
    await assertAssignable(tx, input.shipperId, input.assignedCsId);
    const rules = await loadRules(tx);

    const created = await tx.shipment.create({
      data: { ...inputToData(input), jobNo, hblNo, source, createdById: actor.id, createdAt: opts.now },
    });
    const shipment = await tx.shipment.update({ where: { id: created.id }, data: derive(created, rules, opts.now) });

    const evSource: EventSource = source === "EMAIL" ? "EMAIL" : "WEB";
    const events: Prisma.MilestoneEventCreateManyInput[] = [
      { shipmentId: shipment.id, type: EVENT.CREATED, value: JSON.stringify({ source }), actorId: actor.id, source: evSource, occurredAt: opts.now },
      { shipmentId: shipment.id, type: EVENT.NUMBERS_ASSIGNED, value: JSON.stringify({ jobNo, hblNo }), source: "SYSTEM", occurredAt: opts.now },
    ];
    if (input.requestedPickupAt) {
      events.push({ shipmentId: shipment.id, type: EVENT.PICKUP_SCHEDULED, value: input.requestedPickupAt.toISOString(), actorId: actor.id, source: evSource, occurredAt: opts.now });
    }
    await tx.milestoneEvent.createMany({ data: events });
    return shipment;
  });
}

// ---------------------------------------------------------------- edit

// Planning fields editable from the form. Milestone timestamps are NOT here:
// they only change through recordMilestone so each one is a deliberate, logged act.
const EDITABLE: Array<keyof ShipmentInput> = [
  "shipperId", "consigneeName", "destinationPort", "pod", "cargoType", "containerPlan", "lclQty", "lclUnit",
  "requestedPickupAt", "fsiCutoffAt", "preadviseCutoffAt", "etdMnl", "eta", "arrastreResponsibility",
  "carrierName", "carrierBookingRef", "carrierRemarks", "assignedCsId",
  "arrastreCutoffAt", "podCode", "declarationBy", "declarationForwarder", "partOfHblNo",
];

const comparable = (v: unknown) =>
  v instanceof Date ? v.toISOString() : v === undefined || v === null || v === Prisma.DbNull ? null : JSON.stringify(v);

function assertOpen(s: Shipment) {
  if (s.status === "CANCELLED") throw new DomainError("This shipment is cancelled and can no longer be changed.");
  if (s.status === "CLOSED") throw new DomainError("This shipment is closed and can no longer be changed.");
}

export async function updateShipment(
  db: PrismaClient,
  id: string,
  input: ShipmentInput,
  actor: Actor,
  opts: { now: Date },
): Promise<Shipment> {
  return db.$transaction(async (tx) => {
    const before = await tx.shipment.findUniqueOrThrow({ where: { id } });
    assertOpen(before);
    if (input.arrastreResponsibility === "SHIPPER" && before.arrastrePaidAt) {
      throw new DomainError("Arrastre was already paid by NNR; responsibility cannot change to shipper.");
    }
    await assertAssignable(tx, input.shipperId, input.assignedCsId);

    const data = inputToData(input);
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of EDITABLE) {
      const from = comparable(before[key as keyof Shipment]);
      const to = comparable(data[key as keyof typeof data]);
      if (from !== to) changes[key] = { from, to };
    }
    if (Object.keys(changes).length === 0) return before;
    // Store names, not ids, so the timeline stays readable.
    if (changes.shipperId) {
      const names = await tx.shipper.findMany({ where: { id: { in: [before.shipperId, input.shipperId] } } });
      const name = (id: string) => JSON.stringify(names.find((n) => n.id === id)?.name ?? id);
      changes.shipperId = { from: name(before.shipperId), to: name(input.shipperId) };
    }
    if (changes.assignedCsId) {
      const names = await tx.user.findMany({ where: { id: { in: [before.assignedCsId, input.assignedCsId] } } });
      const name = (id: string) => JSON.stringify(names.find((n) => n.id === id)?.name ?? id);
      changes.assignedCsId = { from: name(before.assignedCsId), to: name(input.assignedCsId) };
    }

    const rules = await loadRules(tx);
    const merged = await tx.shipment.update({ where: { id }, data });
    const after = await tx.shipment.update({ where: { id }, data: derive(merged, rules, opts.now) });

    const events: Prisma.MilestoneEventCreateManyInput[] = [
      { shipmentId: id, type: EVENT.FIELD_CHANGED, value: JSON.stringify(changes), actorId: actor.id, source: "WEB", occurredAt: opts.now },
    ];
    if (!before.requestedPickupAt && after.requestedPickupAt) {
      events.push({ shipmentId: id, type: EVENT.PICKUP_SCHEDULED, value: after.requestedPickupAt.toISOString(), actorId: actor.id, source: "WEB", occurredAt: opts.now });
    }
    await tx.milestoneEvent.createMany({ data: events });
    // A moved cut-off supersedes its open alerts right away; the next tick starts a fresh series.
    await resolveStaleAlerts(tx, opts.now, id);
    return after;
  });
}

// ---------------------------------------------------------------- milestones

export type MilestoneInput =
  | { kind: "PICKED_UP"; at: Date }
  | { kind: "FSI_SUBMITTED"; at: Date }
  | { kind: "PREADVISE_SENT"; at: Date }
  | { kind: "DECLARATION_STATUS"; status: DeclarationStatus }
  | { kind: "BOC_UPLOADED"; at: Date }
  | { kind: "ARRASTRE_PAID"; at: Date; attachmentId: string }
  | { kind: "DOCS_SENT"; at: Date; recipient: string; subject: string }
  | { kind: "DOCS_TO_OVERSEAS"; at: Date }
  | { kind: "DEPARTED"; at: Date; eta: Date | null }
  | { kind: "ARRIVED"; at: Date }
  | { kind: "CLOSED" }
  | { kind: "CANCELLED"; reason: string };

export type MilestoneOpts = { now: Date; source: EventSource; note?: string | null };

function alreadyDone(label: string, at: Date | null) {
  if (at) throw new DomainError(`${label} was already recorded (${formatDateTime(at)}).`);
}

/** Validates one milestone against the current shipment; returns the field patch and event value. */
async function planMilestone(
  tx: Tx,
  s: Shipment,
  m: MilestoneInput,
  now: Date,
): Promise<{ patch: Prisma.ShipmentUncheckedUpdateInput; type: string; value: string | null }> {
  if ("at" in m && m.at.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
    throw new DomainError("The time cannot be in the future.");
  }
  switch (m.kind) {
    case "PICKED_UP":
      alreadyDone("Pick-up", s.actualPickupAt);
      return { patch: { actualPickupAt: m.at }, type: EVENT.PICKED_UP, value: m.at.toISOString() };
    case "FSI_SUBMITTED":
      alreadyDone("FSI", s.fsiSubmittedAt);
      return { patch: { fsiSubmittedAt: m.at }, type: EVENT.FSI_SUBMITTED, value: m.at.toISOString() };
    case "PREADVISE_SENT":
      alreadyDone("Pre-advise", s.preadviseSentAt);
      return { patch: { preadviseSentAt: m.at }, type: EVENT.PREADVISE_SENT, value: m.at.toISOString() };
    case "DECLARATION_STATUS":
      if (m.status === s.exportDeclarationStatus) {
        throw new DomainError(`Export declaration is already ${m.status}.`);
      }
      return {
        patch: { exportDeclarationStatus: m.status, exportDeclarationUpdatedAt: now },
        type: EVENT.DECLARATION_STATUS,
        value: JSON.stringify({ from: s.exportDeclarationStatus, to: m.status }),
      };
    case "BOC_UPLOADED":
      alreadyDone("BOC portal upload", s.bocUploadAt);
      return { patch: { bocUploadAt: m.at }, type: EVENT.BOC_UPLOADED, value: m.at.toISOString() };
    case "ARRASTRE_PAID": {
      if (s.arrastreResponsibility !== "NNR") throw new DomainError("Arrastre is paid by the shipper on this shipment.");
      alreadyDone("Arrastre payment", s.arrastrePaidAt);
      const file = await tx.attachment.findUnique({ where: { id: m.attachmentId } });
      if (!file || file.shipmentId !== s.id || file.kind !== "ARRASTRE_PROOF") {
        throw new DomainError("Attach the proof of payment first.");
      }
      return {
        patch: { arrastrePaidAt: m.at, arrastreProofId: file.id },
        type: EVENT.ARRASTRE_PAID,
        value: JSON.stringify({ at: m.at.toISOString(), proof: file.originalName }),
      };
    }
    case "DOCS_SENT":
      alreadyDone("Export docs", s.exportDocsSentAt);
      return {
        patch: { exportDocsSentAt: m.at, exportDocsRecipient: m.recipient, exportDocsSubject: m.subject },
        type: EVENT.DOCS_SENT,
        value: JSON.stringify({ at: m.at.toISOString(), to: m.recipient, subject: m.subject }),
      };
    case "DOCS_TO_OVERSEAS":
      alreadyDone("Docs sent to overseas office", s.exportDocsToOverseasAt);
      return { patch: { exportDocsToOverseasAt: m.at }, type: EVENT.DOCS_TO_OVERSEAS, value: m.at.toISOString() };
    case "DEPARTED": {
      alreadyDone("Departure (ATD)", s.atdMnl);
      const eta = m.eta ?? s.eta;
      if (eta && eta <= m.at) throw new DomainError("ETA must be after ATD.");
      return { patch: { atdMnl: m.at, eta }, type: EVENT.DEPARTED, value: JSON.stringify({ atd: m.at.toISOString(), eta: eta?.toISOString() ?? null }) };
    }
    case "ARRIVED":
      if (!s.atdMnl) throw new DomainError("Record the departure (ATD) first.");
      alreadyDone("Arrival (ATA)", s.ata);
      if (m.at <= s.atdMnl) throw new DomainError("ATA must be after ATD.");
      return { patch: { ata: m.at }, type: EVENT.ARRIVED, value: m.at.toISOString() };
    case "CLOSED":
      if (s.status !== "ARRIVED") throw new DomainError("Only arrived shipments can be closed.");
      return { patch: { closedAt: now }, type: EVENT.CLOSED, value: null };
    case "CANCELLED":
      if (s.atdMnl) throw new DomainError("A departed shipment cannot be cancelled.");
      return { patch: { cancelledAt: now, cancelReason: m.reason }, type: EVENT.CANCELLED, value: m.reason };
  }
}

export async function recordMilestone(
  db: PrismaClient,
  id: string,
  m: MilestoneInput,
  actor: Actor | null, // null for field magic links (no login)
  opts: MilestoneOpts,
): Promise<Shipment> {
  return db.$transaction(async (tx) => {
    const s = await tx.shipment.findUniqueOrThrow({ where: { id } });
    assertOpen(s);
    const { patch, type, value } = await planMilestone(tx, s, m, opts.now);
    const rules = await loadRules(tx);
    const merged = await tx.shipment.update({ where: { id }, data: patch });
    const after = await tx.shipment.update({ where: { id }, data: derive(merged, rules, opts.now) });
    await tx.milestoneEvent.create({
      data: { shipmentId: id, type, value, note: opts.note || null, actorId: actor?.id ?? null, source: opts.source, occurredAt: opts.now },
    });
    // Completing a step (or departing/cancelling/closing) closes its alerts immediately.
    await resolveStaleAlerts(tx, opts.now, id);
    return after;
  });
}

// ---------------------------------------------------------------- revert (supervisor)

// Steps a supervisor can undo when they were recorded by mistake. Declaration status is not here:
// it can already be set to any value, and every change is logged.
export const REVERTIBLE = {
  PICKED_UP: { label: "Pick-up", field: "actualPickupAt", clear: { actualPickupAt: null } },
  FSI_SUBMITTED: { label: "FSI submitted", field: "fsiSubmittedAt", clear: { fsiSubmittedAt: null } },
  PREADVISE_SENT: { label: "Pre-advise sent", field: "preadviseSentAt", clear: { preadviseSentAt: null } },
  BOC_UPLOADED: { label: "BOC upload", field: "bocUploadAt", clear: { bocUploadAt: null } },
  // The proof file stays attached to the shipment for the record; only the link to it is cleared.
  ARRASTRE_PAID: { label: "Arrastre payment", field: "arrastrePaidAt", clear: { arrastrePaidAt: null, arrastreProofId: null } },
  DOCS_SENT: { label: "Export docs sent", field: "exportDocsSentAt", clear: { exportDocsSentAt: null, exportDocsRecipient: null, exportDocsSubject: null } },
  DOCS_TO_OVERSEAS: { label: "Docs sent to overseas office", field: "exportDocsToOverseasAt", clear: { exportDocsToOverseasAt: null } },
  DEPARTED: { label: "Departure (ATD)", field: "atdMnl", clear: { atdMnl: null } },
  ARRIVED: { label: "Arrival (ATA)", field: "ata", clear: { ata: null } },
  CLOSED: { label: "Close", field: "closedAt", clear: { closedAt: null } },
  CANCELLED: { label: "Cancellation", field: "cancelledAt", clear: { cancelledAt: null, cancelReason: null } },
} as const satisfies Record<string, { label: string; field: keyof Shipment; clear: Prisma.ShipmentUncheckedUpdateInput }>;
export type RevertKind = keyof typeof REVERTIBLE;

/**
 * Supervisor-only undo of a recorded step. Nothing is deleted: the step's timestamp is cleared, a
 * REVERTED event keeps the old value and the reason, status and deadlines are recomputed, and the
 * deadline's alerts reopen so it is watched again.
 */
export async function revertMilestone(db: PrismaClient, id: string, kind: RevertKind, reason: string, actor: Actor, opts: { now: Date }) {
  if (actor.role !== "SUPERVISOR") throw new DomainError("Only a supervisor can revert a recorded step.");
  if (!reason.trim()) throw new DomainError("Give a reason for reverting.");
  const def = REVERTIBLE[kind];
  return db.$transaction(async (tx) => {
    const s = await tx.shipment.findUniqueOrThrow({ where: { id } });
    const previous = s[def.field] as Date | null;
    if (!previous) throw new DomainError(`${def.label} is not recorded; nothing to revert.`);
    if (s.status === "CANCELLED" && kind !== "CANCELLED") throw new DomainError("Revert the cancellation first.");
    if (s.status === "CLOSED" && kind !== "CLOSED") throw new DomainError("Re-open the shipment (revert Close) first.");
    if (kind === "DEPARTED" && s.ata) throw new DomainError("Revert the arrival (ATA) first.");

    const value: Record<string, unknown> = { kind, previous: previous.toISOString() };
    if (kind === "CANCELLED") value.cancelReason = s.cancelReason;
    if (kind === "DOCS_SENT") Object.assign(value, { to: s.exportDocsRecipient, subject: s.exportDocsSubject });

    const rules = await loadRules(tx);
    const merged = await tx.shipment.update({ where: { id }, data: def.clear });
    const after = await tx.shipment.update({ where: { id }, data: derive(merged, rules, opts.now) });
    await tx.milestoneEvent.create({
      data: { shipmentId: id, type: EVENT.REVERTED, value: JSON.stringify(value), note: reason.trim(), actorId: actor.id, source: "WEB", occurredAt: opts.now },
    });
    await reopenAlerts(tx, id);
    return after;
  });
}

// ---------------------------------------------------------------- HBL correction

/** Supervisor-only manual HBL correction. Old numbers are never handed out again. */
export async function editHblNo(db: PrismaClient, id: string, newNo: string, reason: string, actor: Actor, opts: { now: Date }) {
  if (actor.role !== "SUPERVISOR") throw new DomainError("Only a supervisor can change the HBL No.");
  const hbl = newNo.trim().toUpperCase();
  if (!/^[A-Z0-9-]{4,30}$/.test(hbl)) throw new DomainError("HBL No. may only contain letters, digits and dashes.");
  if (!reason.trim()) throw new DomainError("Give a reason for the change.");
  return db.$transaction(async (tx) => {
    const s = await tx.shipment.findUniqueOrThrow({ where: { id } });
    if (s.hblNo === hbl) throw new DomainError("That is already the HBL No.");
    if (await tx.shipment.findUnique({ where: { hblNo: hbl } })) throw new DomainError("Another shipment already uses that HBL No.");
    const retired = await tx.milestoneEvent.findFirst({ where: { type: EVENT.HBL_EDITED, value: { contains: `"from":"${hbl}"` } } });
    if (retired) throw new DomainError("That HBL No. was used before and cannot be reused.");
    const after = await tx.shipment.update({ where: { id }, data: { hblNo: hbl } });
    await tx.milestoneEvent.create({
      data: { shipmentId: id, type: EVENT.HBL_EDITED, value: JSON.stringify({ from: s.hblNo, to: hbl }), note: reason.trim(), actorId: actor.id, source: "WEB", occurredAt: opts.now },
    });
    return after;
  });
}

// ---------------------------------------------------------------- attachments

export async function addAttachment(
  db: PrismaClient,
  shipmentId: string,
  kind: AttachmentKind,
  file: { storageKey: string; originalName: string; mimeType: string; sizeBytes: number },
  uploadedById: string | null,
) {
  return db.attachment.create({ data: { shipmentId, kind, uploadedById, ...file } });
}

// ---------------------------------------------------------------- rule changes

/** After a supervisor edits deadline rules: recompute cached deadlines on every open shipment. */
export async function recomputeOpenDeadlines(db: PrismaClient, now: Date): Promise<number> {
  return db.$transaction(async (tx) => {
    const rules = await loadRules(tx);
    const open = await tx.shipment.findMany({ where: { status: { notIn: ["CLOSED", "CANCELLED"] } } });
    let changed = 0;
    for (const s of open) {
      const d = computeCachedDeadlines(rules, s);
      if (d.bocDeadlineAt?.getTime() !== s.bocDeadlineAt?.getTime() || d.arrastreDeadlineAt?.getTime() !== s.arrastreDeadlineAt?.getTime()) {
        await tx.shipment.update({ where: { id: s.id }, data: d });
        changed++;
      }
    }
    await resolveStaleAlerts(tx, now);
    return changed;
  });
}
