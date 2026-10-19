import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { ShipmentInput } from "@/lib/shipment-input";
import { createShipper } from "@/lib/shippers";

export const prisma = new PrismaClient();

/** Fresh CS user, supervisor and shipper for one test file. */
export async function fixtures() {
  const tag = randomUUID().slice(0, 8);
  const cs = await prisma.user.create({ data: { name: "CS", email: `cs-${tag}@t.test`, passwordHash: "x", role: "CS" } });
  const sup = await prisma.user.create({ data: { name: "Sup", email: `sup-${tag}@t.test`, passwordHash: "x", role: "SUPERVISOR" } });
  const field = await prisma.user.create({ data: { name: "Field", email: `f-${tag}@t.test`, passwordHash: "x", role: "FIELD" } });
  const shipper = await createShipper(prisma, { name: `Shipper ${tag}` });
  return { cs, sup, field, shipper };
}

export function input(o: Partial<ShipmentInput> & Pick<ShipmentInput, "shipperId" | "assignedCsId">): ShipmentInput {
  return {
    consigneeName: null,
    pickupAddress: null,
    destinationPort: "USLAX Los Angeles",
    pod: "USLGB Long Beach",
    cargoType: "FCL",
    containerPlan: [{ size: "40HC", qty: 2 }],
    lclQty: null,
    lclUnit: null,
    requestedPickupAt: null,
    fsiCutoffAt: null,
    preadviseCutoffAt: null,
    etdMnl: null,
    eta: null,
    arrastreResponsibility: "NNR",
    carrierName: "Maersk",
    carrierBookingRef: null,
    carrierRemarks: null,
    arrastreCutoffAt: null,
    podCode: "LAX",
    declarationBy: "NNR",
    declarationForwarder: null,
    partOfHblNo: null,
    positioningAt: null,
    containerYard: null,
    portOfLoading: null,
    cyCutoffAt: null,
    consolidator: null,
    grossWeightKg: null,
    cbm: null,
    cargoDescription: null,
    cargoDimensions: null,
    deliveryWarehouse: null,
    pickupRemarks: null,
    ...o,
  };
}
