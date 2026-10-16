"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";

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
  try {
    await prisma.shipper.create({ data: parsed.data });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { error: "A shipper with that name already exists." };
    throw e;
  }
  revalidatePath("/shippers");
  return { ok: `Added ${parsed.data.name}` };
}
