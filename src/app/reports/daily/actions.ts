"use server";

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { now } from "@/lib/clock";
import { sendDailyReports } from "@/lib/reports/deliver";

export type SendState = { ok?: string; error?: string };

/** On-demand send (spec: "and on demand"). Does not affect the automatic 07:30 send. */
export async function sendDailyNowAction(): Promise<SendState> {
  await requireUser(["SUPERVISOR"]);
  const sent = await sendDailyReports(prisma, await now());
  return { ok: `Daily report emailed to ${sent} people (supervisors: full report; CS: their own shipments).` };
}
