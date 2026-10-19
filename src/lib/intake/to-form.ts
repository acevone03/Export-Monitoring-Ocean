import type { ShipmentFormValues } from "@/components/ShipmentForm";
import type { Extraction } from "./extract";
import { podCodeFor } from "../pod-codes";

// Turns a Claude extraction into prefilled form values plus per-field review flags.
// Everything flagged is highlighted on the review screen; nothing is saved until CS confirms.

export type ShipperRef = { id: string; name: string; defaultArrastre: "NNR" | "SHIPPER" };
export type ReviewFlags = Partial<Record<keyof ShipmentFormValues, string>>;

const SUFFIX = /\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|opc|phils?|philippines)\b/g;
export const normalizeName = (s: string) => s.toLowerCase().replace(/[.,&'"()-]/g, " ").replace(SUFFIX, " ").replace(/\s+/g, " ").trim();

/** Exact (normalized) match first, then a single containment match. Never guesses between several. */
export function matchShipper(name: string | null, shippers: ShipperRef[]): { shipper: ShipperRef | null; exact: boolean } {
  if (!name) return { shipper: null, exact: false };
  const n = normalizeName(name);
  if (!n) return { shipper: null, exact: false };
  const exact = shippers.find((s) => normalizeName(s.name) === n);
  if (exact) return { shipper: exact, exact: true };
  const partial = shippers.filter((s) => {
    const m = normalizeName(s.name);
    return m.length >= 3 && (m.includes(n) || n.includes(m));
  });
  return partial.length === 1 ? { shipper: partial[0], exact: false } : { shipper: null, exact: false };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DEFAULT_PICKUP_TIME = "08:00";

export function extractionToForm(
  x: Extraction,
  shippers: ShipperRef[],
  assignedCsId: string,
): { values: ShipmentFormValues; flags: ReviewFlags; shipperNameFromEmail: string | null } {
  const flags: ReviewFlags = {};
  const low = (c: string) => c !== "high";

  // Shipper
  const { shipper, exact } = matchShipper(x.shipper_name, shippers);
  if (!x.shipper_name) flags.shipperId = "No shipper found in the email. Pick one.";
  else if (!shipper) flags.shipperId = `"${x.shipper_name}" is not in the shipper list. Pick the right one or add it under Shippers.`;
  else if (!exact) flags.shipperId = `Matched "${x.shipper_name}" to ${shipper.name}. Check.`;
  else if (low(x.confidence.shipper)) flags.shipperId = "Shipper was not stated clearly. Check.";

  // Destination / POD
  const destination = x.destination?.trim() ?? "";
  if (!destination) flags.destinationPort = "No destination found in the email.";
  else if (low(x.confidence.destination)) flags.destinationPort = "Destination was interpreted. Check.";
  if (destination) flags.pod = "Assumed same as destination. Change if it discharges elsewhere.";
  if (destination && !podCodeFor(destination)) flags.podCode = "No HBL code known for this destination. Enter the 3-letter code.";

  // Cargo
  const merged = new Map<"20" | "40" | "40HC", number>();
  for (const c of x.containers) if (c.qty > 0) merged.set(c.size, (merged.get(c.size) ?? 0) + c.qty);
  const containerPlan = [...merged.entries()].map(([size, qty]) => ({ size, qty }));
  const cargoType: "FCL" | "LCL" = x.cargo_type ?? (x.lcl_qty ? "LCL" : "FCL");
  if (!x.cargo_type) flags.cargoType = "Cargo type not stated. Check.";
  else if (low(x.confidence.cargo)) flags.cargoType = "Cargo details were interpreted. Check.";
  if (cargoType === "FCL" && containerPlan.length === 0) flags.containerPlan = "No container sizes found. Enter them.";
  if (cargoType === "LCL" && (!x.lcl_qty || !x.lcl_unit)) flags.lclQty = "LCL quantity or unit missing. Enter them.";

  // Pick-up date
  let requestedPickupAt = "";
  const date = x.requested_pickup_date && DATE.test(x.requested_pickup_date) ? x.requested_pickup_date : null;
  const time = x.requested_pickup_time && TIME.test(x.requested_pickup_time) ? x.requested_pickup_time : null;
  if (date) {
    requestedPickupAt = `${date}T${time ?? DEFAULT_PICKUP_TIME}`;
    const reasons: string[] = [];
    if (x.pickup_date_needs_review || low(x.confidence.pickup)) reasons.push(`date may be ambiguous${x.pickup_date_source_text ? ` (email says "${x.pickup_date_source_text}")` : ""}`);
    if (!time) reasons.push(`no time given, ${DEFAULT_PICKUP_TIME} assumed`);
    if (reasons.length) flags.requestedPickupAt = `Check: ${reasons.join("; ")}.`;
  } else {
    flags.requestedPickupAt = x.requested_pickup_date ? `Could not read the date "${x.requested_pickup_date}". Enter it.` : "No pick-up date in the email.";
  }

  return {
    shipperNameFromEmail: x.shipper_name,
    flags,
    values: {
      shipperId: shipper?.id ?? "",
      consigneeName: "",
      pickupAddress: "", // the form fills it from the matched shipper
      destinationPort: destination,
      pod: destination,
      cargoType,
      containerPlan: cargoType === "FCL" ? containerPlan : [],
      lclQty: cargoType === "LCL" && x.lcl_qty ? String(x.lcl_qty) : "",
      lclUnit: cargoType === "LCL" && x.lcl_unit ? x.lcl_unit : "",
      requestedPickupAt,
      fsiCutoffAt: "",
      preadviseCutoffAt: "",
      etdMnl: "",
      eta: "",
      arrastreResponsibility: shipper?.defaultArrastre ?? "NNR",
      carrierName: "",
      carrierBookingRef: "",
      carrierRemarks: x.remarks?.trim().slice(0, 2000) ?? "",
      assignedCsId,
      arrastreCutoffAt: "",
      podCode: podCodeFor(destination) ?? "",
      declarationBy: "NNR",
      declarationForwarder: "",
      partOfHblNo: "",
      positioningAt: "", containerYard: "", portOfLoading: "", cyCutoffAt: "", consolidator: "", grossWeightKg: "", cbm: "",
      cargoDescription: "", cargoDimensions: "", deliveryWarehouse: "", pickupRemarks: "",
    },
  };
}
