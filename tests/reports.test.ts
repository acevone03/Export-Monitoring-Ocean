import { afterAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Shipment } from "@prisma/client";
import { buildDailyReport } from "@/lib/reports/daily";
import { buildMonthlyReport } from "@/lib/reports/monthly";
import { dailyWorkbook, monthlyWorkbook } from "@/lib/reports/excel";
import { runDailyReportIfDue } from "@/lib/reports/deliver";
import type { ExportShipment } from "@/lib/columns";
import { SHEET_COLUMNS } from "@/lib/nnr-sheet";
import { fromManila, HOUR, DAY } from "@/lib/time";
import { prisma, fixtures } from "./helpers";

afterAll(() => prisma.$disconnect());

// Report day: Sat 17-Oct-2026, 08:00 Manila.
const now = fromManila(2026, 10, 17, 8, 0);
const t = (h: number) => new Date(now.getTime() + h * HOUR);
let n = 0;
const ship = (o: Partial<Shipment> & { shipperName?: string; csName?: string } = {}): ExportShipment => {
  const { shipperName = "Acme", csName = "Ana", ...rest } = o;
  n++;
  return {
    id: `s${n}`, jobNo: `EX-O-2610-${String(n).padStart(4, "0")}`, hblNo: `NNRMNLLAXF${String(9000 + n)}`,
    status: "PICKUP_SCHEDULED", cargoType: "FCL", containerPlan: [{ size: "40HC", qty: 1 }], lclQty: null, lclUnit: null,
    destinationPort: "USLAX Los Angeles", pod: "USLGB", consigneeName: null, pickupAddress: null,
    positioningAt: null, containerYard: null, portOfLoading: null, cyCutoffAt: null, consolidator: null, grossWeightKg: null, cbm: null,
    cargoDescription: null, cargoDimensions: null, deliveryWarehouse: null, pickupRemarks: null, pickupInstructionSentAt: null, carrierName: "Maersk", carrierBookingRef: "B1",
    carrierRemarks: null, arrastreResponsibility: "NNR", exportDeclarationStatus: "PENDING",
    requestedPickupAt: t(48), actualPickupAt: null, fsiCutoffAt: t(72), fsiSubmittedAt: null,
    preadviseCutoffAt: t(80), preadviseSentAt: null, bocDeadlineAt: t(48), bocUploadAt: null,
    arrastreDeadlineAt: t(96), arrastreCutoffAt: t(96), arrastrePaidAt: null, exportDocsSentAt: null,
    etdMnl: t(120), atdMnl: null, eta: null, ata: null, createdAt: t(-24),
    declarationBy: "NNR", declarationForwarder: null, podCode: "LAX", partOfHblNo: null, exportDocsToOverseasAt: null, importedAsHistory: false,
    shipper: { name: shipperName }, assignedCs: { name: csName },
    ...rest,
  } as ExportShipment;
};

describe("daily report", () => {
  const overdue = ship({ requestedPickupAt: t(-3) }); // pick-up 05:00 today, not done
  const pickupTomorrow = ship({ requestedPickupAt: t(26) });
  const fsiToday = ship({ requestedPickupAt: t(-30), actualPickupAt: t(-30), fsiCutoffAt: t(6) });
  const departed = ship({ status: "DEPARTED", atdMnl: t(-20), eta: t(200), requestedPickupAt: t(-100), actualPickupAt: t(-100) });
  const missing = ship({ carrierBookingRef: null });
  const cancelled = ship({ status: "CANCELLED", requestedPickupAt: t(-2) });
  const r = buildDailyReport([overdue, pickupTomorrow, fsiToday, departed, missing, cancelled], now);
  const sec = (k: string) => r.sections.find((s) => s.key === k)!.items;

  it("puts overdue first and in red", () => {
    expect(r.sections[0]).toMatchObject({ key: "overdue", tone: "red" });
    expect(sec("overdue").map((i) => `${i.jobNo} ${i.what}`)).toEqual([`${overdue.jobNo} Pick-up`]);
  });

  it("lists pick-ups today and tomorrow, cut-offs today, departures yesterday", () => {
    expect(sec("pickups").map((i) => [i.jobNo, i.what])).toEqual([
      [overdue.jobNo, "Pick-up today"],
      [pickupTomorrow.jobNo, "Pick-up tomorrow"],
    ]);
    expect(sec("cutoffs").map((i) => [i.jobNo, i.what])).toEqual([[fsiToday.jobNo, "FSI cut-off"]]);
    expect(sec("departed").map((i) => i.jobNo)).toEqual([departed.jobNo]);
  });

  it("lists pending BOC/arrastre (not after departure) and missing data, never cancelled", () => {
    const pendingJobs = new Set(sec("pending").map((i) => i.jobNo));
    expect(pendingJobs.has(departed.jobNo)).toBe(false);
    expect(pendingJobs.has(overdue.jobNo)).toBe(true);
    expect(sec("missing").map((i) => [i.jobNo, i.detail])).toEqual([[missing.jobNo, "Carrier booking ref"]]);
    expect(r.sections.flatMap((s) => s.items).some((i) => i.jobNo === cancelled.jobNo)).toBe(false);
  });
});

