"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { hashPassword } from "@/lib/password";
import { tempPassword } from "@/lib/tokens";

const CreateUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  role: z.enum(["CS", "FIELD", "SUPERVISOR"]),
  title: z.string().trim().max(100).optional().transform((v) => v || null),
  password: z.string().min(10, "Password must be at least 10 characters"),
  phone: z.string().trim().max(30).optional().transform((v) => v || null),
});

export type CreateUserState = { error?: string; ok?: string };

export async function createUserAction(_prev: CreateUserState, form: FormData): Promise<CreateUserState> {
  await requireUser(["SUPERVISOR"]);
  const parsed = CreateUserSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { password, ...data } = parsed.data;
  try {
    await prisma.user.create({ data: { ...data, passwordHash: await hashPassword(password) } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { error: "A user with that email already exists." };
    }
    throw e;
  }
  revalidatePath("/admin/users");
  return { ok: `Created ${data.email}` };
}

const ToggleSchema = z.object({ userId: z.string().uuid() });

export async function toggleActiveAction(form: FormData) {
  const me = await requireUser(["SUPERVISOR"]);
  const { userId } = ToggleSchema.parse(Object.fromEntries(form));
  if (userId === me.id) return; // cannot lock yourself out
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { active: !user.active } }),
    // Deactivation ends existing sessions immediately.
    ...(user.active ? [prisma.session.deleteMany({ where: { userId } })] : []),
  ]);
  revalidatePath("/admin/users");
}

// ---------- reset a forgotten password (supervisor)

export type ResetState = { ok?: string; error?: string };

export async function resetPasswordAction(_prev: ResetState, form: FormData): Promise<ResetState> {
  const me = await requireUser(["SUPERVISOR"]);
  const parsed = ToggleSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Invalid request." };
  if (parsed.data.userId === me.id) return { error: "Change your own password under My account." };
  const user = await prisma.user.findUniqueOrThrow({ where: { id: parsed.data.userId } });
  const password = tempPassword();
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } }),
    prisma.session.deleteMany({ where: { userId: user.id } }), // log them out everywhere
  ]);
  // Shown once, to the supervisor only; the user changes it under My account.
  return { ok: `New temporary password for ${user.email}: ${password}` };
}
