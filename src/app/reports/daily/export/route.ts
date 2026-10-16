import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, can } from "@/lib/auth";
import { now } from "@/lib/clock";
import { shipmentScope } from "@/lib/access";
import { buildDailyReport, dailyReportWhere } from "@/lib/reports/daily";
import { dailyWorkbook, XLSX_MIME } from "@/lib/reports/excel";
import { loadReportShipments } from "@/lib/reports/deliver";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !can.viewDailyReport(user)) return new NextResponse("Not allowed", { status: 403 });
  const t = await now();
  const shipments = await loadReportShipments(prisma, { AND: [shipmentScope(user), dailyReportWhere(t)] });
  const report = buildDailyReport(shipments, t);
  const buf = await dailyWorkbook(report, shipments);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename="NNR-daily-${report.date}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