describe("monthly report", () => {
  const oct = (d: number, h = 9) => fromManila(2026, 10, d, h);
  const rows = [
    // On time everywhere; picked up 2h late vs requested? no: 1h early
    ship({ createdAt: oct(1), requestedPickupAt: oct(2), actualPickupAt: oct(2, 8), fsiCutoffAt: oct(3), fsiSubmittedAt: oct(3, 8),
      preadviseCutoffAt: oct(4), preadviseSentAt: oct(4, 8), bocDeadlineAt: oct(2), bocUploadAt: oct(2, 8),
      arrastreDeadlineAt: oct(5), arrastrePaidAt: oct(5, 8), atdMnl: oct(6), etdMnl: oct(6), status: "DEPARTED", shipperName: "Acme", csName: "Ana" }),
    // Late pick-up (+3h), late arrastre, FSI still open & overdue
    ship({ createdAt: oct(1), requestedPickupAt: oct(8), actualPickupAt: oct(8, 12), fsiCutoffAt: oct(9), fsiSubmittedAt: null,
      preadviseCutoffAt: null, bocDeadlineAt: null, arrastreDeadlineAt: oct(10), arrastrePaidAt: oct(10, 15),
      cargoType: "LCL", containerPlan: null, lclQty: 4, lclUnit: "PALLET", destinationPort: "SGSIN Singapore", shipperName: "Bravo", csName: "Ben" }),
    // Cancelled: counted separately, excluded from metrics
    ship({ createdAt: oct(2), status: "CANCELLED", requestedPickupAt: oct(3), shipperName: "Bravo" }),
    // Created in September: not in October totals, but its October deadline counts
    ship({ createdAt: fromManila(2026, 9, 28), requestedPickupAt: oct(1), actualPickupAt: oct(1, 9), fsiCutoffAt: fromManila(2026, 9, 30),
      bocDeadlineAt: null, arrastreDeadlineAt: null, preadviseCutoffAt: null, csName: "Ana" }),
    // Due later this month but not yet due: excluded from the rate
    ship({ createdAt: oct(15), requestedPickupAt: oct(25), fsiCutoffAt: oct(26), preadviseCutoffAt: oct(27), bocDeadlineAt: oct(25), arrastreDeadlineAt: oct(28) }),
  ];
  const r = buildMonthlyReport(rows, "2026-10", now);

  it("counts shipments created in the month, cancelled separately", () => {
    expect(r.label).toBe("October 2026");
    expect(r.totals).toMatchObject({ shipments: 3, cancelled: 1, fcl: 2, lcl: 1, containers: { "40HC": 2 } });
    expect(r.byShipper).toEqual([{ key: "Acme", count: 2 }, { key: "Bravo", count: 1 }]);
    expect(r.byDestination[0]).toEqual({ key: "USLAX Los Angeles", count: 2 });
  });

  it("computes on-time rates per deadline from deadlines due in the month", () => {
    const pick = r.onTime.find((o) => o.deadline === "Pick-up")!;
    expect(pick).toMatchObject({ onTime: 2, late: 1, openOverdue: 0, total: 3, rate: 66.7 });
    const fsi = r.onTime.find((o) => o.deadline === "FSI cut-off")!;
    expect(fsi).toMatchObject({ onTime: 1, late: 0, openOverdue: 1, total: 2, rate: 50 });
  });

  it("lists missed deadlines with lateness, by CS and by shipper", () => {
    expect(r.missed.map((m) => [m.deadline, m.lateHours])).toEqual([
      ["Pick-up", 3], ["FSI cut-off", null], ["Arrastre payment", 6],
    ]);
    expect(r.missedByCs).toEqual([{ key: "Ben", count: 3 }]);
    expect(r.missedByShipper).toEqual([{ key: "Bravo", count: 3 }]);
  });

  it("leaves imported history out of the deadline metrics but counts it in volumes", () => {
    const hist = ship({ createdAt: oct(3), requestedPickupAt: oct(3), actualPickupAt: null, fsiCutoffAt: oct(4), status: "CLOSED", importedAsHistory: true, shipperName: "Old Co" });
    const r2 = buildMonthlyReport([...rows, hist], "2026-10", now);
    expect(r2.totals.shipments).toBe(r.totals.shipments + 1);
    expect(r2.onTime).toEqual(r.onTime);
    expect(r2.missed).toEqual(r.missed);
  });

  it("averages pick-up delay and pick-up to ATD, and splits arrastre on time vs late", () => {
    expect(r.pickupDelay).toEqual({ count: 3, avgHours: 0.7 }); // (-1 + 3 + 0) / 3
    expect(r.pickupToAtd).toEqual({ count: 1, avgHours: 97 }); // 2 Oct 08:00 -> 6 Oct 09:00
    expect(r.arrastre).toEqual({ onTime: 1, late: 1, unpaidOverdue: 0 });
  });
});

