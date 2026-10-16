import type { Shipment } from "@prisma/client";
import { STATUS_LABEL } from "./status";

// [ASSUMPTION] Raw-data columns for Excel exports, meant to mirror the current monitoring
// spreadsheet "exactly" (spec 10.3). The real headers have not been provided yet: this list
// is the one place to rename or reorder them. Dates are exported as real Excel dates.

export type ExportShipment = Shipment & { shipper: { name: string }; assignedCs: { name: string } };
export type CellValue = string | number | Date | null;

const cargoText = (s: ExportShipment) => {
  if (s.cargoType === "LCL") return `LCL ${s.lclQty ?? ""} ${s.lclUnit === "BOX" ? "BOX" : "PALLET"}`.trim();
  const plan = (s.containerPlan as Array<{ size: string; qty: number }> | null) ?? [];
  return `FCL ${plan.map((c) => `${c.qty}x${c.size}`).join(" + ")}`;
};

export const RAW_COLUMNS: Array<{ header: string; value: (s: ExportShipment) => CellValue; width?: number }> = [
  { header: "Job No.", value: (s) => s.jobNo, width: 16 },
  { header: "HBL No.", value: (s) => s.hblNo, width: 14 },
  { header: "Shipper", value: (s) => s.shipper.name, width: 30 },
  { header: "Consignee", value: (s) => s.consigneeName, width: 24 },
  { header: "Destination", value: (s) => s.destinationPort, width: 20 },
  { header: "POD", value: (s) => s.pod, width: 20 },
  { header: "Cargo", value: cargoText, width: 18 },
  { header: "Carrier", value: (s) => s.carrierName, width: 16 },
  { header: "Carrier Booking Ref", value: (s) => s.carrierBookingRef, width: 18 },
  { header: "Requested Pick-up", value: (s) => s.requestedPickupAt },
  { header: "Actual Pick-up", value: (s) => s.actualPickupAt },
  { header: "FSI Cut-off", value: (s) => s.fsiCutoffAt },
  { header: "FSI Submitted", value: (s) => s.fsiSubmittedAt },
  { header: "Pre-advise Cut-off", value: (s) => s.preadviseCutoffAt },
  { header: "Pre-advise Sent", value: (s) => s.preadviseSentAt },
  { header: "Export Declaration", value: (s) => s.exportDeclarationStatus, width: 14 },
  { header: "BOC Upload Deadline", value: (s) => s.bocDeadlineAt },
  { header: "BOC Uploaded", value: (s) => s.bocUploadAt },
  { header: "Arrastre By", value: (s) => (s.arrastreResponsibility === "NNR" ? "NNR" : "SHIPPER"), width: 10 },
  { header: "Arrastre Deadline", value: (s) => (s.arrastreResponsibility === "NNR" ? s.arrastreDeadlineAt : null) },
  { header: "Arrastre Paid", value: (s) => s.arrastrePaidAt },
  { header: "Export Docs Sent", value: (s) => s.exportDocsSentAt },
  { header: "ETD MNL", value: (s) => s.etdMnl },
  { header: "ATD MNL", value: (s) => s.atdMnl },
  { header: "ETA", value: (s) => s.eta },
  { header: "ATA", value: (s) => s.ata },
  { header: "Status", value: (s) => STATUS_LABEL[s.status], width: 16 },
  { header: "Assigned CS", value: (s) => s.assignedCs.name, width: 16 },
  { header: "Carrier Remarks", value: (s) => s.carrierRemarks, width: 30 },
];
