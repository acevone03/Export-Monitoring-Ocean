"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { DEFAULT_CARRIERS, setCarrierLinks, type CarrierLink } from "@/lib/tracking";

export type CarrierState = { ok?: string; error?: string };

export async function saveCarriersAction(_prev: CarrierState, form: FormData): Promise<CarrierState> {
  await requireUser(["CS", "SUPERVISOR"]);
  const count = Number(form.get("count") ?? 0);
  const list: CarrierLink[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < count && i < 100; i++) {
    const name = String(form.get(`name_${i}`) ?? "").trim();
    const url = String(form.get(`url_${i}`) ?? "").trim();
    const aliases = String(form.get(`aliases_${i}`) ?? "").split(",").map((a) => a.trim().toUpperCase()).filter(Boolean);
    if (!name && !url) continue; // empty row
    if (!name) return { error: `Row ${i + 1}: enter the shipping line name.` };
    if (!/^https:\/\/[^\s]+$/.test(url)) return { error: `${name}: the tracking link must start with https://` };
    if (seen.has(name.toUpperCase())) return { error: `${name} is listed twice.` };
    seen.add(name.toUpperCase());
    list.push({ name: name.slice(0, 60), aliases: aliases.slice(0, 10), url: url.slice(0, 500) });
  }
  await setCarrierLinks(prisma, list);
  revalidatePath("/carriers");
  revalidatePath("/");
  return { ok: `Saved ${list.length} shipping line${list.length === 1 ? "" : "s"}.` };
}

export async function resetCarriersAction(_prev: CarrierState): Promise<CarrierState> {
  await requireUser(["SUPERVISOR"]);
  await setCarrierLinks(prisma, DEFAULT_CARRIERS);
  revalidatePath("/carriers");
  return { ok: "Restored the default list." };
}
