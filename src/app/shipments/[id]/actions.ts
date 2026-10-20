"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser, assertShipmentAccess } from "@/lib/auth";
import { now } from "@/lib/clock";
import { parseShipmentForm } from "@/lib/shipment-input";
import { MilestoneFormSchema } from "@/lib/milestone-input";
import { addAttachment, DomainError, editHblNo, recordMilestone, revertMilestone, updateShipment, REVERTIBLE, type MilestoneInput, type RevertKind } from "@/lib/shipments";
import { storage, ALLOWED_UPLOADS, MAX_UPLOAD_BYTES } from "@/lib/storage";
import type { ShipmentFormState } from "@/components/ShipmentForm";
import { createFieldLink, revokeFieldLink } from "@/lib/field-links";
import { formatDateTime } from "@/lib/time";
import { formValuesOf } from "../data";
import { instructionChanges, sendPickupInstruction } from "@/lib/pickup-instruction";

export type ActionState = { ok?: string; error?: string };

const Id = z.string().uuid();

// ---------- edit

export async function updateShipmentAction(id: string, _prev: ShipmentFormState, form: FormData): Promise<ShipmentFormState> {
  const user = await requireUser(["CS", "SUPERVISOR"]);
  await assertShipmentAccess(user, Id.parse(id));
  const before = await prisma.shipment.findUniqueOrThrow({ where: { id: Id.parse(id) } });
  // Until the cargo is picked up, the instruction must stay complete.
  const parsed = parseShipmentForm(form, { requireInstruction: !before.actualPickupAt });
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors, values: formValuesOf(form) };
  let after: Awaited<ReturnType<typeof updateShipment>>;
  try {
    after = await updateShipment(prisma, Id.parse(id), parsed.data, user, { now: await now() });
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message, values: formValuesOf(form) };
    throw e;
  }
  // Something on the instruction changed before pick-up: send the revised one to transport.
  let pi = "";
  if (!before.actualPickupAt && instructionChanges(before, after).length > 0) {
    pi = `?pi=${(await sendPickupInstruction(prisma, id, user.id, await now(), { revised: true })).status}&revised=1`;
  }
  revalidatePath(`/shipments/${id}`);
  redirect(`/shipments/${id}${pi}`);
}

// ---------- milestones

const Common = z.object({
  shipmentId: Id,
  onBehalf: z.string().optional(), // checkbox: CS recording a field person's text message
  note: z.string().trim().max(500).optional(),
});

