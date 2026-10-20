"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser, type SessionUser } from "@/lib/auth";
import { now } from "@/lib/clock";
import { anthropicClient, extractBooking, ExtractionError, intakeEnabled, intakeModel } from "@/lib/intake/extract";
import { parseShipmentForm } from "@/lib/shipment-input";
import { createShipment, DomainError } from "@/lib/shipments";
import { sendPickupInstruction } from "@/lib/pickup-instruction";
import type { ShipmentFormState } from "@/components/ShipmentForm";
import { formValuesOf } from "../shipments/data";

export type IntakeState = { error?: string };

const MAX_CHARS = 20_000;
const IntakeForm = z.object({
  rawText: z.string().trim().min(20, "Paste the customer email (at least a few lines).").max(MAX_CHARS, "The email is too long (20,000 characters max)."),
  attachmentText: z.string().trim().max(MAX_CHARS, "Attachment text is too long (20,000 characters max).").optional(),
});

/** Runs extraction for an intake row and stores the result or the error. Never creates a shipment. */
async function runExtraction(intakeId: string) {
  const intake = await prisma.emailIntake.findUniqueOrThrow({ where: { id: intakeId } });
  try {
    const extracted = await extractBooking(anthropicClient(), intake.rawText, intake.attachmentText, await now());
    await prisma.emailIntake.update({
      where: { id: intakeId },
      data: { extractedJson: extracted as unknown as Prisma.InputJsonValue, extractError: null, model: intakeModel() },
    });
  } catch (e) {
    const message = e instanceof ExtractionError ? e.message : "Unexpected error while reading the email.";
    if (!(e instanceof ExtractionError)) console.error("[intake] extraction failed:", e);
    await prisma.emailIntake.update({ where: { id: intakeId }, data: { extractError: message } });
  }
}

export async function createIntakeAction(_p: IntakeState, form: FormData): Promise<IntakeState> {
  const user = await requireUser(["CS", "SUPERVISOR"]);
  if (!intakeEnabled()) return { error: "AI intake is not configured (ANTHROPIC_API_KEY is missing)." };
  const p = IntakeForm.safeParse({ rawText: form.get("rawText") ?? "", attachmentText: form.get("attachmentText") ?? undefined });
  if (!p.success) return { error: p.error.issues[0].message };
  // Save the pasted text first, so nothing is lost if the AI call fails.
  const intake = await prisma.emailIntake.create({
    data: { rawText: p.data.rawText, attachmentText: p.data.attachmentText || null, createdById: user.id },
  });
  await runExtraction(intake.id);
  redirect(`/intake/${intake.id}`);
}

async function loadOwnIntake(user: SessionUser, id: string) {
  const intake = await prisma.emailIntake.findUnique({ where: { id } }).catch(() => null);
  if (!intake || (user.role !== "SUPERVISOR" && intake.createdById !== user.id)) throw new DomainError("Intake not found.");
  return intake;
}

export async function retryExtractionAction(form: FormData) {
  const user = await requireUser(["CS", "SUPERVISOR"]);
  const id = z.string().uuid().parse(form.get("intakeId"));
  const intake = await loadOwnIntake(user, id);
  if (intake.status === "PENDING_REVIEW" && intakeEnabled()) await runExtraction(id);
  revalidatePath(`/intake/${id}`);
}

export async function discardIntakeAction(form: FormData) {
  const user = await requireUser(["CS", "SUPERVISOR"]);
  const id = z.string().uuid().parse(form.get("intakeId"));
  await loadOwnIntake(user, id);
  await prisma.emailIntake.updateMany({ where: { id, status: "PENDING_REVIEW" }, data: { status: "REJECTED" } });
  redirect("/intake");
}

/** The human confirmation step: the reviewed form becomes a shipment (source EMAIL). */
export async function confirmIntakeAction(intakeId: string, _p: ShipmentFormState, form: FormData): Promise<ShipmentFormState> {
  const user = await requireUser(["CS", "SUPERVISOR"]);
  try {
    await loadOwnIntake(user, intakeId);
  } catch {
    return { error: "Intake not found." };
  }
  const parsed = parseShipmentForm(form, { requireInstruction: true });
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors, values: formValuesOf(form) };

  // Claim the intake first so a double click cannot create two shipments.
  const claimed = await prisma.emailIntake.updateMany({ where: { id: intakeId, status: "PENDING_REVIEW" }, data: { status: "CONFIRMED" } });
  if (claimed.count !== 1) return { error: "This email was already confirmed or discarded." };

  let shipmentId: string;
  try {
    const s = await createShipment(prisma, parsed.data, user, { now: await now(), source: "EMAIL" });
    shipmentId = s.id;
    await prisma.emailIntake.update({ where: { id: intakeId }, data: { shipmentId } });
  } catch (e) {
    await prisma.emailIntake.update({ where: { id: intakeId }, data: { status: "PENDING_REVIEW" } });
    if (e instanceof DomainError) return { error: e.message, values: formValuesOf(form) };
    throw e;
  }
  const pi = await sendPickupInstruction(prisma, shipmentId, user.id, await now());
  redirect(`/shipments/${shipmentId}?created=1&pi=${pi.status}`);
}
