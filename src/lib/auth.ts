import "server-only";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Role, User } from "@prisma/client";
import { prisma } from "./db";
import { hashToken, newToken } from "./tokens";
import { canAccessShipment } from "./access";

export const SESSION_COOKIE = "nnr_session";
const SESSION_DAYS = 7;

export type SessionUser = Pick<User, "id" | "name" | "email" | "role">;

export async function createSession(userId: string) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({ data: { id: hashToken(token), userId, expiresAt } });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { id: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: { select: { id: true, name: true, email: true, role: true, active: true } } },
  });
  // Real wall clock here, not the simulated clock: simulate-time must not log people out.
  if (!session || session.expiresAt < new Date() || !session.user.active) return null;
  const { active: _active, ...user } = session.user;
  return user;
}

/** Staff roles allowed into the main app. CUSTOMER is reserved for the post-MVP portal. */
export const STAFF_ROLES: Role[] = ["CS", "FIELD", "SUPERVISOR"];

/** Use in server components and actions. Redirects instead of returning null. */
export async function requireUser(roles: Role[] = STAFF_ROLES): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!roles.includes(user.role)) redirect("/forbidden");
  return user;
}

export const can = {
  editShipments: (u: SessionUser) => u.role === "CS" || u.role === "SUPERVISOR",
  manageUsers: (u: SessionUser) => u.role === "SUPERVISOR",
  editRules: (u: SessionUser) => u.role === "SUPERVISOR",
  viewMonthlyReport: (u: SessionUser) => u.role === "SUPERVISOR",
  viewDailyReport: (u: SessionUser) => u.role === "SUPERVISOR" || u.role === "CS",
  editHblNo: (u: SessionUser) => u.role === "SUPERVISOR",
  viewAllShipments: (u: SessionUser) => u.role === "SUPERVISOR",
};

/** 404 (not 403) when the user may not see this shipment, so ids do not leak existence. */
export async function assertShipmentAccess(user: SessionUser, shipmentId: string) {
  const s = await prisma.shipment
    .findUnique({ where: { id: shipmentId }, select: { assignedCsId: true, createdById: true } })
    .catch(() => null);
  if (!s || !canAccessShipment(user, s)) notFound();
}
