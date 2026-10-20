"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { createShipper, DuplicateShipperError } from "@/lib/shippers";

const opt = (max: number) => z.string().trim().max(max).transform((v) => v || null);
const ShipperSchema = z.object({
  name: z.string().trim().min(2, "Shipper name is required").max(200),
  contactPerson: opt(100),
  email: z.string().trim().max(200).refine((v) => !v || z.string().email().safeParse(v).success, "Enter a valid email").transform((v) => v || null),
  phone: opt(50),
  defaultPickupAddress: opt(300),
  defaultArrastre: z.enum(["NNR", "SHIPPER"]),
});

export type ShipperState = { ok?: string; error?: string };

export async function createShipperAction(_prev: ShipperState, form: FormData): Promise<ShipperState> {
  await requireUser(["CS", "SUPERVISOR"]);
  const parsed = ShipperSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  let code: string;
  try {
    code = (await createShipper(prisma, parsed.data)).code;
  } catch (e) {
    // Also catches names that differ only in case, punctuation or Inc/Corp ("ABC Corp." vs "abc corporation").
    if (e instanceof DuplicateShipperError) return { error: e.message };
    throw e;
  }
  revalidatePath("/shippers");
  revalidatePath("/shipments/new");
  return { ok: `Added ${code} · ${parsed.data.name}` };
}
