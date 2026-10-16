import type { Shipment } from "@prisma/client";

// "Missing mandatory data" (daily report section 6, board warnings).
// A field is only demanded while it can still matter: nothing is missing on a
// cancelled or closed shipment, and nothing pre-departure is missing after ATD.
type Check = Pick<
  Shipment,
  | "status" | "requestedPickupAt" | "etdMnl" | "carrierName" | "carrierBookingRef" | "fsiCutoffAt" | "preadviseCutoffAt" | "atdMnl" | "eta"
  | "arrastreResponsibility" | "arrastreCutoffAt"
>;

export function missingMandatory(s: Check): string[] {
  if (s.status === "CANCELLED" || s.status === "CLOSED") return [];
  const missing: string[] = [];
  if (!s.atdMnl) {
    if (!s.requestedPickupAt) missing.push("Requested pick-up");
    if (!s.etdMnl) missing.push("ETD MNL");
    if (!s.carrierName) missing.push("Carrier");
    if (!s.carrierBookingRef) missing.push("Carrier booking ref");
    if (!s.fsiCutoffAt) missing.push("FSI cut-off");
    if (!s.preadviseCutoffAt) missing.push("Pre-advise cut-off");
    if (s.arrastreResponsibility === "NNR" && !s.arrastreCutoffAt) missing.push("Arrastre cut-off");
  } else if (!s.eta) {
    missing.push("ETA");
  }
  return missing;
}
