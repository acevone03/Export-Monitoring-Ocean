import { prisma } from "./db";

// Single source of "now" for business logic (deadlines, alerts, milestones).
// In dev/demo (ENABLE_DEV_TOOLS=true) a simulated offset stored in the database is applied,
// so the web app and the separate scheduler process see the same simulated time.
// With dev tools off (production) the offset is ignored entirely.
// Sessions and cookies always use the real clock.

const KEY = "clock.offsetMs";

export const devToolsEnabled = () => process.env.ENABLE_DEV_TOOLS === "true";

export async function getClockOffsetMs(): Promise<number> {
  if (!devToolsEnabled()) return 0;
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } });
  const n = row ? Number(row.value) : 0;
  return Number.isFinite(n) ? n : 0;
}

export async function setClockOffsetMs(offsetMs: number): Promise<void> {
  if (!devToolsEnabled()) throw new Error("Dev tools are disabled");
  await prisma.appSetting.upsert({
    where: { key: KEY },
    create: { key: KEY, value: String(Math.round(offsetMs)) },
    update: { value: String(Math.round(offsetMs)) },
  });
}

export async function now(): Promise<Date> {
  return new Date(Date.now() + (await getClockOffsetMs()));
}
