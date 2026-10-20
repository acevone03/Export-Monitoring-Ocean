import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser, can } from "@/lib/auth";
import { now as clockNow } from "@/lib/clock";
import { formatDateTime } from "@/lib/time";
import { STATUS_LABEL } from "@/lib/status";
import { shipmentScope } from "@/lib/access";
import { deadlineStatuses, type RowState } from "@/lib/deadline-status";
import { arrangeBoard, boardCounts, boardWhere, parseBoardFilters, type BoardFilters } from "@/lib/board";
import { ClickableRow } from "@/components/ClickableRow";
import { getCarrierLinks, trackingTarget } from "@/lib/tracking";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BOARD_COLUMNS } from "./board-columns";

const ROW_STYLE: Record<RowState, string> = {
  overdue: "bg-red-50 hover:bg-red-100 border-l-4 border-l-red-600",
  soon: "bg-amber-50 hover:bg-amber-100 border-l-4 border-l-amber-500",
  ok: "bg-white hover:bg-green-50 border-l-4 border-l-green-600",
  inactive: "bg-slate-50 text-slate-500 hover:bg-slate-100 border-l-4 border-l-slate-300",
};

export default async function Board({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  if (user.role === "FIELD") {
    return (
      <div className="card max-w-lg">
        <h1 className="mb-2 font-semibold">Field updates</h1>
        <p className="text-sm text-slate-600">
          Open the update link CS sends you for each shipment. The links work on your phone without logging in.
        </p>
      </div>
    );
  }

  const f = parseBoardFilters(await searchParams);
  const now = await clockNow();
  const scope = shipmentScope(user);
  const include = { shipper: { select: { name: true } }, assignedCs: { select: { name: true } } } as const;

  // Chip counts ignore the view chip itself but respect the other filters.
  const [rows, base, shippers, csUsers, carriers] = await Promise.all([
    prisma.shipment.findMany({ where: { AND: [scope, boardWhere(f)] }, include }),
    prisma.shipment.findMany({ where: { AND: [scope, boardWhere({ ...f, view: "active" })] } }),
    prisma.shipper.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    can.viewAllShipments(user)
      ? prisma.user.findMany({ where: { role: { in: ["CS", "SUPERVISOR"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } })
      : Promise.resolve([]),
    getCarrierLinks(prisma),
  ]);
  const arranged = arrangeBoard(rows, f.view, now);
  const counts = boardCounts(base, now);

  const href = (patch: Partial<BoardFilters>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...patch })) if (v && !(k === "view" && v === "active")) q.set(k, String(v));
    const s = q.toString();
    return s ? `/?${s}` : "/";
  };
  const chips: Array<{ view: BoardFilters["view"]; label: string; count?: number; tone: string }> = [
    { view: "active", label: "Active", tone: "border-slate-300" },
    { view: "overdue", label: "Overdue", count: counts.overdue, tone: "border-red-400 text-red-800" },
    { view: "soon", label: "Due within 4h", count: counts.soon, tone: "border-amber-400 text-amber-900" },
    { view: "missing", label: "Missing data", count: counts.missing, tone: "border-slate-400" },
    { view: "all", label: "All incl. closed", tone: "border-slate-300" },
  ];

  return (
    <div className="space-y-4">
      <AutoRefresh seconds={60} />
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-lg font-semibold">{can.viewAllShipments(user) ? "All shipments" : "My shipments"}</h1>
        <span className="text-sm text-slate-500">{arranged.length} shown · updated {formatDateTime(now)}</span>
        {can.editShipments(user) && <Link href="/shipments/new" className="btn ml-auto">New shipment</Link>}
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="Quick filters">
        {chips.map((c) => (
          <Link
            key={c.view}
            href={href({ view: c.view })}
            className={`rounded-full border px-3 py-1 text-sm ${c.tone} ${f.view === c.view ? "bg-slate-800 !text-white" : "bg-white hover:bg-slate-50"}`}
            aria-current={f.view === c.view ? "page" : undefined}
          >
            {c.label}
            {c.count !== undefined && <span className="ml-1 font-semibold">{c.count}</span>}
          </Link>
        ))}
      </nav>

      <form method="get" className="card flex flex-wrap items-end gap-3 py-3">
        {f.view !== "active" && <input type="hidden" name="view" value={f.view} />}
        <Filter label="Status">
          <select name="status" defaultValue={f.status ?? ""} className="input py-1">
            <option value="">Any</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Filter>
        <Filter label="Shipper">
          <select name="shipper" defaultValue={f.shipper ?? ""} className="input py-1">
            <option value="">Any</option>
            {shippers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Filter>
        {csUsers.length > 0 && (
          <Filter label="Assigned CS">
            <select name="cs" defaultValue={f.cs ?? ""} className="input py-1">
              <option value="">Any</option>
              {csUsers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Filter>
        )}
        <Filter label="ETD from">
          <input type="date" name="etdFrom" defaultValue={f.etdFrom ?? ""} className="input py-1" />
        </Filter>
        <Filter label="ETD to">
          <input type="date" name="etdTo" defaultValue={f.etdTo ?? ""} className="input py-1" />
        </Filter>
        <button className="btn py-1.5">Apply</button>
        <Link href="/" className="btn-secondary py-1.5">Clear</Link>
      </form>

      <div className="flex flex-wrap gap-4 text-xs text-slate-600">
        <Legend cls="border-l-red-600 bg-red-50" text="Overdue" />
        <Legend cls="border-l-amber-500 bg-amber-50" text="Due within 4h" />
        <Legend cls="border-l-green-600 bg-white" text="On track" />
        <span>Deadline cells show the due time, or ✓ and the time it was done.</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
            <tr>
              {BOARD_COLUMNS.map((c) => (
                <th key={c.header} className={`whitespace-nowrap px-3 py-2 ${c.className?.includes("sticky") ? "sticky left-0 z-10 bg-slate-100" : ""}`}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {arranged.map(({ s, state, missing }) => {
              const deadlines = Object.fromEntries(deadlineStatuses(s, now).map((d) => [d.type, d]));
              const track = trackingTarget(carriers, s.carrierName, s.carrierBookingRef);
              return (
                <ClickableRow key={s.id} href={`/shipments/${s.id}`} className={ROW_STYLE[state]}>
                  {BOARD_COLUMNS.map((c, i) => (
                    <td key={c.header} className={`whitespace-nowrap px-3 py-2 ${c.className ?? ""}`}>
                      {i === 0 ? (
                        <Link href={`/shipments/${s.id}`} className="text-blue-700 hover:underline">{c.cell(s, { deadlines, track })}</Link>
                      ) : c.cell(s, { deadlines, track })}
                      {i === 0 && missing.length > 0 && (
                        <span className="ml-1 text-amber-600" title={`Missing: ${missing.join(", ")}`} aria-label={`Missing: ${missing.join(", ")}`}>⚠</span>
                      )}
                    </td>
                  ))}
                </ClickableRow>
              );
            })}
            {arranged.length === 0 && (
              <tr>
                <td colSpan={BOARD_COLUMNS.length} className="px-3 py-8 text-center text-slate-500">No shipments match these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block min-w-36">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function Legend({ cls, text }: { cls: string; text: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block h-3 w-4 border border-slate-200 border-l-4 ${cls}`} /> {text}
    </span>
  );
}
