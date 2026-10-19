import type { ArrastreResponsibility, Prisma, PrismaClient, Shipper } from "@prisma/client";
import { nextSequence } from "./numbering";
import { normalizeName } from "./intake/to-form";

// The only module that creates shippers. Every shipper gets a permanent code (SHP-0001, …)
// from its own counter, and a name that does not repeat an existing shipper.

type Tx = PrismaClient | Prisma.TransactionClient;

export const SHIPPER_COUNTER_KEY = "SHIPPER";
const CODE_PREFIX = "SHP-";
export const SHIPPER_CODE_RE = /^SHP-\d{4,}$/i;

export const formatShipperCode = (seq: number) => `${CODE_PREFIX}${String(seq).padStart(4, "0")}`;

/**
 * Name key that ignores case, spacing, punctuation and Inc/Corp/Co/Ltd/Phils:
 * "FOODFLOW INC" and "Food Flow, Inc." are the same shipper. Used by the import too.
 */
export const shipperKey = (name: string) => normalizeName(name).replace(/[^a-z0-9]/g, "");

/** A shipper the user tried to add again. Message is safe to show in the UI. */
export class DuplicateShipperError extends Error {
  constructor(public readonly existing: Pick<Shipper, "id" | "code" | "name">) {
    super(`This shipper already exists as ${existing.code} · ${existing.name}.`);
  }
}

export async function findSameShipper(db: Tx, name: string): Promise<Pick<Shipper, "id" | "code" | "name"> | null> {
  const key = shipperKey(name);
  if (!key) return null;
  // Shipper lists are small (hundreds), so comparing keys in memory is simpler than a stored key column.
  const all = await db.shipper.findMany({ select: { id: true, code: true, name: true } });
  return all.find((s) => shipperKey(s.name) === key) ?? null;
}

export type NewShipper = {
  name: string;
  contactPerson?: string | null;
  email?: string | null;
  phone?: string | null;
  defaultPickupAddress?: string | null;
  defaultArrastre?: ArrastreResponsibility;
};

/** Creates a shipper with the next code. Throws DuplicateShipperError if the name already exists. */
export async function createShipper(db: PrismaClient, data: NewShipper): Promise<Shipper> {
  if (!shipperKey(data.name)) throw new Error("Shipper name is required");
  return db.$transaction(async (tx) => {
    // Counter first: the UPDATE takes the write lock up front, so two people adding the same
    // shipper at once are serialized and the second one sees the first (see numbering.ts).
    const code = formatShipperCode(await nextSequence(tx, SHIPPER_COUNTER_KEY));
    const same = await findSameShipper(tx, data.name);
    if (same) throw new DuplicateShipperError(same); // rolls the counter back too
    return tx.shipper.create({ data: { ...data, name: data.name.trim().replace(/\s+/g, " "), code } });
  });
}

/** The existing shipper with this name (ignoring case/punctuation/Inc), or a new one. Used by the import. */
export async function findOrCreateShipper(db: PrismaClient, name: string): Promise<Pick<Shipper, "id" | "code" | "name">> {
  try {
    return await createShipper(db, { name });
  } catch (e) {
    if (e instanceof DuplicateShipperError) return e.existing;
    throw e;
  }
}