export async function milestoneAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser(["CS", "SUPERVISOR"]);
  const fields = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string"));
  const common = Common.safeParse(fields);
  const parsed = MilestoneFormSchema.safeParse(fields);
  if (!common.success) return { error: "Invalid request." };
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const clock = await now();
  const m = parsed.data;
  const at = "at" in m ? (m.at ?? clock) : undefined;
  const { shipmentId, onBehalf, note } = common.data;
  await assertShipmentAccess(user, shipmentId);

  try {
    let input: MilestoneInput;
    if (m.kind === "ARRASTRE_PAID") {
      const attachmentId = await saveProof(form.get("proof"), shipmentId, user.id);
      input = { kind: "ARRASTRE_PAID", at: at!, attachmentId };
    } else if (m.kind === "DEPARTED") {
      input = { kind: "DEPARTED", at: at!, eta: m.eta };
    } else if ("at" in m) {
      input = { ...m, at: at! } as MilestoneInput;
    } else {
      input = m as MilestoneInput;
    }
    await recordMilestone(prisma, shipmentId, input, user, {
      now: clock,
      source: onBehalf ? "CS_ON_BEHALF" : "WEB",
      note: note || null,
    });
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/shipments/${shipmentId}`);
  return { ok: "Saved." };
}

async function saveProof(file: FormDataEntryValue | null, shipmentId: string, userId: string): Promise<string> {
  if (!(file instanceof File) || file.size === 0) throw new DomainError("Attach the proof of payment (screenshot or PDF).");
  const ext = ALLOWED_UPLOADS[file.type];
  if (!ext) throw new DomainError("Proof must be a PNG, JPG, WEBP or PDF file.");
  if (file.size > MAX_UPLOAD_BYTES) throw new DomainError("Proof file is larger than 10 MB.");
  const storageKey = await storage.put(Buffer.from(await file.arrayBuffer()), ext);
  const att = await addAttachment(
    prisma, shipmentId, "ARRASTRE_PROOF",
    { storageKey, originalName: file.name.slice(0, 200), mimeType: file.type, sizeBytes: file.size },
    userId,
  );
  return att.id;
}

// ---------- HBL correction (supervisor)

export async function editHblAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser(["SUPERVISOR"]);
  const p = z.object({ shipmentId: Id, hblNo: z.string().trim(), reason: z.string().trim() }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid request." };
  try {
    await editHblNo(prisma, p.data.shipmentId, p.data.hblNo, p.data.reason, user, { now: await now() });
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  // The HBL is on the instruction, so transport gets the revised one (only while pick-up is still to come).
  const s = await prisma.shipment.findUniqueOrThrow({ where: { id: p.data.shipmentId }, select: { actualPickupAt: true } });
  const r = s.actualPickupAt ? null : await sendPickupInstruction(prisma, p.data.shipmentId, user.id, await now(), { revised: true });
  revalidatePath(`/shipments/${p.data.shipmentId}`);
  return { ok: r?.status === "sent" ? "HBL No. updated. Revised pick-up instruction sent to transport." : "HBL No. updated." };
}

// ---------- field magic links

export type FieldLinkState = { error?: string; url?: string; expiresAt?: string; forName?: string | null };

export async function createFieldLinkAction(_prev: FieldLinkState, form: FormData): Promise<FieldLinkState> {
  const user = await requireUser(["CS", "SUPERVISOR"]);
  const p = z.object({ shipmentId: Id, assigneeId: z.union([z.literal(""), Id]) }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid request." };
  await assertShipmentAccess(user, p.data.shipmentId);
  try {
    const assigneeId = p.data.assigneeId || null;
    const { token, expiresAt } = await createFieldLink(prisma, p.data.shipmentId, user, assigneeId);
    const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
    const forName = assigneeId ? (await prisma.user.findUnique({ where: { id: assigneeId } }))?.name ?? null : null;
    revalidatePath(`/shipments/${p.data.shipmentId}`);
    return { url: `${base}/f/${token}`, expiresAt: formatDateTime(expiresAt), forName };
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
}

export async function revokeFieldLinkAction(form: FormData) {
  const user = await requireUser(["CS", "SUPERVISOR"]);
  const p = z.object({ shipmentId: Id, linkId: Id }).parse(Object.fromEntries(form));
  await assertShipmentAccess(user, p.shipmentId);
  await revokeFieldLink(prisma, p.linkId, p.shipmentId);
  revalidatePath(`/shipments/${p.shipmentId}`);
}

// ---------- revert a recorded step (supervisor)

const RevertForm = z.object({
  shipmentId: Id,
  kind: z.enum(Object.keys(REVERTIBLE) as [RevertKind, ...RevertKind[]]),
  reason: z.string().trim().min(3, "Give a reason for reverting.").max(500),
});

export async function revertMilestoneAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser(["SUPERVISOR"]);
  const p = RevertForm.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  await assertShipmentAccess(user, p.data.shipmentId);
  try {
    await revertMilestone(prisma, p.data.shipmentId, p.data.kind, p.data.reason, user, { now: await now() });
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message };
    throw e;
  }
  revalidatePath(`/shipments/${p.data.shipmentId}`);
  return { ok: "Reverted." };
}

// ---------- pick-up instruction to transport

export async function sendPickupInstructionAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  const user = await requireUser(["CS", "SUPERVISOR"]);
  const shipmentId = Id.safeParse(form.get("shipmentId"));
  if (!shipmentId.success) return { error: "Invalid request." };
  await assertShipmentAccess(user, shipmentId.data);
  const r = await sendPickupInstruction(prisma, shipmentId.data, user.id, await now());
  revalidatePath(`/shipments/${shipmentId.data}`);
  if (r.status === "not_needed") return { error: "Delivered by consignee: there is nothing to send to transport." };
  if (r.status === "no_recipients") return { error: "No transport email saved yet. Add one under Transport first." };
  if (r.status === "failed") return { error: `Not sent: ${r.error}` };
  return { ok: `Sent to ${r.to.join(", ")}` };
}
