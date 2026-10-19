// Removes all shipments and shippers (e.g. the demo data from `npm run setup`) so reports start empty.
//
//   npm run clear-data
//
// Keeps: users and passwords, deadline rules, transport emails and other settings.
// Removes: shipments with their timeline, alerts, notifications, field links, email intakes and
//          attachment records; all shippers; demo customer accounts; Job/HBL/shipper counters.
// A backup copy of the database is saved first (prisma/backup-YYYYMMDD-HHMM.db).
// Demo logins (@nnr.test) are switched off only if another active supervisor exists.

import { createInterface } from "node:readline/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DEMO_EMAIL = /@nnr\.test$/i;

async function confirm(): Promise<boolean> {
  if (process.argv.includes("--yes")) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('\nThis deletes ALL shipments and shippers. Type DELETE to continue: ');
  rl.close();
  return answer.trim() === "DELETE";
}

function backupPath(): string {
  const d = new Date(Date.now() + 8 * 3_600_000).toISOString(); // Manila time for the file name
  const stamp = `${d.slice(0, 10).replace(/-/g, "")}-${d.slice(11, 16).replace(":", "")}`;
  return path.resolve("prisma", `backup-${stamp}.db`);
}

async function main() {
  const [shipments, shippers] = await Promise.all([prisma.shipment.count(), prisma.shipper.count()]);
  console.log(`Found ${shipments} shipment(s) and ${shippers} shipper(s).`);
  if (shipments === 0 && shippers === 0) {
    console.log("Nothing to delete.");
    return;
  }
  if (!(await confirm())) {
    console.log("Cancelled. Nothing was changed.");
    return;
  }

  // Safe copy even while the app is running (SQLite writes a consistent snapshot).
  const backup = backupPath();
  await prisma.$executeRawUnsafe(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  console.log(`Backup saved: ${backup}`);

  await prisma.$transaction(async (tx) => {
    await tx.notification.deleteMany({});
    await tx.alert.deleteMany({});
    await tx.fieldLink.deleteMany({});
    await tx.milestoneEvent.deleteMany({});
    await tx.emailIntake.deleteMany({});
    await tx.shipment.updateMany({ data: { arrastreProofId: null } }); // shipment <-> attachment link
    await tx.attachment.deleteMany({});
    await tx.shipment.deleteMany({});
    // Customer accounts belong to a shipper (demo only in the MVP).
    await tx.user.deleteMany({ where: { role: "CUSTOMER" } });
    await tx.user.updateMany({ data: { shipperId: null } });
    await tx.shipper.deleteMany({});
    // Numbering starts again: Job No. from 0001, HBL from HBL_START_AFTER + 1, shippers from SHP-0001.
    await tx.numberSequence.deleteMany({});
  });
  console.log(`Deleted ${shipments} shipment(s) and ${shippers} shipper(s).`);

  const realSupervisors = await prisma.user.count({ where: { role: "SUPERVISOR", active: true, NOT: { email: { endsWith: "@nnr.test" } } } });
  const demo = await prisma.user.findMany({ where: { active: true }, select: { id: true, email: true } });
  const demoIds = demo.filter((u) => DEMO_EMAIL.test(u.email)).map((u) => u.id);
  if (demoIds.length && realSupervisors > 0) {
    await prisma.user.updateMany({ where: { id: { in: demoIds } }, data: { active: false } });
    console.log(`Switched off ${demoIds.length} demo login(s) (@nnr.test).`);
  } else if (demoIds.length) {
    console.log("Demo logins (@nnr.test) are still active: add your own supervisor under Users, then run this again or switch them off there.");
  }

  const start = Number(process.env.HBL_START_AFTER ?? 0) + 1;
  console.log(`Done. Next HBL running number: ${start} (set HBL_START_AFTER in .env to change). Uploaded files in the "uploads" folder can be deleted by hand.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
