import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { now as clockNow } from "@/lib/clock";
import { formatDateTime } from "@/lib/time";
import { buildMonthlyReport, monthlyReportWhere, type CountRow } from "@/lib/reports/monthly";
import { manilaMonth, monthKeyOf } from "@/lib/reports/period";
import { loadReportShipments } from "@/lib/reports/deliver";

const hours = (h: number | null) => (h === null ? "—" : Math.abs(h) >= 48 ? `${(h / 24).toFixed(1)} days` : `${h} h`);

export default async function MonthlyReportPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireUser(["SUPERVISOR"]);
  const t = await clockNow();
  const q = (await searchParams).month ?? "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(q) ? q : monthKeyOf(t);
  const shipments = await loadReportShipments(prisma, monthlyReportWhere(month));
  const r = buildMonthlyReport(shipments, month, t);

  // Current month and the 11 before it, for the picker.
  const [cy, cm] = monthKeyOf(t).split("-").map(Number);
  const months = Array.from({ length: 12 }, (_, i) => {
    const idx = cy * 12 + (cm - 1) - i;
    return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-lg font-semibold">Monthly report: {r.label}</h1>
          <p className="text-sm text-slate-500">As of {formatDateTime(r.generatedAt)}. Deadlines count in the month they fall due.</p>
        </div>
        <form className="ml-auto flex items-end gap-2">
          <label><span className="label">Month</span>
            <select name="month" defaultValue={month} className="input py-1.5">
              {months.map((m) => <option key={m} value={m}>{manilaMonth(m).label}</option>)}
            </select>
          </label>
          <button className="btn-secondary py-1.5">Show</button>
        </form>
        <a href={`/reports/monthly/export?month=${month}`} className="btn">Download Excel</a>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Shipments" value={r.totals.shipments} sub={`${r.totals.fcl} FCL · ${r.totals.lcl} LCL${r.totals.cancelled ? ` · ${r.totals.cancelled} cancelled` : ""}`} />
        <Stat label="Containers (FCL)" value={Object.values(r.totals.containers).reduce((a, b) => a + b, 0)} sub={Object.entries(r.totals.containers).map(([k, v]) => `${v}×${k}`).join(" · ") || "—"} />
        <Stat label="Avg pick-up delay" value={hours(r.pickupDelay.avgHours)} sub={`actual − requested, ${r.pickupDelay.count} pick-ups`} />
        <Stat label="Avg pick-up → ATD" value={hours(r.pickupToAtd.avgHours)} sub={`${r.pickupToAtd.count} departures`} />
      </div>

      <section className="card">
        <h2 className="mb-2 font-semibold">On-time rate by deadline</h2>
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr><th className="py-1">Deadline</th><th>On time</th><th>Late</th><th>Open &amp; overdue</th><th>Total</th><th className="w-1/3">On-time rate</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {r.onTime.map((o) => (
              <tr key={o.deadline}>
                <td className="py-1.5">{o.deadline}</td><td>{o.onTime}</td><td>{o.late}</td><td>{o.openOverdue}</td><td>{o.total}</td>
                <td>
                  {o.rate === null ? <span className="text-slate-400">no deadlines due</span> : (
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-40 rounded bg-slate-200"><div className={`h-2 rounded ${o.rate >= 90 ? "bg-green-600" : o.rate >= 70 ? "bg-amber-500" : "bg-red-600"}`} style={{ width: `${o.rate}%` }} /></div>
                      <span>{o.rate}%</span>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-sm text-slate-600">
          Arrastre: <b>{r.arrastre.onTime}</b> paid on time, <b>{r.arrastre.late}</b> paid late, <b>{r.arrastre.unpaidOverdue}</b> unpaid and overdue.
        </p>
      </section>

      <section className="card">
        <h2 className="mb-1 font-semibold">Arrastre and E-track payments</h2>
        <p className="mb-2 text-sm text-slate-600">
          <b>{r.payments.arrastrePaid}</b> arrastre and <b>{r.payments.etrackPaid}</b> E-track payments recorded this month.
          {r.payments.etrackUnpaidDeparted > 0 && (
            <span className="text-red-700"> {r.payments.etrackUnpaidDeparted} shipment(s) departed this month without E-track paid.</span>
          )}
        </p>
        {r.payments.rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="py-1 pr-4">Paid</th><th className="pr-4">Payment</th><th className="pr-4">Job No.</th><th className="pr-4">HBL No.</th><th className="pr-4">Shipper</th><th>CS</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {r.payments.rows.map((p, i) => (
                  <tr key={`${p.shipmentId}-${p.what}-${i}`}>
                    <td className="whitespace-nowrap py-1.5 pr-4">{formatDateTime(p.paidAt)}</td>
                    <td className="pr-4">{p.what}</td>
                    <td className="whitespace-nowrap pr-4 font-mono"><Link href={`/shipments/${p.shipmentId}`} className="text-blue-700 hover:underline">{p.jobNo}</Link></td>
                    <td className="whitespace-nowrap pr-4 font-mono">{p.hblNo ?? "—"}</td>
                    <td className="pr-4">{p.shipper}</td>
                    <td>{p.cs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Counts title="Missed deadlines by CS" rows={r.missedByCs} empty="No missed deadlines." />
        <Counts title="Missed deadlines by shipper" rows={r.missedByShipper} empty="No missed deadlines." />
      </div>

      <section className="card">
        <h2 className="mb-2 font-semibold">Missed deadlines ({r.missed.length})</h2>
        {r.missed.length === 0 ? <p className="text-sm text-slate-500">None. 🎉</p> : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="py-1 pr-4">Job No.</th><th className="pr-4">Shipper</th><th className="pr-4">CS</th><th className="pr-4">Deadline</th><th className="pr-4">Due</th><th className="pr-4">Done</th><th>Late by</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {r.missed.map((m, i) => (
                  <tr key={`${m.shipmentId}-${m.deadline}-${i}`}>
                    <td className="whitespace-nowrap py-1.5 pr-4 font-mono"><Link href={`/shipments/${m.shipmentId}`} className="text-blue-700 hover:underline">{m.jobNo}</Link></td>
                    <td className="pr-4">{m.shipper}</td><td className="pr-4">{m.cs}</td><td className="pr-4">{m.deadline}</td>
                    <td className="whitespace-nowrap pr-4">{formatDateTime(m.dueAt)}</td>
                    <td className="whitespace-nowrap pr-4">{m.doneAt ? formatDateTime(m.doneAt) : <span className="text-red-700">still open</span>}</td>
                    <td className="whitespace-nowrap">{m.lateHours === null ? "—" : hours(m.lateHours)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Counts title="Shipments by destination" rows={r.byDestination} empty="No shipments." />
        <Counts title="Shipments by shipper" rows={r.byShipper} empty="No shipments." />
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub: string }) {
  return (
    <div className="card">
      <p className="label">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-slate-500">{sub}</p>
    </div>
  );
}

function Counts({ title, rows, empty }: { title: string; rows: CountRow[]; empty: string }) {
  return (
    <section className="card">
      <h2 className="mb-2 font-semibold">{title}</h2>
      {rows.length === 0 ? <p className="text-sm text-slate-500">{empty}</p> : (
        <table className="min-w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => <tr key={r.key}><td className="py-1.5">{r.key}</td><td className="text-right font-medium">{r.count}</td></tr>)}
          </tbody>
        </table>
      )}
    </section>
  );
}
