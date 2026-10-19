// Demo seed: 2 users per role, 5 shippers, default deadline rules, and 15 shipments
// covering every status, with several overdue / due-soon deadlines relative to *now*
// so the board shows value the moment the app starts.
//
// Run: npm run db:seed   (or `npm run setup` to reset + migrate + seed)

import { PrismaClient, Prisma, type CargoType, type ArrastreResponsibility, type DeclarationStatus } from "@prisma/client";
import { hashPassword } from "../src/lib/password";
import { nextJobNo, nextHblNo } from "../src/lib/numbering";
import { podCodeFor } from "../src/lib/pod-codes";
import { deriveStatus } from "../src/lib/status";
import { DEFAULT_RULES, computeCachedDeadlines } from "../src/lib/deadlines";
import { EVENT } from "../src/lib/milestones";
import { HOUR, DAY } from "../src/lib/time";
import { createShipper } from "../src/lib/shippers";

const prisma = new PrismaClient();
export const DEMO_PASSWORD = "nnr-demo-2026";

async function main() {
  if ((await prisma.user.count()) > 0) {
    console.log("Database already has data; seed skipped. To start over, delete prisma/dev.db and run `npm run setup`.");
    return;
  }
  const now = new Date();
  const at = (ms: number) => new Date(now.getTime() + ms);

  // ---------- Users ----------
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const userData = [
    { key: "cs1", name: "Ana Reyes", email: "cs1@nnr.test", role: "CS" },
    { key: "cs2", name: "Ben Santos", email: "cs2@nnr.test", role: "CS" },
    { key: "field1", name: "Carlo Dizon", email: "field1@nnr.test", role: "FIELD", phone: "+639170000001" },
    { key: "field2", name: "Dina Cruz", email: "field2@nnr.test", role: "FIELD", phone: "+639170000002" },
    { key: "sup1", name: "Elena Bautista", email: "sup1@nnr.test", role: "SUPERVISOR" },
    { key: "sup2", name: "Fidel Garcia", email: "sup2@nnr.test", role: "SUPERVISOR" },
  ] as const;
  const users: Record<string, { id: string }> = {};
  for (const { key, ...u } of userData) {
    users[key] = await prisma.user.create({ data: { ...u, passwordHash } });
  }

  // ---------- Shippers ----------
  const shipperData: Array<{ name: string; contactPerson: string; email: string; phone: string; defaultPickupAddress: string; defaultArrastre: ArrastreResponsibility }> = [
    { name: "Luzon Coco Products Inc.", contactPerson: "Maria Lim", email: "export@luzoncoco.test", phone: "+6328000101", defaultPickupAddress: "Lot 4, LISP II, Calamba, Laguna", defaultArrastre: "NNR" },
    { name: "Visayas Furniture Crafts", contactPerson: "Jose Tan", email: "shipping@visfurn.test", phone: "+63322000202", defaultPickupAddress: "Mandaue City, Cebu (via MNL consolidation)", defaultArrastre: "SHIPPER" },
    { name: "Pinoy Dried Mango Co.", contactPerson: "Rosa Velasco", email: "ops@pinoymango.test", phone: "+6328000303", defaultPickupAddress: "Km 22 Aguinaldo Hwy, Dasmariñas, Cavite", defaultArrastre: "NNR" },
    { name: "Metro Electronics Assembly Corp.", contactPerson: "Kevin Ong", email: "logistics@metroelec.test", phone: "+6328000404", defaultPickupAddress: "PEZA Gateway Business Park, Gen. Trias, Cavite", defaultArrastre: "SHIPPER" },
    { name: "Bicol Abaca Fibers", contactPerson: "Liza Mendoza", email: "sales@bicolabaca.test", phone: "+6352000505", defaultPickupAddress: "Warehouse 3, Sucat, Parañaque City", defaultArrastre: "NNR" },
  ];
  const shippers = [];
  for (const s of shipperData) shippers.push(await createShipper(prisma, s)); // SHP-0001 …

  // Two CUSTOMER users exist only to prove the data model supports the post-MVP portal.
  // They are inactive and login rejects the CUSTOMER role in the MVP.
  for (const [i, sh] of [shippers[0], shippers[2]].entries()) {
    await prisma.user.create({
      data: { name: `${sh.contactPerson} (customer)`, email: `customer${i + 1}@nnr.test`, role: "CUSTOMER", passwordHash, active: false, shipperId: sh.id },
    });
  }

  // ---------- Deadline rules ----------
  for (const r of DEFAULT_RULES) {
    await prisma.deadlineRule.create({ data: r });
  }

  // ---------- Shipments ----------
  type Spec = {
    label: string;
    createdAt: Date;
    cargoType: CargoType;
    shipper: number;
    cs: "cs1" | "cs2";
    destinationPort: string;
    pod: string;
    containerPlan?: Array<{ size: "20" | "40" | "40HC"; qty: number }>;
    lclQty?: number;
    lclUnit?: "PALLET" | "BOX";
    arrastre: ArrastreResponsibility;
    carrierName: string;
    carrierBookingRef?: string;
    consigneeName?: string;
    requestedPickupAt?: Date;
    actualPickupAt?: Date;
    fsiCutoffAt?: Date;
    fsiSubmittedAt?: Date;
    preadviseCutoffAt?: Date;
    preadviseSentAt?: Date;
    declaration?: DeclarationStatus;
    declarationAt?: Date;
    bocUploadAt?: Date;
    arrastrePaidAt?: Date;
    exportDocsSentAt?: Date;
    etdMnl?: Date;
    atdMnl?: Date;
    eta?: Date;
    ata?: Date;
    closedAt?: Date;
    cancelledAt?: Date;
    cancelReason?: string;
    remarks?: string;
  };


  const specs: Spec[] = [
    // 1 BOOKED: pick-up not yet scheduled (also appears under "missing mandatory data")
    { label: "booked", createdAt: at(-2 * HOUR), cargoType: "LCL", lclQty: 12, lclUnit: "BOX", shipper: 3, cs: "cs1", destinationPort: "JPTYO Tokyo", pod: "JPTYO Tokyo", arrastre: "SHIPPER", carrierName: "ONE", etdMnl: at(6 * DAY) },
    // 2 PICKUP_SCHEDULED, pick-up due in 2h (amber)
    { label: "pickup soon", createdAt: at(-1 * DAY), cargoType: "FCL", containerPlan: [{ size: "40HC", qty: 2 }], shipper: 0, cs: "cs1", destinationPort: "USLAX Los Angeles", pod: "USLGB Long Beach", arrastre: "NNR", carrierName: "Maersk", carrierBookingRef: "MAEU240001", requestedPickupAt: at(2 * HOUR), fsiCutoffAt: at(2 * DAY), preadviseCutoffAt: at(2.5 * DAY), etdMnl: at(5 * DAY) },
    // 3 PICKUP_SCHEDULED, pick-up OVERDUE by 5h (red)
    { label: "pickup overdue", createdAt: at(-2 * DAY), cargoType: "LCL", lclQty: 4, lclUnit: "PALLET", shipper: 2, cs: "cs2", destinationPort: "SGSIN Singapore", pod: "SGSIN Singapore", arrastre: "NNR", carrierName: "ONE", requestedPickupAt: at(-5 * HOUR), fsiCutoffAt: at(1.5 * DAY), etdMnl: at(4 * DAY) },
    // 4 PICKED_UP, FSI cut-off OVERDUE by 3h
    { label: "fsi overdue", createdAt: at(-3 * DAY), cargoType: "FCL", containerPlan: [{ size: "20", qty: 1 }, { size: "40", qty: 1 }], shipper: 4, cs: "cs1", destinationPort: "NLRTM Rotterdam", pod: "NLRTM Rotterdam", arrastre: "NNR", carrierName: "Evergreen", carrierBookingRef: "EGLV0920001", requestedPickupAt: at(-1 * DAY), actualPickupAt: at(-1 * DAY + 3 * HOUR), fsiCutoffAt: at(-3 * HOUR), preadviseCutoffAt: at(1 * DAY), etdMnl: at(3 * DAY) },
    // 5 FSI_DONE, pre-advise due in 3h (amber)
    { label: "preadvise soon", createdAt: at(-4 * DAY), cargoType: "LCL", lclQty: 6, lclUnit: "PALLET", shipper: 1, cs: "cs2", destinationPort: "AUSYD Sydney", pod: "AUSYD Sydney", arrastre: "SHIPPER", carrierName: "CMA CGM", requestedPickupAt: at(-2 * DAY), actualPickupAt: at(-2 * DAY), fsiCutoffAt: at(-4 * HOUR), fsiSubmittedAt: at(-8 * HOUR), preadviseCutoffAt: at(3 * HOUR), etdMnl: at(3 * DAY) },
    // 6 PREADVISED, BOC upload OVERDUE (rule: FSI cut-off - 24h)
    { label: "boc overdue", createdAt: at(-5 * DAY), cargoType: "FCL", containerPlan: [{ size: "40", qty: 3 }], shipper: 0, cs: "cs1", destinationPort: "CNSHA Shanghai", pod: "CNSHA Shanghai", arrastre: "NNR", carrierName: "COSCO", carrierBookingRef: "COSU6100023", requestedPickupAt: at(-3 * DAY), actualPickupAt: at(-3 * DAY + 2 * HOUR), fsiCutoffAt: at(10 * HOUR), fsiSubmittedAt: at(-1 * DAY), preadviseCutoffAt: at(-6 * HOUR), preadviseSentAt: at(-10 * HOUR), etdMnl: at(2 * DAY) },
    // 7 DECLARED (arrastre by shipper -> step skipped)
    { label: "declared", createdAt: at(-3 * DAY), cargoType: "FCL", containerPlan: [{ size: "20", qty: 2 }], shipper: 3, cs: "cs2", destinationPort: "HKHKG Hong Kong", pod: "HKHKG Hong Kong", arrastre: "SHIPPER", carrierName: "OOCL", carrierBookingRef: "OOLU2741190", requestedPickupAt: at(-1 * DAY), actualPickupAt: at(-1 * DAY), fsiCutoffAt: at(-6 * HOUR), fsiSubmittedAt: at(-10 * HOUR), preadviseCutoffAt: at(-2 * HOUR), preadviseSentAt: at(-3 * HOUR), declaration: "FILED", declarationAt: at(-1 * HOUR), etdMnl: at(1 * DAY) },
    // 8 BOC_UPLOADED, arrastre OVERDUE (rule: ETD - 24h; ETD in 20h)
    { label: "arrastre overdue", createdAt: at(-6 * DAY), cargoType: "FCL", containerPlan: [{ size: "40HC", qty: 1 }], shipper: 4, cs: "cs2", destinationPort: "DEHAM Hamburg", pod: "DEHAM Hamburg", arrastre: "NNR", carrierName: "Hapag-Lloyd", carrierBookingRef: "HLCU7781234", requestedPickupAt: at(-4 * DAY), actualPickupAt: at(-4 * DAY), fsiCutoffAt: at(-1 * DAY), fsiSubmittedAt: at(-2 * DAY), preadviseCutoffAt: at(-20 * HOUR), preadviseSentAt: at(-22 * HOUR), declaration: "ASSESSED", declarationAt: at(-18 * HOUR), bocUploadAt: at(-2 * DAY - 2 * HOUR), etdMnl: at(20 * HOUR) },
    // 9 ARRASTRE_PAID
    { label: "arrastre paid", createdAt: at(-7 * DAY), cargoType: "FCL", containerPlan: [{ size: "20", qty: 2 }], shipper: 2, cs: "cs1", destinationPort: "KRPUS Busan", pod: "KRPUS Busan", arrastre: "NNR", carrierName: "ONE", carrierBookingRef: "ONEYMNL8812", requestedPickupAt: at(-5 * DAY), actualPickupAt: at(-5 * DAY + 4 * HOUR), fsiCutoffAt: at(-2 * DAY), fsiSubmittedAt: at(-3 * DAY), preadviseCutoffAt: at(-1.5 * DAY), preadviseSentAt: at(-2 * DAY), declaration: "RELEASED", declarationAt: at(-1 * DAY), bocUploadAt: at(-3.2 * DAY), arrastrePaidAt: at(-1.2 * DAY), etdMnl: at(1 * DAY) },
    // 10 DOCS_SENT (arrastre by shipper -> step skipped)
    { label: "docs sent", createdAt: at(-8 * DAY), cargoType: "LCL", lclQty: 30, lclUnit: "BOX", shipper: 1, cs: "cs2", destinationPort: "AEJEA Jebel Ali", pod: "AEJEA Jebel Ali", arrastre: "SHIPPER", carrierName: "MSC", requestedPickupAt: at(-6 * DAY), actualPickupAt: at(-6 * DAY), fsiCutoffAt: at(-3 * DAY), fsiSubmittedAt: at(-4 * DAY), preadviseCutoffAt: at(-2.5 * DAY), preadviseSentAt: at(-3 * DAY), declaration: "RELEASED", declarationAt: at(-2 * DAY), bocUploadAt: at(-4.1 * DAY), exportDocsSentAt: at(-6 * HOUR), etdMnl: at(12 * HOUR) },
    // 11 DEPARTED yesterday (ocean)
    { label: "departed ocean", createdAt: at(-10 * DAY), cargoType: "FCL", containerPlan: [{ size: "40HC", qty: 4 }], shipper: 0, cs: "cs1", destinationPort: "USOAK Oakland", pod: "USOAK Oakland", arrastre: "NNR", carrierName: "Maersk", carrierBookingRef: "MAEU239870", consigneeName: "West Coast Foods LLC", requestedPickupAt: at(-8 * DAY), actualPickupAt: at(-8 * DAY), fsiCutoffAt: at(-5 * DAY), fsiSubmittedAt: at(-6 * DAY), preadviseCutoffAt: at(-4 * DAY), preadviseSentAt: at(-4.5 * DAY), declaration: "RELEASED", declarationAt: at(-3 * DAY), bocUploadAt: at(-6.2 * DAY), arrastrePaidAt: at(-2.5 * DAY), exportDocsSentAt: at(-2 * DAY), etdMnl: at(-1 * DAY), atdMnl: at(-1 * DAY + 3 * HOUR), eta: at(16 * DAY) },
    // 12 DEPARTED yesterday (LCL)
    { label: "departed lcl", createdAt: at(-4 * DAY), cargoType: "LCL", lclQty: 8, lclUnit: "PALLET", shipper: 3, cs: "cs2", destinationPort: "SGSIN Singapore", pod: "SGSIN Singapore", arrastre: "SHIPPER", carrierName: "PIL", requestedPickupAt: at(-3 * DAY), actualPickupAt: at(-3 * DAY), fsiCutoffAt: at(-2 * DAY), fsiSubmittedAt: at(-2.2 * DAY), preadviseCutoffAt: at(-1.8 * DAY), preadviseSentAt: at(-2 * DAY), declaration: "RELEASED", declarationAt: at(-1.5 * DAY), bocUploadAt: at(-2.5 * DAY), exportDocsSentAt: at(-1.2 * DAY), etdMnl: at(-1 * DAY), atdMnl: at(-1 * DAY + 1 * HOUR), eta: at(2 * DAY) },
    // 13 ARRIVED (previous month)
    { label: "arrived", createdAt: at(-30 * DAY), cargoType: "FCL", containerPlan: [{ size: "20", qty: 1 }], shipper: 4, cs: "cs1", destinationPort: "JPYOK Yokohama", pod: "JPYOK Yokohama", arrastre: "NNR", carrierName: "Evergreen", carrierBookingRef: "EGLV0910044", requestedPickupAt: at(-28 * DAY), actualPickupAt: at(-27.8 * DAY), fsiCutoffAt: at(-25 * DAY), fsiSubmittedAt: at(-25.5 * DAY), preadviseCutoffAt: at(-24 * DAY), preadviseSentAt: at(-24.2 * DAY), declaration: "RELEASED", declarationAt: at(-23 * DAY), bocUploadAt: at(-26.5 * DAY), arrastrePaidAt: at(-22.5 * DAY), exportDocsSentAt: at(-22 * DAY), etdMnl: at(-21 * DAY), atdMnl: at(-21 * DAY), eta: at(-15 * DAY), ata: at(-14.5 * DAY) },
    // 14 CLOSED (previous month; pick-up was late, arrastre paid late, for monthly metrics)
    { label: "closed", createdAt: at(-35 * DAY), cargoType: "LCL", lclQty: 3, lclUnit: "PALLET", shipper: 2, cs: "cs2", destinationPort: "TWKHH Kaohsiung", pod: "TWKHH Kaohsiung", arrastre: "NNR", carrierName: "Wan Hai", requestedPickupAt: at(-33 * DAY), actualPickupAt: at(-32.7 * DAY), fsiCutoffAt: at(-30 * DAY), fsiSubmittedAt: at(-30.2 * DAY), preadviseCutoffAt: at(-29 * DAY), preadviseSentAt: at(-29.1 * DAY), declaration: "RELEASED", declarationAt: at(-28 * DAY), bocUploadAt: at(-31.2 * DAY), arrastrePaidAt: at(-26.5 * DAY), exportDocsSentAt: at(-26 * DAY), etdMnl: at(-27 * DAY), atdMnl: at(-26 * DAY), eta: at(-22 * DAY), ata: at(-22 * DAY), closedAt: at(-20 * DAY) },
    // 15 CANCELLED
    { label: "cancelled", createdAt: at(-6 * DAY), cargoType: "FCL", containerPlan: [{ size: "40", qty: 1 }], shipper: 1, cs: "cs1", destinationPort: "USNYC New York", pod: "USNYC New York", arrastre: "SHIPPER", carrierName: "ZIM", requestedPickupAt: at(-3 * DAY), fsiCutoffAt: at(1 * DAY), etdMnl: at(4 * DAY), cancelledAt: at(-4 * DAY), cancelReason: "Buyer postponed order" },
  ];

  const rules = DEFAULT_RULES;
  const statusSeen = new Set<string>();

  for (const s of specs) {
    const shipper = shippers[s.shipper];
    const csId = users[s.cs].id;
    const declaration = s.declaration ?? "PENDING";
    const fields = {
      requestedPickupAt: s.requestedPickupAt ?? null,
      actualPickupAt: s.actualPickupAt ?? null,
      fsiCutoffAt: s.fsiCutoffAt ?? null,
      fsiSubmittedAt: s.fsiSubmittedAt ?? null,
      preadviseCutoffAt: s.preadviseCutoffAt ?? null,
      preadviseSentAt: s.preadviseSentAt ?? null,
      exportDeclarationStatus: declaration,
      exportDeclarationUpdatedAt: s.declarationAt ?? null,
      bocUploadAt: s.bocUploadAt ?? null,
      arrastreResponsibility: s.arrastre,
      arrastrePaidAt: s.arrastrePaidAt ?? null,
      exportDocsSentAt: s.exportDocsSentAt ?? null,
      etdMnl: s.etdMnl ?? null,
      // Demo: terminal arrastre cut-off one day before ETD when NNR pays arrastre.
      arrastreCutoffAt: s.arrastre === "NNR" && s.etdMnl ? new Date(s.etdMnl.getTime() - DAY) : null,
      atdMnl: s.atdMnl ?? null,
      eta: s.eta ?? null,
      ata: s.ata ?? null,
      closedAt: s.closedAt ?? null,
      cancelledAt: s.cancelledAt ?? null,
    };
    const status = deriveStatus(fields, now);
    statusSeen.add(status);

    await prisma.$transaction(async (tx) => {
      const jobNo = await nextJobNo(tx, s.createdAt);
      const podCode = podCodeFor(s.pod) ?? podCodeFor(s.destinationPort) ?? "XXX";
      const hblNo = await nextHblNo(tx, podCode, s.cargoType);
      const shipment = await tx.shipment.create({
        data: {
          ...fields,
          ...computeCachedDeadlines(rules, fields),
          jobNo,
          hblNo,
          podCode,
          cargoType: s.cargoType,
          shipperId: shipper.id,
          consigneeName: s.consigneeName,
          pickupAddress: shipper.defaultPickupAddress,
          destinationPort: s.destinationPort,
          pod: s.pod,
          containerPlan: s.containerPlan ?? Prisma.DbNull,
          lclQty: s.lclQty,
          lclUnit: s.lclUnit,
          carrierName: s.carrierName,
          carrierBookingRef: s.carrierBookingRef,
          carrierRemarks: s.remarks,
          cancelReason: s.cancelReason,
          status,
          source: "CS",
          assignedCsId: csId,
          createdById: csId,
          createdAt: s.createdAt,
        },
      });

      // Milestone history consistent with the fields above.
      type Ev = { type: string; at: Date | undefined; value?: string; source?: "WEB" | "FIELD_LINK" | "SYSTEM"; actor?: string };
      const field = s.shipper % 2 === 0 ? users.field1.id : users.field2.id;
      const evs: Ev[] = [
        { type: EVENT.CREATED, at: s.createdAt, value: JSON.stringify({ source: "CS" }) },
        { type: EVENT.NUMBERS_ASSIGNED, at: s.createdAt, value: JSON.stringify({ jobNo, hblNo }), source: "SYSTEM" },
        { type: EVENT.PICKUP_SCHEDULED, at: s.requestedPickupAt ? s.createdAt : undefined, value: s.requestedPickupAt?.toISOString() },
        { type: EVENT.PICKED_UP, at: s.actualPickupAt, source: "FIELD_LINK", actor: field },
        { type: EVENT.FSI_SUBMITTED, at: s.fsiSubmittedAt },
        { type: EVENT.BOC_UPLOADED, at: s.bocUploadAt },
        { type: EVENT.PREADVISE_SENT, at: s.preadviseSentAt },
        { type: EVENT.DECLARATION_STATUS, at: s.declarationAt, value: declaration, source: "FIELD_LINK", actor: field },
        { type: EVENT.ARRASTRE_PAID, at: s.arrastrePaidAt },
        { type: EVENT.DOCS_SENT, at: s.exportDocsSentAt, value: JSON.stringify({ to: shipper.email }) },
        { type: EVENT.DEPARTED, at: s.atdMnl },
        { type: EVENT.ARRIVED, at: s.ata },
        { type: EVENT.CLOSED, at: s.closedAt },
        { type: EVENT.CANCELLED, at: s.cancelledAt, value: s.cancelReason },
      ];
      const rows = evs
        .filter((e): e is Ev & { at: Date } => !!e.at)
        .sort((a, b) => a.at.getTime() - b.at.getTime())
        .map((e) => ({
          shipmentId: shipment.id,
          type: e.type,
          value: e.value ?? null,
          actorId: e.source === "SYSTEM" ? null : e.actor ?? csId,
          source: e.source ?? "WEB",
          occurredAt: e.at,
        }));
      await tx.milestoneEvent.createMany({ data: rows });
    });
  }

  const allStatuses = ["BOOKED", "PICKUP_SCHEDULED", "PICKED_UP", "FSI_DONE", "PREADVISED", "DECLARED", "BOC_UPLOADED", "ARRASTRE_PAID", "DOCS_SENT", "DEPARTED", "ARRIVED", "CLOSED", "CANCELLED"];
  const missing = allStatuses.filter((x) => !statusSeen.has(x));
  if (missing.length) throw new Error(`Seed does not cover statuses: ${missing.join(", ")}`);

  console.log(`Seeded ${userData.length} staff users (+2 inactive customer placeholders), ${shippers.length} shippers, ${specs.length} shipments.`);
  console.log(`Demo login: sup1@nnr.test / ${DEMO_PASSWORD}  (also cs1, cs2, field1, field2, sup2)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
