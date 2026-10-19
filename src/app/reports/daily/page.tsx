import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser, can } from "@/lib/auth";
import { now as clockNow } from "@/lib/clock";
import { shipmentScope } from "@/lib/access";
import { formatDateTime } from "@/lib/time";
import { buildDailyReport, dailyReportWhere } from "@/lib/reports/daily";
import { loadReportShipments } from "@/lib/reports/deliver";
import { ActionForm } from "@/components/ActionForm";
import { sendDailyNowAction } from "./actions";

// Open items due today are red, due tomorrow orange.
const DUE_ROW = { today: "bg-red-200 text-red-950 font-medium", tomorrow: "bg-orange-200 text-orange-950" } as const;

export default async function DailyReportPage() {
  const user = await requireUser(["CS", "SUPERVISOR"]);
  const t = await clockNow();
  const shipments = await loadReportShipments(prisma, { AND: [shipmentScope(user), dailyReportWhere(t)] });
  const report = buildDailyReport(shipments, t);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-lg font-semibold">Daily report: {report.date}</h1>
          <p className="text-sm text-slate-500">
            {can.viewAllShipments(user) ? "All shipments" : "Your shipments"} · as of {formatDateTime(report.generatedAt)} ·
            emailed automatically every day at 07:30
          </p>
          <p className="mt-1 flex flex-wrap gap-3 text-xs">
            <span className="rounded bg-red-200 px-2 py-0.5 font-medium text-red-950">Due today</span>
            <span className="rounded bg-orange-200 px-2 py-0.5 text-orange-950">Due tomorrow</span>
          </p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <a href="/reports/daily/export" className="btn">Download Excel</a>
          {user.role === "SUPERVISOR" && (
            <ActionForm action={sendDailyNowAction}>
              <button className="btn-secondary">Email it now</button>
            </ActionForm>
          )}
        </div>
      </div>

      {report.sections.map((sec) => (
        <section key={sec.key} className={`card ${sec.tone === "red" && sec.items.length ? "border-red-300 bg-red-50" : ""}`}>
          <h2 className={`mb-2 font-semibold ${sec.tone === "red" ? "text-red-800" : ""}`}>
            {sec.title} <span className="font-normal text-slate-500">({sec.items.length})</span>
          </h2>
          {sec.items.length === 0 ? (
            <p className="text-sm text-slate-500">None.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="py-1 pr-4">Job No.</th><th className="pr-4">Shipper</th><th className="pr-4">Item</th><th className="pr-4">{sec.key === "departed" ? "ATD" : sec.key === "missing" ? "ETD" : "Due"}</th><th className="pr-4">{sec.key === "missing" ? "Missing" : sec.key === "departed" ? "ETA" : "Done"}</th><th>CS</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-200/70">
                  {sec.items.map((i, k) => (
                    <tr key={`${i.shipmentId}-${i.what}-${k}`} className={i.dueTag ? DUE_ROW[i.dueTag] : ""}>
                      <td className="whitespace-nowrap py-1.5 pr-4 font-mono"><Link href={`/shipments/${i.shipmentId}`} className="text-blue-700 hover:underline">{i.jobNo}</Link></td>
                      <td className="pr-4">{i.shipper}</td>
                      <td className="pr-4">{i.what}</td>
                      <td className="whitespace-nowrap pr-4">{i.at ? formatDateTime(i.at) : <span className="text-slate-400">no date</span>}</td>
                      <td className="pr-4">
                        {sec.key === "missing" || sec.key === "departed" ? i.detail : i.doneAt ? <span className="text-green-700">✓ {formatDateTime(i.doneAt)}</span> : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="whitespace-nowrap">{i.cs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
