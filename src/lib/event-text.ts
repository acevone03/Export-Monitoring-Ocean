import type { MilestoneEvent } from "@prisma/client";
import { formatDateTime } from "./time";
import { containerPlanText } from "./containers";

// Human-readable line for the shipment timeline.
const FIELD_LABEL: Record<string, string> = {
  shipperId: "Shipper", consigneeName: "Consignee", pickupAddress: "Pick-up address", destinationPort: "Destination", pod: "POD",
  cargoType: "Cargo type", containerPlan: "Containers", lclQty: "LCL qty", lclUnit: "LCL unit",
  requestedPickupAt: "Requested pick-up", fsiCutoffAt: "FSI cut-off", preadviseCutoffAt: "Pre-advise cut-off",
  etdMnl: "ETD MNL", eta: "ETA", arrastreResponsibility: "Arrastre", carrierName: "Carrier",
  carrierBookingRef: "Booking no.", carrierRemarks: "Remarks", assignedCsId: "Assigned CS",
  arrastreCutoffAt: "Arrastre cut-off", podCode: "HBL destination code", declarationBy: "Declaration c/o",
  declarationForwarder: "Declaration via forwarder", partOfHblNo: "Part of HBL",
  positioningAt: "Positioning", containerYard: "Container yard", portOfLoading: "Port of loading", cyCutoffAt: "Cut-off",
  consolidator: "Consol", grossWeightKg: "GW (kg)", cbm: "CBM", cargoDescription: "Description",
  cargoDimensions: "Cargo dimension", deliveryWarehouse: "Delivery warehouse", pickupRemarks: "Pick-up remarks",
};

const when = (iso: unknown) => (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}T/.test(iso) ? formatDateTime(new Date(iso)) : String(iso ?? "—"));
const show = (v: unknown) => {
  if (v === null || v === undefined) return "—";
  const s = typeof v === "string" ? v : String(v);
  try {
    const parsed = JSON.parse(s);
    if (typeof parsed === "string") return when(parsed);
    if (Array.isArray(parsed)) return containerPlanText(parsed, ", ");
  } catch {}
  return when(s);
};

function parse(value: string | null): any {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

const REVERT_LABEL: Record<string, string> = {
  PICKED_UP: "pick-up", FSI_SUBMITTED: "FSI submitted", PREADVISE_SENT: "pre-advise sent", BOC_UPLOADED: "BOC upload",
  ARRASTRE_PAID: "arrastre payment", DOCS_SENT: "export docs sent", DOCS_TO_OVERSEAS: "docs sent to overseas office", DEPARTED: "departure", ARRIVED: "arrival",
  CLOSED: "close", CANCELLED: "cancellation",
};

export function describeEvent(e: Pick<MilestoneEvent, "type" | "value">): string {
  const v = parse(e.value);
  switch (e.type) {
    case "CREATED": return `Shipment created (${v?.source ?? "CS"})`;
    case "NUMBERS_ASSIGNED": return `Job No. ${v.jobNo} and HBL No. ${v.hblNo} assigned`;
    case "PICKUP_SCHEDULED": return `Pick-up scheduled for ${when(v)}`;
    case "PICKED_UP": return `Picked up at ${when(v)}`;
    case "FSI_SUBMITTED": return `FSI submitted at ${when(v)}`;
    case "PREADVISE_SENT": return `Pre-advise sent at ${when(v)}`;
    case "DECLARATION_STATUS": return typeof v === "object" && v ? `Export declaration ${v.from} → ${v.to}` : `Export declaration ${v}`;
    case "BOC_UPLOADED": return `Uploaded to BOC portal at ${when(v)}`;
    case "ARRASTRE_PAID": return typeof v === "object" && v ? `Arrastre paid at ${when(v.at)}${v.proof ? ` (proof: ${v.proof})` : ""}` : "Arrastre paid";
    case "DOCS_SENT": return typeof v === "object" && v ? `Export docs sent to ${v.to}: "${v.subject}"` : "Export docs sent";
    case "DOCS_TO_OVERSEAS": return `Export docs sent to overseas office at ${when(v)}`;
    case "DEPARTED": return typeof v === "object" && v ? `Departed MNL (ATD ${when(v.atd)}${v.eta ? `, ETA ${when(v.eta)}` : ""})` : "Departed";
    case "ARRIVED": return `Arrived (ATA ${when(v)})`;
    case "CLOSED": return "Shipment closed";
    case "CANCELLED": return `Cancelled: ${v}`;
    case "HBL_EDITED": return `HBL No. changed ${v.from} → ${v.to}`;
    case "REVERTED": return `Reverted: ${REVERT_LABEL[v?.kind] ?? v?.kind} (was ${when(v?.previous)})`;
    case "IMPORTED": return `Imported from the old spreadsheet (row ${v?.row})${v?.legacyJobNo ? `, old booking no. ${v.legacyJobNo}` : ""}`;
    case "PICKUP_INSTRUCTION_SENT": return `${v?.revised ? "Revised pick-up instruction" : "Pick-up instruction"} emailed to transport (${(v?.to ?? []).join(", ")})`;
    case "PICKUP_INSTRUCTION_FAILED": return `Pick-up instruction NOT sent to ${(v?.to ?? []).join(", ")}: ${v?.error ?? "mail error"}`;
    case "NOTE": return v && typeof v === "object" && v.photo ? "Photo from field" : "Note";
    case "FIELD_CHANGED":
      return "Edited: " + Object.entries(v as Record<string, { from: unknown; to: unknown }>)
        .map(([k, c]) => `${FIELD_LABEL[k] ?? k} ${show(c.from)} → ${show(c.to)}`)
        .join("; ");
    default: return e.type;
  }
}

export const SOURCE_LABEL: Record<string, string> = {
  WEB: "Web", EMAIL: "Email intake", FIELD_LINK: "Field link", CS_ON_BEHALF: "CS on behalf of field", SYSTEM: "System", IMPORT: "Import",
};
