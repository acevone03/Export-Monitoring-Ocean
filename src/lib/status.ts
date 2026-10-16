import type { ShipmentStatus, DeclarationStatus, ArrastreResponsibility } from "@prisma/client";

// Status is derived, never typed in. The furthest completed step wins, so a step
// confirmed out of order (e.g. BOC upload before pre-advise) still moves the status forward.
export type StatusInput = {
  requestedPickupAt: Date | null;
  actualPickupAt: Date | null;
  fsiSubmittedAt: Date | null;
  preadviseSentAt: Date | null;
  exportDeclarationStatus: DeclarationStatus;
  bocUploadAt: Date | null;
  arrastreResponsibility: ArrastreResponsibility;
  arrastrePaidAt: Date | null;
  exportDocsSentAt: Date | null;
  atdMnl: Date | null;
  eta: Date | null;
  ata: Date | null;
  closedAt: Date | null;
  cancelledAt: Date | null;
};

export const STATUS_ORDER: ShipmentStatus[] = [
  "BOOKED",
  "PICKUP_SCHEDULED",
  "PICKED_UP",
  "FSI_DONE",
  "PREADVISED",
  "DECLARED",
  "BOC_UPLOADED",
  "ARRASTRE_PAID",
  "DOCS_SENT",
  "DEPARTED",
  "ARRIVED",
  "CLOSED",
];

export function deriveStatus(s: StatusInput, now: Date): ShipmentStatus {
  if (s.cancelledAt) return "CANCELLED";
  if (s.closedAt) return "CLOSED";
  // Arrived = actual arrival recorded, or departed and ETA has passed.
  if (s.ata || (s.atdMnl && s.eta && s.eta <= now)) return "ARRIVED";
  if (s.atdMnl) return "DEPARTED";
  if (s.exportDocsSentAt) return "DOCS_SENT";
  if (s.arrastreResponsibility === "NNR" && s.arrastrePaidAt) return "ARRASTRE_PAID";
  if (s.bocUploadAt) return "BOC_UPLOADED";
  if (s.exportDeclarationStatus !== "PENDING") return "DECLARED";
  if (s.preadviseSentAt) return "PREADVISED";
  if (s.fsiSubmittedAt) return "FSI_DONE";
  if (s.actualPickupAt) return "PICKED_UP";
  if (s.requestedPickupAt) return "PICKUP_SCHEDULED";
  return "BOOKED";
}

export const STATUS_LABEL: Record<ShipmentStatus, string> = {
  BOOKED: "Booked",
  PICKUP_SCHEDULED: "Pick-up scheduled",
  PICKED_UP: "Picked up",
  FSI_DONE: "FSI submitted",
  PREADVISED: "Pre-advised",
  DECLARED: "Declared",
  BOC_UPLOADED: "BOC uploaded",
  ARRASTRE_PAID: "Arrastre paid",
  DOCS_SENT: "Docs sent",
  DEPARTED: "Departed",
  ARRIVED: "Arrived",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};
