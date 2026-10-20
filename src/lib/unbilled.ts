import type { Prisma } from "@prisma/client";

/**
 * Shipments not yet billed to the customer: no "Billing invoice to customer" step recorded.
 * Cancelled shipments and old spreadsheet history are left out.
 */
export const UNBILLED_WHERE: Prisma.ShipmentWhereInput = { invoicedAt: null, status: { not: "CANCELLED" }, importedAsHistory: false };

/** Departed but not billed: what the menu badge counts. */
export const DEPARTED_UNBILLED_WHERE: Prisma.ShipmentWhereInput = { ...UNBILLED_WHERE, atdMnl: { not: null } };
