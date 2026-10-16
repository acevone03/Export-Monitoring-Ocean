"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { verifyPassword } from "@/lib/password";
import { createSession, destroySession, STAFF_ROLES } from "@/lib/auth";

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export type LoginState = { error?: string };

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const parsed = LoginSchema.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Enter your email and password." };

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  const ok = user && user.active && (await verifyPassword(parsed.data.password, user.passwordHash));
  if (!ok) return { error: "Invalid email or password." };
  if (!STAFF_ROLES.includes(user.role)) return { error: "Customer access is not available yet." };

  await createSession(user.id);
  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}
