import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { storage } from "@/lib/storage";

// Attachments are business data (Data Privacy Act): staff login required, never public URLs.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "CS" && user.role !== "SUPERVISOR")) {
    return new NextResponse("Not allowed", { status: 403 });
  }
  const { id } = await params;
  const att = await prisma.attachment.findUnique({ where: { id } });
  if (!att) return new NextResponse("Not found", { status: 404 });
  const data = await storage.get(att.storageKey);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": att.mimeType,
      "Content-Disposition": `inline; filename="${encodeURIComponent(att.originalName)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
