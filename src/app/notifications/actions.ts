"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { now } from "@/lib/clock";
import { acknowledgeAlert, snoozeAlert, AlertActionError } from "@/lib/alerts";

export type NotifState = { ok?: string; error?: string };

const Input = z.object({ notificationId: z.string().uuid(), minutes: z.coerce.number().int().optional() });

/** Users can only act on alerts that were sent to them. */
async function ownAlertId(userId: string, notificationId: string) {
  const n = await prisma.notification.findFirst({ where: { id: notificationId, userId } });
  if (!n?.alertId) throw new AlertActionError("Notification not found.");
  return n.alertId;
}

export async function acknowledgeAction(_p: NotifState, form: FormData): Promise<NotifState> {
  const user = await requireUser(["CS", "SUPERVISOR"]);
  const p = Input.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid request." };
  try {
    await acknowledgeAlert(prisma, await ownAlertId(user.id, p.data.notificationId), user.id, await now());
    await prisma.notification.update({ where: { id: p.data.notificationId }, data: { readAt: new Date() } });
  } catch (e) {
    if (e instanceof AlertActionError) return { error: e.message };
    throw e;
  }
  revalidatePath("/notifications");
  return { ok: "Acknowledged. It stays open until the step is done." };
}

export async function snoozeAction(_p: NotifState, form: FormData): Promise<NotifState> {
  const user = await requireUser(["CS", "SUPERVISOR"]);
  const p = Input.safeParse(Object.fromEntries(form));
  if (!p.success || !p.data.minutes) return { error: "Invalid request." };
  try {
    await snoozeAlert(prisma, await ownAlertId(user.id, p.data.notificationId), user.id, p.data.minutes, await now());
    await prisma.notification.update({ where: { id: p.data.notificationId }, data: { readAt: new Date() } });
  } catch (e) {
    if (e instanceof AlertActionError) return { error: e.message };
    throw e;
  }
  revalidatePath("/notifications");
  return { ok: `Snoozed for ${p.data.minutes >= 60 ? `${p.data.minutes / 60}h` : `${p.data.minutes}m`}. Overdue escalation still goes to the supervisor.` };
}

export async function markAllReadAction() {
  const user = await requireUser(["CS", "SUPERVISOR"]);
  await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath("/notifications");
}
