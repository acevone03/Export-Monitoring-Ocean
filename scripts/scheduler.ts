// Background scheduler, run as its own process: `npm run scheduler`.
// Every 5 minutes it runs the deadline alert engine, and sends the daily report once a day after
// 07:30 Manila. `npm run tick` runs one tick and exits.
// Uses the shared clock, so /dev/simulate-time affects it too (dev only).

import cron from "node-cron";
import { prisma } from "../src/lib/db";
import { now } from "../src/lib/clock";
import { runAlertTick } from "../src/lib/alerts";
import { defaultNotifiers } from "../src/lib/notify";
import { formatDateTime } from "../src/lib/time";
import { runDailyReportIfDue } from "../src/lib/reports/deliver";

let running = false;

async function alertTick() {
  if (running) return; // previous tick still going; skip rather than overlap
  running = true;
  try {
    const t = await now();
    const r = await runAlertTick(prisma, t, defaultNotifiers(prisma));
    console.log(`[alerts ${formatDateTime(t)}] resolved=${r.resolved} created=${r.created} delivered=${r.delivered} flags=${r.flagsChanged}`);
  } catch (e) {
    console.error("[alerts] tick failed:", e);
  }
  try {
    // Daily report at 07:30 Manila (spec 10.2); sent once per day, checked every tick.
    const t = await now();
    const d = await runDailyReportIfDue(prisma, t);
    if (d) console.log(`[daily report ${formatDateTime(t)}] sent ${d.sent} email(s)`);
  } catch (e) {
    console.error("[daily report] failed:", e);
  } finally {
    running = false;
  }
}

async function main() {
  if (process.argv.includes("--once")) {
    await alertTick();
    await prisma.$disconnect();
    return;
  }
  cron.schedule("*/5 * * * *", alertTick, { timezone: "Asia/Manila" });
  console.log("Scheduler started: alerts every 5 minutes; daily report after 07:30 (Asia/Manila).");
  await alertTick();
}

main();
