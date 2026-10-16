import type { Role } from "@prisma/client";

// Who may see which shipment (spec section 4: only supervisors "view all shipments").
// CS see shipments assigned to them or that they created. Field staff use magic links only.
type U = { id: string; role: Role };
type S = { assignedCsId: string; createdById: string };

export function canAccessShipment(u: U, s: S): boolean {
  if (u.role === "SUPERVISOR") return true;
  if (u.role === "CS") return s.assignedCsId === u.id || s.createdById === u.id;
  return false;
}

/** Same rule as a Prisma `where` fragment, for lists. */
export function shipmentScope(u: U) {
  if (u.role === "SUPERVISOR") return {};
  if (u.role === "CS") return { OR: [{ assignedCsId: u.id }, { createdById: u.id }] };
  return { id: "__none__" };
}
