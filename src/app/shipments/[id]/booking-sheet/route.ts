import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canAccessShipment } from "@/lib/access";
import { now } from "@/lib/clock";
import { bookingSheetData, bookingSheetHtml } from "@/lib/booking-sheet";

// Printable Ocean Export Booking Sheet for one shipment (a standalone page: no menu, always light).
// Its "Print / Save as PDF" button opens the browser's print dialog.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.redirect(new URL("/login", req.url), 302);
  const { id } = await params;
  const s = await prisma.shipment
    .findUnique({
      where: { id },
      include: {
        shipper: { select: { code: true, name: true, contactPerson: true, phone: true, defaultPickupAddress: true } },
        assignedCs: { select: { name: true } },
      },
    })
    .catch(() => null);
  if (!s || !canAccessShipment(user, s)) return new Response("Shipment not found", { status: 404 });
  const html = bookingSheetHtml(bookingSheetData(s, await now()), `/shipments/${s.id}`);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
