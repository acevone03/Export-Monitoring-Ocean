import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

// Marks a notification read, then opens its shipment.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const { id } = await params;
  const n = await prisma.notification.findFirst({ where: { id, userId: user.id } }).catch(() => null);
  if (!n) return NextResponse.redirect(new URL("/notifications", req.url));
  if (!n.readAt) await prisma.notification.update({ where: { id }, data: { readAt: new Date() } });
  // Only follow in-app paths (the stored link is absolute for emails).
  const path = n.link ? new URL(n.link).pathname : "/notifications";
  return NextResponse.redirect(new URL(path.startsWith("/") ? path : "/notifications", req.url));
}
