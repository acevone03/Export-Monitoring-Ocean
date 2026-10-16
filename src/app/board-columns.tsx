import type { Shipment } from "@prisma/client";
import { formatDate, formatDateTime } from "@/lib/time";
import { STATUS_LABEL } from "@/lib/status";
import type { DeadlineStatus } from "@/lib/deadline-status";
import type { DueState } from "@/lib/due";
import { containerText, lclText, SHEET_COLUMNS, type SheetKey } from "@/lib/nnr-sheet";

// Board columns follow NNR's monitoring sheet (src/lib/nnr-sheet.ts), so the board reads like the
// spreadsheet staff already know. Deadline columns are coloured: red overdue, amber due within 4h.
// App-only columns (status, CS, Job No.) come after REMARKS.

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

const dt = (d: Date | null | undefined) => (d ? formatDateTime(d) : "");
const day = (d: Date | null | undefined) => (d ? formatDate(d) : "");

/** A cut-off / deadline cell: the due time, coloured by state, with ✓ once the step is done. */
function deadline(type: string, emptyText = "") {
  return (_s: BoardRow, c: Ctx) => {
    const d = c.deadlines[type];
    if (!d?.dueAt) return <span className="text-slate-400">{emptyText}</span>;
    if (d.doneAt) return <span className={CELL_STATE.done} title={`Done ${formatDateTime(d.doneAt)}`}>✓ {formatDateTime(d.dueAt)}</span>;
    return <span className={`rounded px-1 ${CELL_STATE[d.state]}`}>{formatDateTime(d.dueAt)}</span>;
  };
}

/** A "date done" cell; while not done, shows the deadline (coloured) if there is one. */
function doneOrDue(field: keyof Shipment, type?: string) {
  return (s: BoardRow, c: Ctx) => {
    const done = s[field] as Date | null;
    if (done) return <span className="text-green-800">{day(done)}</span>;
    const d = type ? c.deadlines[type] : undefined;
    if (d?.dueAt && d.state !== "none") return <span className={`rounded px-1 text-xs ${CELL_STATE[d.state]}`}>due {formatDateTime(d.dueAt)}</span>;
    return "";
  };
}

function declaration(by: "SHIPPER" | "NNR") {
  return (s: BoardRow) => {
    if (s.declarationBy !== by) return <span className="text-slate-400">N/A</span>;
    if (s.exportDeclarationStatus !== "PENDING") return <span className="text-green-800" title={s.exportDeclarationStatus}>{day(s.exportDeclarationUpdatedAt)} {s.exportDeclarationStatus}</span>;
    return `C/O ${by}${by === "NNR" && s.declarationBroker ? ` (${s.declarationBroker})` : ""}`;
  };
}

const SHEET_CELLS: Record<SheetKey, Column["cell"]> = {
  hbl: (s) => <span className="font-mono">{s.hblNo ?? (/DIRECT BL/i.test(s.carrierRemarks ?? "") ? "DIRECT BL" : "(no HBL)")}{s.partOfHblNo && <span className="block text-xs text-slate-500">part of {s.partOfHblNo}</span>}</span>,
  booking: (s) => <span className="font-mono">{s.carrierBookingRef}</span>,
  shipper: (s) => s.shipper.name,
  destination: (s) => s.destinationPort,
  etd: (s) => day(s.etdMnl),
  atd: (s) => day(s.atdMnl),
  eta: (s) => day(s.eta),
  ata: (s) => day(s.ata),
  fcl40: (s) => containerText(s, "40"),
  fcl20: (s) => containerText(s, "20"),
  lcl: (s) => lclText(s),
  reqPickup: (s, c) => (s.requestedPickupAt ? deadline("PICKUP")(s, c) : <span className="text-slate-400">TBA</span>),
  actualPickup: (s) => <span className="text-green-800">{dt(s.actualPickupAt)}</span>,
  fsiCutoff: deadline("FSI"),
  preadviseCutoff: deadline("PREADVISE"),
  arrastreCutoff: (s, c) => (s.arrastreResponsibility === "NNR" ? deadline("ARRASTRE")(s, c) : <span className="text-slate-400">N/A</span>),
  declShipper: declaration("SHIPPER"),
  declNnr: declaration("NNR"),
  bocUpload: doneOrDue("bocUploadAt", "BOC_UPLOAD"),
  arrastrePaid: (s, c) => (s.arrastreResponsibility === "NNR" ? doneOrDue("arrastrePaidAt")(s, c) : <span className="text-slate-400">N/A</span>),
  docsSent: doneOrDue("exportDocsSentAt"),
  docsToCarrier: doneOrDue("exportDocsToCarrierAt"),
  carrier: (s) => s.carrierName,
  remarks: (s) => s.carrierRemarks,
};

const SHORT: Record<SheetKey, string> = {
  hbl: "HBL No.", booking: "Booking No.", shipper: "Shipper", destination: "Destination", etd: "ETD MNL", atd: "ATD MNL",
  eta: "ETA POD", ata: "ATA POD", fcl40: "FCL 40FT", fcl20: "FCL 20FT", lcl: "LCL qty", reqPickup: "Requested pick-up",
  actualPickup: "Actual pick-up", fsiCutoff: "Cut-off FSI", preadviseCutoff: "Cut-off pre-advise", arrastreCutoff: "Cut-off arrastre",
  declShipper: "Decl. c/o shipper", declNnr: "Decl. c/o NNR", bocUpload: "BOC portal upload", arrastrePaid: "Arrastre paid",
  docsSent: "Docs sent (customer)", docsToCarrier: "Docs sent (carrier)", carrier: "Shipping line / co-loader", remarks: "Remarks",
};

const WIDE: Partial<Record<SheetKey, string>> = { shipper: "min-w-44", destination: "min-w-28", remarks: "min-w-48" };

export const BOARD_COLUMNS: Column[] = [
  ...SHEET_COLUMNS.map((c, i) => ({
    header: SHORT[c.key],
    cell: SHEET_CELLS[c.key],
    className: i === 0 ? "sticky left-0 z-10 bg-inherit" : WIDE[c.key],
  })),
  { header: "Status", cell: (s: BoardRow) => STATUS_LABEL[s.status] },
  { header: "CS", cell: (s: BoardRow) => s.assignedCs.name },
  { header: "Job No.", cell: (s: BoardRow) => <span className="font-mono text-slate-500">{s.jobNo}</span> },
];
