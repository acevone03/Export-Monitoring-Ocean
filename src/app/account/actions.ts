"use server";

import { z } from "zod";
import { prisma } from "@/lib/db";
import { createSession, requireUser, STAFF_ROLES } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/password";

export type PasswordState = { ok?: string; error?: string };

const Schema = z
  .object({
    current: z.string().min(1, "Enter your current password"),
    next: z.string().min(10, "New password must be at least 10 characters").max(200),
    confirm: z.string(),
  })
  .refine((v) => v.next === v.confirm, { message: "The two new passwords do not match", path: ["confirm"] })
  .refine((v) => v.next !== v.current, { message: "Choose a password different from the current one", path: ["next"] });

export async function changePasswordAction(_prev: PasswordState, form: FormData): Promise<PasswordState> {
  const me = await requireUser(STAFF_ROLES);
  const parsed = Schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const user = await prisma.user.findUniqueOrThrow({ where: { id: me.id } });
  if (!(await verifyPassword(parsed.data.current, user.passwordHash))) return { error: "Current password is not correct." };
  // New password, and sign out every other device; this one gets a fresh session.
  await prisma.$transaction([
    prisma.user.update({ where: { id: me.id }, data: { passwordHash: await hashPassword(parsed.data.next) } }),
    prisma.session.deleteMany({ where: { userId: me.id } }),
  ]);
  await createSession(me.id);
  return { ok: "Password changed. Other devices have been signed out." };
}
