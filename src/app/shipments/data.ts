import "server-only";
import type { Shipment } from "@prisma/client";
import { prisma } from "@/lib/db";
import { COMMON_PORTS } from "@/lib/ports";
import { toManilaInput } from "@/lib/time";
import type { ShipmentFormValues } from "@/components/ShipmentForm";

export async function formOptions() {
  const [shippers, csUsers, used] = await Promise.all([
    prisma.shipper.findMany({ orderBy: { name: "asc" }, select: { id: true, code: true, name: true, contactPerson: true, phone: true, email: true, defaultPickupAddress: true, defaultArrastre: true } }),
    prisma.user.findMany({ where: { active: true, role: { in: ["CS", "SUPERVISOR"] } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.shipment.findMany({ distinct: ["destinationPort"], select: { destinationPort: true, pod: true } }),
  ]);
  const destinations = [...new Set([...COMMON_PORTS, ...used.flatMap((u) => [u.destinationPort, u.pod])])].sort();
  return { shippers, csUsers, destinations };
}

export function toFormValues(s: Shipment): ShipmentFormValues {
  return {
    shipperId: s.shipperId,
    consigneeName: s.consigneeName ?? "",
    pickupAddress: s.pickupAddress ?? "",
    destinationPort: s.destinationPort,
    pod: s.pod,
    cargoType: s.cargoType,
    containerPlan: (s.containerPlan as ShipmentFormValues["containerPlan"] | null) ?? [],
    lclQty: s.lclQty?.toString() ?? "",
    lclUnit: s.lclUnit ?? "",
    requestedPickupAt: toManilaInput(s.requestedPickupAt),
    fsiCutoffAt: toManilaInput(s.fsiCutoffAt),
    preadviseCutoffAt: toManilaInput(s.preadviseCutoffAt),
    etdMnl: toManilaInput(s.etdMnl),
    eta: toManilaInput(s.eta),
    arrastreResponsibility: s.arrastreResponsibility,
    carrierName: s.carrierName ?? "",
    carrierBookingRef: s.carrierBookingRef ?? "",
    carrierRemarks: s.carrierRemarks ?? "",
    assignedCsId: s.assignedCsId,
    arrastreCutoffAt: toManilaInput(s.arrastreCutoffAt),
    podCode: s.podCode ?? "",
    declarationBy: s.declarationBy,
    declarationForwarder: s.declarationForwarder ?? "",
    partOfHblNo: s.partOfHblNo ?? "",
    positioningAt: toManilaInput(s.positioningAt),
    containerYard: s.containerYard ?? "",
    portOfLoading: s.portOfLoading ?? "",
    cyCutoffAt: toManilaInput(s.cyCutoffAt).slice(0, 10),
    consolidator: s.consolidator ?? "",
    grossWeightKg: s.grossWeightKg?.toString() ?? "",
    cbm: s.cbm?.toString() ?? "",
    cargoDescription: s.cargoDescription ?? "",
    cargoDimensions: s.cargoDimensions ?? "",
    deliveryWarehouse: s.deliveryWarehouse ?? "",
    pickupRemarks: s.pickupRemarks ?? "",
  };
}

export const formValuesOf = (form: FormData) =>
  Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) as Record<string, string>;
