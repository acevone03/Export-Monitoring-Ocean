import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser, can } from "@/lib/auth";
import { now } from "@/lib/clock";
import { buildMonthlyReport, monthlyReportWhere } from "@/lib/reports/monthly";
import { monthKeyOf } from "@/lib/reports/period";
import { monthlyWorkbook, XLSX_MIME } from "@/lib/reports/excel";
import { loadReportShipments } from "@/lib/reports/deliver";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !can.viewMonthlyReport(user)) return new NextResponse("Not allowed", { status: 403 });
  const t = await now();
  const q = new URL(req.url).searchParams.get("month") ?? "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(q) ? q : monthKeyOf(t);
  const shipments = await loadReportShipments(prisma, monthlyReportWhere(month));
  const buf = await monthlyWorkbook(buildMonthlyReport(shipments, month, t), shipments);
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename="NNR-monthly-${month}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
