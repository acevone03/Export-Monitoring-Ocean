import type { DeadlineType } from "@prisma/client";
import { DEADLINE_DEFS } from "../deadline-status";
import type { ExportShipment } from "../columns";
import { manilaMonth, within, type Period } from "./period";

// Monthly report (spec 10.3). Pure function of the shipments and "now".
//
// Definitions (see DECISIONS.md, Step 6):
// - Shipment totals: shipments created (Job No. issued) in the month. Cancelled are counted
//   separately and left out of the breakdowns.
// - Rows imported as closed history count in volumes and actual-date averages, not in deadline metrics.
// - A deadline belongs to the month in which it falls due. On time = completed at or before
//   the due time. Missed = completed late, or still open after the due time. Deadlines not yet
//   due are left out of the rate. Cancelled shipments are left out entirely.
// - Pick-up delay: shipments whose requested pick-up is in the month and that were picked up.
// - Pick-up to ATD: shipments that departed (ATD) in the month.

export type MissedDeadline = {
  shipmentId: string;
  jobNo: string;
  shipper: string;
  cs: string;
  deadline: string;
  dueAt: Date;
  doneAt: Date | null;
  lateHours: number | null; // null while still open
};

export type CountRow = { key: string; count: number };
export type OnTimeRow = { deadline: string; onTime: number; late: number; openOverdue: number; total: number; rate: number | null };

export type MonthlyReport = {
  month: string;
  label: string;
  generatedAt: Date;
  totals: { shipments: number; cancelled: number; fcl: number; lcl: number; containers: Record<string, number> };
  byDestination: CountRow[];
  byShipper: CountRow[];
  onTime: OnTimeRow[];
  missed: MissedDeadline[];
  missedByCs: CountRow[];
  missedByShipper: CountRow[];
  pickupDelay: { count: number; avgHours: number | null };
  pickupToAtd: { count: number; avgHours: number | null };
  arrastre: { onTime: number; late: number; unpaidOverdue: number };
};

const HOUR = 3_600_000;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);

function countBy<T>(xs: T[], key: (x: T) => string): CountRow[] {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) ?? 0) + 1);
  return [...m.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function buildMonthlyReport(shipments: ExportShipment[], month: string, now: Date): MonthlyReport {
  const period: Period & { label: string } = manilaMonth(month);
  const created = shipments.filter((s) => within(s.createdAt, period));
  const active = created.filter((s) => s.status !== "CANCELLED");
  const live = shipments.filter((s) => s.status !== "CANCELLED");
  // Rows imported as history never had their steps tracked in the app (the old sheet has no
  // "FSI submitted" etc.), so they would show as missed: keep them out of deadline metrics.
  const tracked = live.filter((s) => !s.importedAsHistory);

  const containers: Record<string, number> = {};
  for (const s of active.filter((x) => x.cargoType === "FCL")) {
    for (const c of (s.containerPlan as Array<{ size: string; qty: number }> | null) ?? []) containers[c.size] = (containers[c.size] ?? 0) + c.qty;
  }

  const onTime: OnTimeRow[] = [];
  const missed: MissedDeadline[] = [];
  for (const def of DEADLINE_DEFS) {
    const row = { deadline: def.label, onTime: 0, late: 0, openOverdue: 0, total: 0, rate: null as number | null };
    for (const s of tracked) {
      const due = def.due(s);
      if (!due || !within(due, period)) continue;
      const done = def.done(s);
      const entry = { shipmentId: s.id, jobNo: s.jobNo, shipper: s.shipper.name, cs: s.assignedCs.name, deadline: def.label, dueAt: due };
      if (done && done <= due) row.onTime++;
      else if (done) {
        row.late++;
        missed.push({ ...entry, doneAt: done, lateHours: round1((done.getTime() - due.getTime()) / HOUR) });
      } else if (due < now) {
        row.openOverdue++;
        missed.push({ ...entry, doneAt: null, lateHours: null });
      }
    }
    row.total = row.onTime + row.late + row.openOverdue;
    row.rate = row.total ? Math.round((row.onTime / row.total) * 1000) / 10 : null;
    onTime.push(row);
  }
  missed.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

  const delays = live
    .filter((s) => within(s.requestedPickupAt, period) && s.actualPickupAt)
    .map((s) => (s.actualPickupAt!.getTime() - s.requestedPickupAt!.getTime()) / HOUR);
  const toAtd = live
    .filter((s) => within(s.atdMnl, period) && s.actualPickupAt)
    .map((s) => (s.atdMnl!.getTime() - s.actualPickupAt!.getTime()) / HOUR);

  const arrastreDef = DEADLINE_DEFS.find((d) => d.type === ("ARRASTRE" as DeadlineType))!;
  const arrastre = { onTime: 0, late: 0, unpaidOverdue: 0 };
  for (const s of tracked) {
    const due = arrastreDef.due(s);
    if (!due || !within(due, period)) continue;
    if (s.arrastrePaidAt) s.arrastrePaidAt <= due ? arrastre.onTime++ : arrastre.late++;
    else if (due < now) arrastre.unpaidOverdue++;
  }

  return {
    month,
    label: period.label,
    generatedAt: now,
    totals: {
      shipments: active.length,
      cancelled: created.length - active.length,
      fcl: active.filter((s) => s.cargoType === "FCL").length,
      lcl: active.filter((s) => s.cargoType === "LCL").length,
      containers,
    },
    byDestination: countBy(active, (s) => s.destinationPort),
    byShipper: countBy(active, (s) => s.shipper.name),
    onTime,
    missed,
    missedByCs: countBy(missed, (m) => m.cs),
    missedByShipper: countBy(missed, (m) => m.shipper),
    pickupDelay: { count: delays.length, avgHours: round1(avg(delays)) },
    pickupToAtd: { count: toAtd.length, avgHours: round1(avg(toAtd)) },
    arrastre,
  };
}

/** Prisma `where` for every shipment that can touch the month in any metric. */
export function monthlyReportWhere(month: string) {
  const p = manilaMonth(month);
  const r = { gte: p.start, lt: p.end };
  return {
    OR: [
      { createdAt: r }, { requestedPickupAt: r }, { fsiCutoffAt: r }, { preadviseCutoffAt: r },
      { bocDeadlineAt: r }, { arrastreDeadlineAt: r }, { atdMnl: r },
    ],
  };
}