describe("Excel exports", () => {
  it("daily workbook has the report and a raw-data sheet with real Manila dates", async () => {
    const s = ship({ requestedPickupAt: fromManila(2026, 10, 17, 9, 30) });
    const buf = await dailyWorkbook(buildDailyReport([s], now), [s]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Daily report", "Raw data"]);
    const raw = wb.getWorksheet("Raw data")!;
    // Same three header rows as NNR's monitoring sheet
    expect(raw.getRow(1).getCell(1).value).toBe("HBL NO.");
    expect(raw.getRow(2).getCell(5).value).toBe("ETD MNL");
    expect(raw.getRow(3).getCell(9).value).toBe("40FT");
    expect(raw.getRow(3).getCell(14).value).toBe("FSI");
    expect(raw.getRow(3).getCell(16).value).toBe("ARRASTRE");
    expect(raw.getRow(3).getCell(18).value).toBe("C/O NNR");
    expect(raw.getRow(1).getCell(SHEET_COLUMNS.length + 2).value).toBe("JOB NO.");
    expect(raw.getRow(4).getCell(9).value).toBe("1X40HC");
    expect(raw.getRow(4).getCell(17).value).toBe("N/A"); // declaration c/o NNR, so shipper column N/A
    const col = SHEET_COLUMNS.findIndex((c) => c.key === "reqPickup") + 1;
    const cell = raw.getRow(4).getCell(col);
    expect(cell.value).toEqual(new Date(Date.UTC(2026, 9, 17, 9, 30))); // wall-clock 09:30, as Excel shows it
    expect(cell.numFmt).toBe("dd-mmm-yyyy hh:mm");
  });

  it("monthly workbook has one sheet per section plus raw data", async () => {
    const s = ship();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await monthlyWorkbook(buildMonthlyReport([s], "2026-10", now), [s])) as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "On-time rate", "Missed deadlines", "Missed by CS & shipper", "Volume", "Raw data"]);
  });
});

describe("daily report schedule", () => {
  it("sends once per Manila day, only after 07:30, with the Excel attached", async () => {
    await fixtures(); // at least one active CS and supervisor to receive it
    process.env.OUTBOX_DIR = mkdtempSync(path.join(tmpdir(), "nnr-outbox-"));
    const day = fromManila(2026, 12, 1, 7, 29);
    expect(await runDailyReportIfDue(prisma, day)).toBeNull();
    const first = await runDailyReportIfDue(prisma, new Date(day.getTime() + 2 * 60_000));
    expect(first?.sent).toBeGreaterThan(0);
    expect(await runDailyReportIfDue(prisma, new Date(day.getTime() + 4 * HOUR))).toBeNull();
    expect(await runDailyReportIfDue(prisma, new Date(day.getTime() + DAY + 2 * 60_000))).not.toBeNull(); // next day, 07:31
    const files = readdirSync(process.env.OUTBOX_DIR!);
    const mail = JSON.parse(readFileSync(path.join(process.env.OUTBOX_DIR!, files[0]), "utf8"));
    expect(mail.subject).toMatch(/^NNR daily report 0[12]-Dec-2026/);
    expect(mail.attachments[0].filename).toMatch(/\.xlsx$/);
    delete process.env.OUTBOX_DIR;
  });
});
