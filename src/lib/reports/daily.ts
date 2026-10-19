import type { DeadlineType } from "@prisma/client";
import { DEADLINE_DEFS, deadlineStatuses, deadlinesMoot } from "../deadline-status";
import { missingMandatory } from "../mandatory";
import { formatDate } from "../time";
import type { ExportShipment } from "../columns";
import { manilaDay, within } from "./period";

// Daily report (spec 10.2). Pure: takes the shipments the reader may see, and "now".
// Section order follows the spec, except Overdue, which goes first ("top of report, red").

export type DailyItem = {
  shipmentId: string;
  jobNo: string;
  shipper: string;
  cs: string;
  what: string;
  at: Date | null; // due time, or event time for "departed"
  doneAt: Date | null;
  detail?: string;
};

export type DailySection = { key: string; title: string; tone: "red" | "normal"; items: DailyItem[] };
export type DailyReport = { date: string; generatedAt: Date; sections: DailySection[] };

const base = (s: ExportShipment) => ({ shipmentId: s.id, jobNo: s.jobNo, shipper: s.shipper.name, cs: s.assignedCs.name });
const byTime = (a: DailyItem, b: DailyItem) => (a.at?.getTime() ?? Infinity) - (b.at?.getTime() ?? Infinity) || a.jobNo.localeCompare(b.jobNo);
const LABEL = Object.fromEntries(DEADLINE_DEFS.map((d) => [d.type, d.label])) as Record<DeadlineType, string>;

export function buildDailyReport(shipments: ExportShipment[], now: Date): DailyReport {
  const today = manilaDay(now);
  const tomorrow = manilaDay(now, 1);
  const yesterday = manilaDay(now, -1);
  const twoDays = { start: today.start, end: tomorrow.end };
  const live = shipments.filter((s) => s.status !== "CANCELLED");
  const open = live.filter((s) => s.status !== "CLOSED");

  const overdue: DailyItem[] = [];
  for (const s of open) {
    for (const d of deadlineStatuses(s, now)) {
      if (d.state === "overdue") overdue.push({ ...base(s), what: LABEL[d.type], at: d.dueAt, doneAt: null });
    }
  }

  const pickups = live
    .filter((s) => within(s.requestedPickupAt, twoDays))
    .map((s) => ({
      ...base(s),
      what: within(s.requestedPickupAt, today) ? "Pick-up today" : "Pick-up tomorrow",
      at: s.requestedPickupAt,
      doneAt: s.actualPickupAt,
    }));

  const cutoffs: DailyItem[] = [];
  for (const s of open) {
    if (within(s.fsiCutoffAt, today)) cutoffs.push({ ...base(s), what: "FSI cut-off", at: s.fsiCutoffAt, doneAt: s.fsiSubmittedAt });
    if (within(s.preadviseCutoffAt, today)) cutoffs.push({ ...base(s), what: "Pre-advise cut-off", at: s.preadviseCutoffAt, doneAt: s.preadviseSentAt });
  }

  const pending: DailyItem[] = [];
  for (const s of open.filter((x) => !deadlinesMoot(x))) {
    if (!s.bocUploadAt) pending.push({ ...base(s), what: "BOC portal upload", at: s.bocDeadlineAt, doneAt: null });
    if (s.arrastreResponsibility === "NNR" && !s.arrastrePaidAt) pending.push({ ...base(s), what: "Arrastre payment", at: s.arrastreDeadlineAt, doneAt: null });
    // E-track has no deadline of its own: listed once the cargo is picked up, until it is paid.
    if (s.actualPickupAt && !s.etrackPaidAt) pending.push({ ...base(s), what: "E-track payment", at: null, doneAt: null });
  }

  // Payments recorded yesterday or today (any shipment that is not cancelled, closed ones included).
  const twoDaysBack = { start: yesterday.start, end: today.end };
  const payments: DailyItem[] = [];
  for (const s of live) {
    if (within(s.arrastrePaidAt, twoDaysBack)) payments.push({ ...base(s), what: "Arrastre paid", at: s.arrastrePaidAt, doneAt: s.arrastrePaidAt });
    if (within(s.etrackPaidAt, twoDaysBack)) payments.push({ ...base(s), what: "E-track paid", at: s.etrackPaidAt, doneAt: s.etrackPaidAt });
  }

  const departed = live
    .filter((s) => within(s.atdMnl, yesterday))
    .map((s) => ({ ...base(s), what: `Departed to ${s.destinationPort}`, at: s.atdMnl, doneAt: s.atdMnl, detail: s.eta ? `ETA ${formatDate(s.eta)}` : "ETA missing" }));

  const missing = open
    .map((s) => ({ s, m: missingMandatory(s) }))
    .filter(({ m }) => m.length > 0)
    .map(({ s, m }) => ({ ...base(s), what: "Missing data", at: s.etdMnl, doneAt: null, detail: m.join(", ") }));

  return {
    date: formatDate(now),
    generatedAt: now,
    sections: [
      { key: "overdue", title: "Overdue items", tone: "red", items: overdue.sort(byTime) },
      { key: "pickups", title: "Pick-ups today and tomorrow", tone: "normal", items: pickups.sort(byTime) },
      { key: "cutoffs", title: "Cut-offs due today (FSI, pre-advise)", tone: "normal", items: cutoffs.sort(byTime) },
      { key: "pending", title: "Pending BOC uploads, arrastre and E-track payments", tone: "normal", items: pending.sort(byTime) },
      { key: "payments", title: "Arrastre and E-track paid (yesterday and today)", tone: "normal", items: payments.sort(byTime) },
      { key: "departed", title: "Departed yesterday", tone: "normal", items: departed.sort(byTime) },
      { key: "missing", title: "Shipments with missing mandatory data", tone: "normal", items: missing.sort(byTime) },
    ],
  };
}

/** Prisma `where` for the shipments a daily report can mention (skips long-closed history). */
export function dailyReportWhere(now: Date) {
  return {
    status: { not: "CANCELLED" as const },
    OR: [
      { status: { not: "CLOSED" as const } },
      { atdMnl: { gte: manilaDay(now, -1).start } },
      // Payments can be recorded after a shipment is closed.
      { arrastrePaidAt: { gte: manilaDay(now, -1).start } },
      { etrackPaidAt: { gte: manilaDay(now, -1).start } },
    ],
  };
}
