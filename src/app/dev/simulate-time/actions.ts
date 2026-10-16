"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getClockOffsetMs, now, setClockOffsetMs } from "@/lib/clock";
import { runAlertTick } from "@/lib/alerts";
import { defaultNotifiers } from "@/lib/notify";
import { parseManilaInput, formatDateTime } from "@/lib/time";
import { requireDevTools } from "../guard";

export type SimState = { ok?: string; error?: string };

const Form = z.object({
  op: z.enum(["add", "set", "reset", "tick"]),
  minutes: z.coerce.number().int().optional(),
  at: z.string().optional(),
  tick: z.string().optional(), // checkbox: run the alert check right after moving the clock
});

export async function simulateAction(_p: SimState, form: FormData): Promise<SimState> {
  await requireDevTools();
  const p = Form.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Invalid request." };
  const { op, minutes, at, tick } = p.data;

  if (op === "add") {
    if (!minutes) return { error: "Invalid step." };
    await setClockOffsetMs((await getClockOffsetMs()) + minutes * 60_000);
  } else if (op === "set") {
    const target = at ? parseManilaInput(at) : null;
    if (!target) return { error: "Pick a date and time." };
    await setClockOffsetMs(target.getTime() - Date.now());
  } else if (op === "reset") {
    await setClockOffsetMs(0);
  }

  let msg = `Clock is now ${formatDateTime(await now())}.`;
  if (op === "tick" || tick) {
    const r = await runAlertTick(prisma, await now(), defaultNotifiers(prisma));
    msg += ` Alert check: ${r.created} new alert(s), ${r.delivered} delivered, ${r.resolved} resolved.`;
  }
  revalidatePath("/", "layout");
  return { ok: msg };
}
