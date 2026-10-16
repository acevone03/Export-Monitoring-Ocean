import type { Shipment } from "@prisma/client";
import { formatDateTime } from "@/lib/time";
import { STATUS_LABEL } from "@/lib/status";
import type { DeadlineStatus } from "@/lib/deadline-status";
import type { DueState } from "@/lib/due";

// [ASSUMPTION] Column order of the current monitoring spreadsheet. Not yet confirmed
// against the real file; reorder this array to match it. Also used for the Excel raw-data sheet later.

export type BoardRow = Shipment & { shipper: { name: string }; assignedCs: { name: string } };
type Ctx = { deadlines: Record<string, DeadlineStatus> };
export type Column = { header: string; cell: (s: BoardRow, c: Ctx) => React.ReactNode; className?: string };

const CELL_STATE: Record<DueState, string> = {
  overdue: "bg-red-100 text-red-900 font-medium",
  soon: "bg-amber-100 text-amber-900 font-medium",
  done: "text-green-800",
  ok: "",
  none: "",
};

/** A deadline cell: shows "done" time when completed, otherwise the due time, coloured by state. */
function deadlineCell(type: string, emptyText = "") {
  return (_s: BoardRow, c: Ctx) => {
    const d = c.deadlines[type];
    if (!d) return null;
    if (d.doneAt) return <span className={CELL_STATE.done} title={`Due ${formatDateTime(d.dueAt)}`}>✓ {formatDateTime(d.doneAt)}</span>;
    if (!d.dueAt) return <span className="text-slate-400">{emptyText}</span>;
    return <span className={`rounded px-1 ${CELL_STATE[d.state]}`}>{formatDateTime(d.dueAt)}</span>;
  };
}

const cargo = (s: BoardRow) => {
  if (s.cargoType === "LCL") return `LCL ${s.lclQty ?? "?"} ${s.lclUnit === "BOX" ? "box" : "plt"}`;
  const plan = (s.containerPlan as Array<{ size: string; qty: number }> | null) ?? [];
  return plan.map((c) => `${c.qty}×${c.size}`).join(" + ");
};

export const BOARD_COLUMNS: Column[] = [
  { header: "Job No.", cell: (s) => <span className="font-mono">{s.jobNo}</span>, className: "sticky left-0 z-10 bg-inherit" },
  { header: "HBL No.", cell: (s) => <span className="font-mono">{s.hblNo}</span> },
  { header: "Shipper", cell: (s) => s.shipper.name, className: "min-w-48" },
  { header: "Destination", cell: (s) => s.destinationPort, className: "min-w-36" },
  { header: "POD", cell: (s) => s.pod, className: "min-w-36" },
  { header: "Cargo", cell: cargo },
  { header: "Carrier", cell: (s) => s.carrierName },
  { header: "Carrier booking ref", cell: (s) => <span className="font-mono">{s.carrierBookingRef}</span> },
  { header: "Pick-up", cell: deadlineCell("PICKUP", "not scheduled") },
  { header: "FSI cut-off", cell: deadlineCell("FSI") },
  { header: "Pre-advise cut-off", cell: deadlineCell("PREADVISE") },
  { header: "Export decl.", cell: (s) => s.exportDeclarationStatus },
  { header: "BOC upload", cell: deadlineCell("BOC_UPLOAD") },
  {
    header: "Arrastre",
    cell: (s, c) => (s.arrastreResponsibility === "SHIPPER" ? <span className="text-slate-500">Shipper</span> : deadlineCell("ARRASTRE")(s, c)),
  },
  { header: "Docs sent", cell: (s) => (s.exportDocsSentAt ? <span className="text-green-800">✓ {formatDateTime(s.exportDocsSentAt)}</span> : "") },
  { header: "ETD MNL", cell: (s) => formatDateTime(s.etdMnl) },
  { header: "ATD MNL", cell: (s) => formatDateTime(s.atdMnl) },
  { header: "ETA", cell: (s) => formatDateTime(s.eta) },
  { header: "Status", cell: (s) => STATUS_LABEL[s.status] },
  { header: "CS", cell: (s) => s.assignedCs.name },
  { header: "Remarks", cell: (s) => s.carrierRemarks, className: "min-w-48" },
];
