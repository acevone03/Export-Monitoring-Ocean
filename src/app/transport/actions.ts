"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { parseEmailList, setTransportEmails } from "@/lib/pickup-instruction";

export type TransportState = { ok?: string; error?: string };

export async function saveTransportEmailsAction(_prev: TransportState, form: FormData): Promise<TransportState> {
  await requireUser(["CS", "SUPERVISOR"]);
  const { emails, invalid } = parseEmailList(String(form.get("emails") ?? ""));
  if (invalid.length) return { error: `Not a valid email: ${invalid.join(", ")}` };
  if (emails.length > 20) return { error: "Up to 20 transport emails." };
  await setTransportEmails(prisma, emails);
  revalidatePath("/transport");
  return { ok: emails.length ? `Saved ${emails.length} transport email${emails.length === 1 ? "" : "s"}.` : "Cleared: pick-up instructions will not be emailed." };
}
