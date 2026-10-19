import type { Shipment } from "@prisma/client";
import { STATUS_LABEL } from "./status";

// NNR's export ocean cargo monitoring sheet ("Export Ocean Cargo Monitoring / NNR HBL").
// One definition of its 24 columns (three header rows, as in the original) used by:
//   - the Excel raw-data export (same columns, same headers, same order),
//   - the importer (fixed column positions),
//   - the board (same column order).
// Columns after REMARKS are extras from the app and are ignored on import.

export type SheetShipment = Shipment & { shipper: { name: string }; assignedCs: { name: string; email?: string } };
export type CellValue = string | number | Date | null;

export type SheetKey =
  | "hbl" | "booking" | "shipper" | "destination" | "etd" | "atd" | "eta" | "ata"
  | "fcl40" | "fcl20" | "lcl" | "reqPickup" | "actualPickup" | "fsiCutoff" | "preadviseCutoff" | "arrastreCutoff"
  | "declShipper" | "declNnr" | "bocUpload" | "arrastrePaid" | "docsSent" | "docsToOverseas" | "carrier" | "remarks";

// [top header, middle header, bottom header] exactly as laid out in the original sheet.
// (The original's bottom row places "SHIPPING LINE / CO-LOADER" two columns early, under the
// docs columns; the data shows they belong to CARRIER, so they are written there.)
export const SHEET_COLUMNS: Array<{ key: SheetKey; header: [string, string, string]; width: number }> = [
  { key: "hbl", header: ["HBL NO.", "", ""], width: 18 },
  { key: "booking", header: ["BOOKING NO.", "", ""], width: 15 },
  { key: "shipper", header: ["SHIPPER", "", ""], width: 22 },
  { key: "destination", header: ["DESTINATION", "", ""], width: 16 },
  { key: "etd", header: ["", "ETD MNL", ""], width: 12 },
  { key: "atd", header: ["", "ATD MNL", ""], width: 12 },
  { key: "eta", header: ["", "ETA POD", ""], width: 12 },
  { key: "ata", header: ["", "ATA POD", ""], width: 12 },
  { key: "fcl40", header: ["FCL", "", "40FT"], width: 18 },
  { key: "fcl20", header: ["", "", "20FT"], width: 10 },
  { key: "lcl", header: ["LCL", "", "Quantity"], width: 14 },
  { key: "reqPickup", header: ["SHIPPER'S REQUESTED PICK UP DATE", "", ""], width: 16 },
  { key: "actualPickup", header: ["ACTUAL PICK UP DATE", "", ""], width: 16 },
  { key: "fsiCutoff", header: ["CUT OFF DATE & TIME", "", "FSI"], width: 16 },
  { key: "preadviseCutoff", header: ["", "", "PRE ADVISE"], width: 16 },
  { key: "arrastreCutoff", header: ["", "", "ARRASTRE"], width: 16 },
  { key: "declShipper", header: ["EXPORT DECLARTION", "", "C/O SHIPPER"], width: 14 },
  { key: "declNnr", header: ["", "", "C/O NNR"], width: 14 },
  { key: "bocUpload", header: ["DATE UPLOAD TO BOC PORTAL", "", ""], width: 14 },
  { key: "arrastrePaid", header: ["DATE ARRASTE PAID", "", ""], width: 14 },
  // The original's second "date sent" column has no label; [ASSUMPTION] customer / carrier.
  { key: "docsSent", header: ["DATE SENT THE EXPORT DOCUMENTS", "", "TO CUSTOMER"], width: 14 },
  { key: "docsToOverseas", header: ["", "", "TO OVERSEAS OFFICE"], width: 14 },
  { key: "carrier", header: ["CARRIER", "", "SHIPPING LINE / CO-LOADER"], width: 16 },
  { key: "remarks", header: ["REMARKS", "", ""], width: 30 },
];

const plan = (s: Shipment) => (s.containerPlan as Array<{ size: string; qty: number }> | null) ?? [];

/** "1X40HC & 1X40" for the 40FT column, "2X20" for the 20FT column. */
export function containerText(s: Shipment, size: "40" | "20"): string {
  if (s.cargoType !== "FCL") return "";
  return plan(s)
    .filter((c) => (size === "20" ? c.size.startsWith("20") : !c.size.startsWith("20"))) // 20RF reefers go in the 20FT column
    .map((c) => `${c.qty}X${c.size}`)
    .join(" & ");
}

