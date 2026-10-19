import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { now as clockNow } from "@/lib/clock";
import { DAY, formatDate } from "@/lib/time";
import { STATUS_LABEL } from "@/lib/status";
import { containerPlanText } from "@/lib/containers";
import { UNBILLED_WHERE } from "@/lib/unbilled";
import { shipmentScope } from "@/lib/access";


const include = { shipper: { select: { code: true, name: true } }, assignedCs: { select: { name: true } } } as const;
type Row = Prisma.ShipmentGetPayload<{ include: typeof include }>;

export default async function UnbilledPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser(["CS", "SUPERVISOR"]);
  const q = ((await searchParams).q ?? "").trim();
  const now = await clockNow();
  const all = await prisma.shipment.findMany({ where: { AND: [UNBILLED_WHERE, shipmentScope(user)] }, include, orderBy: [{ atdMnl: "asc" }, { etdMnl: "asc" }] });
  const needle = q.toLowerCase();
  const rows = needle
    ? all.filter((s) => [s.hblNo, s.jobNo, s.carrierBookingRef, s.shipper.name, s.shipper.code].some((x) => x?.toLowerCase().includes(needle)))
    : all;
  const departed = rows.filter((s) => s.atdMnl);
  const notYet = rows.filter((s) => !s.atdMnl);
  const days = (d: Date) => Math.max(0, Math.floor((now.getTime() - d.getTime()) / DAY));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Unbilled shipments</h1>
          <p className="text-sm text-slate-600">
            Not yet billed to the customer. A shipment leaves this list when “Billing invoice to customer” is marked on its page.
            {user.role === "CS" && " Showing your shipments."}
          </p>
        </div>
        <form className="flex gap-2">
          <input name="q" defaultValue={q} className="input py-1" placeholder="HBL, job, booking or shipper" aria-label="Search unbilled" />
          <button className="btn-secondary py-1">Search</button>
        </form>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile label="Departed, not billed" value={departed.length} tone={departed.length ? "red" : "ok"} />
        <Tile label="Unbilled 7+ days after ATD" value={departed.filter((s) => days(s.atdMnl!) >= 7).length} tone="amber" hint="departed 7 or more days ago" />
        <Tile label="Not yet departed" value={notYet.length} tone="ok" />
      </div>

      <Table title="Departed, not billed" rows={departed} now={now} showAge empty="Every departed shipment has been billed." />
      <Table title="Not yet departed" rows={notYet} now={now} empty="No open shipments waiting." />
    </div>
  );
}

function Tile({ label, value, tone, hint }: { label: string; value: number; tone: "red" | "amber" | "ok"; hint?: string }) {
  const color = tone === "red" && value ? "text-red-700" : tone === "amber" && value ? "text-amber-700" : "text-slate-800";
  return (
    <div className="card">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`text-2xl font-semibold ${color}`}>{value}</p>
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

function Table({ title, rows, now, showAge, empty }: { title: string; rows: Row[]; now: Date; showAge?: boolean; empty: string }) {
  const cargo = (s: Row) =>
    s.cargoType === "FCL" ? containerPlanText(s.containerPlan as Array<{ size: string; qty: number }> | null) : `LCL ${s.lclQty ?? ""}`;
  const yes = (d: Date | null) => (d ? <span className="text-green-700">{formatDate(d)}</span> : <span className="text-slate-400">—</span>);
  const heads = ["HBL", "Job No.", "Shipper", "Cargo", "ETD", "ATD", ...(showAge ? ["Days since ATD"] : []), "E-track paid", "Shipping line paid", "CS", "Status"];
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">{title} ({rows.length})</h2>
      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
            <tr>{heads.map((h) => <th key={h} className="whitespace-nowrap px-3 py-2">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((s) => {
              const age = s.atdMnl ? Math.max(0, Math.floor((now.getTime() - s.atdMnl.getTime()) / DAY)) : 0;
              return (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-mono"><Link href={`/shipments/${s.id}`} className="text-blue-700 hover:underline">{s.hblNo ?? "(no HBL)"}</Link></td>
                  <td className="px-3 py-2 font-mono text-xs">{s.jobNo}</td>
                  <td className="px-3 py-2"><span className="font-mono text-xs text-slate-500">{s.shipper.code}</span> {s.shipper.name}</td>
                  <td className="whitespace-nowrap px-3 py-2">{cargo(s)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{formatDate(s.etdMnl)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{formatDate(s.atdMnl)}</td>
                  {showAge && (
                    <td className={`px-3 py-2 font-medium ${age >= 7 ? "text-red-700" : age >= 3 ? "text-amber-700" : ""}`}>{age}</td>
                  )}
                  <td className="whitespace-nowrap px-3 py-2">{yes(s.etrackPaidAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{yes(s.shippingLinePaidAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2">{s.assignedCs.name}</td>
                  <td className="whitespace-nowrap px-3 py-2">{STATUS_LABEL[s.status]}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={heads.length} className="px-3 py-6 text-center text-slate-500">{empty}</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
