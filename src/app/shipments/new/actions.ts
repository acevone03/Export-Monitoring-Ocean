"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { now } from "@/lib/clock";
import { parseShipmentForm } from "@/lib/shipment-input";
import { createShipment, DomainError } from "@/lib/shipments";
import type { ShipmentFormState } from "@/components/ShipmentForm";
import { formValuesOf } from "../data";
import { sendPickupInstruction } from "@/lib/pickup-instruction";

export async function createShipmentAction(_prev: ShipmentFormState, form: FormData): Promise<ShipmentFormState> {
  const user = await requireUser(["CS", "SUPERVISOR"]);
  const parsed = parseShipmentForm(form);
  if (!parsed.ok) return { fieldErrors: parsed.fieldErrors, values: formValuesOf(form) };
  let id: string;
  try {
    id = (await createShipment(prisma, parsed.data, user, { now: await now(), source: "CS" })).id;
  } catch (e) {
    if (e instanceof DomainError) return { error: e.message, values: formValuesOf(form) };
    throw e;
  }
  // Shipment is saved either way; the shipment page shows whether the instruction went out.
  const pi = await sendPickupInstruction(prisma, id, user.id, await now());
  redirect(`/shipments/${id}?created=1&pi=${pi.status}`);
}
