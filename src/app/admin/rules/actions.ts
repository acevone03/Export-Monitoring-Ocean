"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { now } from "@/lib/clock";
import { RULE_BASE_FIELDS } from "@/lib/deadlines";
import { recomputeOpenDeadlines } from "@/lib/shipments";

export type RuleState = { ok?: string; error?: string };

// Only the computed deadlines (BOC upload, arrastre) have an editable base field and offset.
// Pick-up, FSI and pre-advise are due at the time CS enters; only their alert timing is editable.
const COMPUTED = ["BOC_UPLOAD", "ARRASTRE"] as const;

const hoursList = z
  .string()
  .transform((v) => v.split(",").map((x) => x.trim()).filter(Boolean).map(Number))
  .pipe(z.array(z.number("Reminder hours must be numbers").positive("Reminder hours must be above 0").max(168, "Reminders up to 168h (7 days) before")).max(6, "At most 6 reminders"));

const RuleForm = z.object({
  deadlineType: z.enum(["PICKUP", "FSI", "PREADVISE", "BOC_UPLOAD", "ARRASTRE"]),
  enabled: z.string().optional().transform((v) => v === "on"),
  baseField: z.enum(RULE_BASE_FIELDS).optional(),
  offsetHours: z.coerce.number().min(-720).max(720).optional(),
  reminderHours: hoursList,
  overdueRepeatHours: z.coerce.number().min(0).max(24),
  overdueMaxPerDay: z.coerce.number().int().min(0).max(24),
});

export async function saveRuleAction(_p: RuleState, form: FormData): Promise<RuleState> {
  await requireUser(["SUPERVISOR"]);
  const p = RuleForm.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const r = p.data;
  const computed = (COMPUTED as readonly string[]).includes(r.deadlineType);
  await prisma.deadlineRule.update({
    where: { deadlineType: r.deadlineType },
    data: {
      enabled: r.enabled,
      ...(computed && r.baseField && r.offsetHours !== undefined
        ? { baseField: r.baseField, offsetMinutes: Math.round(r.offsetHours * 60) }
        : {}),
      reminderOffsets: [...new Set(r.reminderHours.map((h) => Math.round(h * 60)))].sort((a, b) => b - a),
      overdueRepeatMinutes: Math.round(r.overdueRepeatHours * 60),
      overdueMaxPerDay: r.overdueMaxPerDay,
    },
  });
  const changed = await recomputeOpenDeadlines(prisma, await now());
  revalidatePath("/admin/rules");
  return { ok: `Saved. Deadlines recomputed on ${changed} open shipment${changed === 1 ? "" : "s"}.` };
}
