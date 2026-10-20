import { Prisma, type PrismaClient } from "@prisma/client";
import { canAccessShipment } from "../access";
import { sendMail } from "../mailer";
import { formatDate, formatDateTime, manilaParts } from "../time";
import type { ExportShipment } from "../columns";
import { buildDailyReport, dailyReportWhere, type DailyReport } from "./daily";
import { dailyWorkbook } from "./excel";

// Daily report delivery (spec 10.2): 07:30 Asia/Manila, by email to supervisors (whole report)
// and to each CS (their own shipments only), with the Excel file attached.

export const DAILY_REPORT_TIME = { hour: 7, minute: 30 };
const MAX_LINES = 25;

export async function loadReportShipments(db: PrismaClient, where: Prisma.ShipmentWhereInput): Promise<ExportShipment[]> {
  return db.shipment.findMany({
    where,
    include: { shipper: { select: { name: true } }, assignedCs: { select: { name: true, email: true } } },
    orderBy: { jobNo: "asc" },
  });
}

export function dailyReportText(r: DailyReport, forName: string): string {
  const base = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  const lines = [`NNR daily export report: ${r.date}`, `For ${forName}. Generated ${formatDateTime(r.generatedAt)}.`, ""];
  for (const sec of r.sections) {
    lines.push(`${sec.tone === "red" ? "!! " : ""}${sec.title.toUpperCase()} (${sec.items.length})`);
    if (sec.items.length === 0) lines.push("  none");
    for (const i of sec.items.slice(0, MAX_LINES)) {
      const when = i.at ? formatDateTime(i.at) : "no date";
      const done = i.doneAt && sec.key !== "departed" ? ` [done ${formatDateTime(i.doneAt)}]` : "";
      const flag = i.dueTag === "today" ? "[DUE TODAY] " : i.dueTag === "tomorrow" ? "[DUE TOMORROW] " : "";
      lines.push(`  ${flag}${i.jobNo}  ${i.what}  ${when}${done}  ${i.shipper}${i.detail ? `  (${i.detail})` : ""}  CS: ${i.cs}`);
    }
    if (sec.items.length > MAX_LINES) lines.push(`  …and ${sec.items.length - MAX_LINES} more (see the attached Excel)`);
    lines.push("");
  }
  lines.push(`Full report: ${base}/reports/daily`);
  return lines.join("\n");
}

/** Sends the daily report to every active supervisor and CS. Returns how many emails went out. */
export async function sendDailyReports(db: PrismaClient, now: Date): Promise<number> {
  const all = await loadReportShipments(db, dailyReportWhere(now));
  const users = await db.user.findMany({ where: { active: true, role: { in: ["SUPERVISOR", "CS"] } }, orderBy: { name: "asc" } });
  let sent = 0;
  for (const u of users) {
    const mine = all.filter((s) => canAccessShipment(u, s));
    const report = buildDailyReport(mine, now);
    const overdue = report.sections[0].items.length;
    await sendMail({
      to: [u.email],
      subject: `NNR daily report ${report.date}${overdue ? `: ${overdue} overdue` : ""}${u.role === "CS" ? " (your shipments)" : ""}`,
      text: dailyReportText(report, u.name),
      attachments: [{
        filename: `NNR-daily-${report.date}${u.role === "CS" ? `-${u.name.split(" ")[0]}` : ""}.xlsx`,
        content: await dailyWorkbook(report, mine),
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }],
    });
    sent++;
  }
  return sent;
}

/**
 * Called by the scheduler on every tick. Sends today's report once Manila time passes 07:30.
 * The AppSetting row `dailyReport:<date>` is the claim: creating it twice fails, so restarts or
 * two schedulers never send twice, and a scheduler started at 09:00 still sends that day's report.
 */
export async function runDailyReportIfDue(db: PrismaClient, now: Date): Promise<{ sent: number } | null> {
  const p = manilaParts(now);
  if (p.hour * 60 + p.minute < DAILY_REPORT_TIME.hour * 60 + DAILY_REPORT_TIME.minute) return null;
  const key = `dailyReport:${formatDate(now)}`;
  try {
    await db.appSetting.create({ data: { key, value: "sending" } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
  try {
    const sent = await sendDailyReports(db, now);
    await db.appSetting.update({ where: { key }, data: { value: `sent ${sent} at ${formatDateTime(now)}` } });
    return { sent };
  } catch (e) {
    // Release the claim so the next tick retries.
    await db.appSetting.delete({ where: { key } }).catch(() => {});
    throw e;
  }
}