export function lclText(s: Shipment): string {
  if (s.cargoType !== "LCL" || !s.lclQty) return s.cargoType === "LCL" ? "LCL" : "";
  return `${s.lclQty} ${s.lclUnit === "BOX" ? (s.lclQty === 1 ? "CTN" : "CTNS") : s.lclQty === 1 ? "PALLET" : "PALLETS"}`;
}

const filed = (s: Shipment) => (s.exportDeclarationStatus !== "PENDING" ? s.exportDeclarationUpdatedAt : null);

/** Sheet convention: the date the declaration was filed goes under whoever handled it; the other says N/A. */
function declarationCell(s: Shipment, by: "SHIPPER" | "NNR"): CellValue {
  if (s.declarationBy !== by) return "N/A";
  const d = filed(s);
  if (d) return d;
  return by === "NNR" ? `C/O NNR${s.declarationForwarder ? ` (${s.declarationForwarder})` : ""}` : "C/O SHIPPER";
}

export const SHEET_VALUE: Record<SheetKey, (s: SheetShipment) => CellValue> = {
  hbl: (s) => (s.partOfHblNo ? `${s.hblNo} / PART OF ${s.partOfHblNo}` : s.hblNo),
  booking: (s) => s.carrierBookingRef,
  shipper: (s) => s.shipper.name,
  destination: (s) => s.destinationPort,
  etd: (s) => s.etdMnl,
  atd: (s) => s.atdMnl,
  eta: (s) => s.eta,
  ata: (s) => s.ata,
  fcl40: (s) => containerText(s, "40"),
  fcl20: (s) => containerText(s, "20"),
  lcl: (s) => lclText(s),
  reqPickup: (s) => s.requestedPickupAt ?? "TBA",
  actualPickup: (s) => s.actualPickupAt,
  fsiCutoff: (s) => s.fsiCutoffAt,
  preadviseCutoff: (s) => s.preadviseCutoffAt,
  arrastreCutoff: (s) => (s.arrastreResponsibility === "NNR" ? s.arrastreCutoffAt : "N/A"),
  declShipper: (s) => declarationCell(s, "SHIPPER"),
  declNnr: (s) => declarationCell(s, "NNR"),
  bocUpload: (s) => s.bocUploadAt,
  arrastrePaid: (s) => (s.arrastreResponsibility === "NNR" ? s.arrastrePaidAt : "N/A"),
  docsSent: (s) => s.exportDocsSentAt,
  docsToOverseas: (s) => s.exportDocsToOverseasAt,
  carrier: (s) => s.carrierName,
  remarks: (s) => [s.status === "CANCELLED" ? "CANCELLED BOOKING" : "", s.carrierRemarks ?? ""].filter(Boolean).join("; ") || null,
};

/** App-only columns appended after REMARKS in exports (ignored on import). */
export const EXTRA_COLUMNS: Array<{ header: string; value: (s: SheetShipment) => CellValue; width: number }> = [
  { header: "JOB NO.", value: (s) => s.jobNo, width: 16 },
  { header: "STATUS", value: (s) => STATUS_LABEL[s.status], width: 16 },
  { header: "ASSIGNED CS", value: (s) => s.assignedCs.name, width: 16 },
  // Names can repeat; the email lets the export be imported back unambiguously.
  { header: "CS EMAIL", value: (s) => s.assignedCs.email ?? null, width: 22 },
  { header: "CONSIGNEE", value: (s) => s.consigneeName, width: 20 },
  { header: "POD", value: (s) => s.pod, width: 16 },
  { header: "FSI SUBMITTED", value: (s) => s.fsiSubmittedAt, width: 14 },
  { header: "PRE-ADVISE SENT", value: (s) => s.preadviseSentAt, width: 14 },
  { header: "DECLARATION STATUS", value: (s) => s.exportDeclarationStatus, width: 14 },
  { header: "BOC UPLOAD DEADLINE", value: (s) => s.bocDeadlineAt, width: 14 },
];
