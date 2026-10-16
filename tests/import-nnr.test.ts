import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { runImport } from "@/lib/import/run";
import { parseCsv } from "@/lib/import/table";
import { parseSheetDate } from "@/lib/import/parse";
import { rawSheet } from "@/lib/reports/excel";
import { nextHblNo } from "@/lib/numbering";
import { fromManila } from "@/lib/time";
import { prisma, fixtures } from "./helpers";

afterAll(() => prisma.$disconnect());

// The three header rows exactly as in NNR's monitoring sheet; the data rows are invented.
const HEADER = `HBL NO. ,BOOKING NO.,SHIPPER ,DESTINATION,,,,,FCL,,LCL,SHIPPER'S REQUESTED PICK UP DATE,ACTUAL PICK UP DATE,CUT OFF DATE & TIME,,,EXPORT DECLARTION,,DATE UPLOAD TO BOC PORTAL,DATE ARRASTE PAID,DATE SENT THE EXPORT DOCUMENTS,,CARRIER,REMARKS,
,,,,ETD MNL,ATD MNL,ETA POD,ATA POD,,,,,,,,,,,,,,,,,
,,,,,,,,40FT,20FT,Quantity,,,FSI,PRE ADVISE,ARRASTRE,C/O SHIPPER,C/O NNR,,,SHIPPING LINE,CO-LOADER,,,`;

const row = (c: Record<number, string>) => Array.from({ length: 25 }, (_, i) => {
  const v = c[i] ?? "";
  return /[,"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}).join(",");

// Columns: 0 HBL, 1 booking, 2 shipper, 3 destination, 4 ETD, 5 ATD, 6 ETA, 7 ATA, 8 40FT, 9 20FT, 10 LCL,
// 11 requested pick-up, 12 actual, 13 FSI, 14 pre-advise, 15 arrastre cut-off, 16 decl c/o shipper,
// 17 decl c/o NNR, 18 BOC, 19 arrastre paid, 20 docs sent, 21 docs (2nd), 22 carrier, 23 remarks
const SHEET = [
  HEADER,
  row({ 0: "NNRMNLTYOL7001", 2: "ACME TRADING", 3: "TOKYO", 10: "3 PALLETS", 11: "04-Apr", 22: "ECU" }), // r4 Apr 2025, history
  row({ 0: "NNRMNLNGOF7002", 2: "ACME TRADNG", 3: "NAGOYA", 8: "1X40'HC & 1X40ST", 11: "20-Jul", 22: "ONE" }), // r5 typo shipper, Jul 2025
  row({ 0: "NNRMNLNGOF7003 / PART OF 7002", 2: "ACME TRADING", 3: "NAGOYA", 8: "1X40", 11: "TBA =", 22: "ONE" }), // r6 split
  row({ 0: "DIRECT BL", 2: "BETA FOODS", 3: "MOJI", 9: "2X20", 11: "15-Nov", 22: "CNC" }), // r7 direct BL, Nov 2025
  row({ 0: "NNRMNLBKKF7004", 2: "BETA FOODS", 3: "", 9: "1X20", 11: "02-Mar" }), // r8 error: no destination, Mar 2026
  row({ 0: "NNRMNLSINL7005", 2: "GAMMA PH", 3: "SINGAPORE", 10: "27 CTS", 11: "15-16 JUL", 22: "SHIPCO", 23: "CANCELLED BOOKING" }), // r9 cancelled, Jul 2026
  row({ // r10 the active one, Oct 2026
    0: "NNRMNLLCHF7006", 1: "MNLM1234567", 2: "GAMMA PH", 3: "LAEM CHABANG", 4: "25-Oct", 8: "", 9: "2X20", 11: "10-Oct", 12: "10-Oct",
    13: "11 C0CT @ 1200H", 14: "12 OCT @ 2300H", 15: "N/A", 16: "N/A", 17: "13-Oct", 19: "N/A", 22: "OOCL",
  }),
  row({ 0: "NNRMNLHKGF7007", 2: "DELTA INC", 3: "HONG KONG", 9: "1X20", 11: "14-Oct", 17: "C/O NNR (AAI)", 18: "c/o shipper", 22: "ONE" }), // r11 broker
  row({ 0: "NNRMNLOSAF9990", 2: "", 3: "OSAKA", 9: "1X20", 11: "15-Oct" }), // r12 error (no shipper) with the highest HBL
].join("\n");

const file = Buffer.from(SHEET, "utf8");
const now = fromManila(2026, 10, 16, 10, 0);
let f: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => {
  f = await fixtures();
});
const run = (o: Partial<Parameters<typeof runImport>[2]> = {}) =>
  runImport(prisma, file, { actor: { id: f.sup.id, role: "SUPERVISOR" }, now, dryRun: false, createMissingShippers: true, fileName: "monitoring.csv", ...o });
const byHbl = (hblNo: string) => prisma.shipment.findUniqueOrThrow({ where: { hblNo }, include: { shipper: true } });

describe("sheet dates", () => {
  const ref = fromManila(2026, 10, 1);
  it("reads the sheet's hand-typed dates and gives them the nearest year", () => {
    expect(parseSheetDate("04-Apr", fromManila(2025, 3, 20))?.toISOString()).toBe(fromManila(2025, 4, 4).toISOString());
    expect(parseSheetDate("11 C0CT @ 1200H", ref)?.toISOString()).toBe(fromManila(2026, 10, 11, 12).toISOString());
    expect(parseSheetDate("11COCT@ 1700H", ref)?.toISOString()).toBe(fromManila(2026, 10, 11, 17).toISOString());
    expect(parseSheetDate("25 SEP @1200H", ref)?.toISOString()).toBe(fromManila(2026, 9, 25, 12).toISOString());
    expect(parseSheetDate("05-Jan", fromManila(2025, 12, 20))?.toISOString()).toBe(fromManila(2026, 1, 5).toISOString());
    expect(parseSheetDate("12JUN @", fromManila(2026, 6, 1))?.toISOString()).toBe(fromManila(2026, 6, 12).toISOString());
    expect(parseSheetDate("15-16 MAY", fromManila(2026, 5, 1))?.toISOString()).toBe(fromManila(2026, 5, 15).toISOString());
    // A few weeks out of order stays in the same year.
    expect(parseSheetDate("20-Sep", fromManila(2026, 10, 10))?.toISOString()).toBe(fromManila(2026, 9, 20).toISOString());
    for (const blank of ["TBA", "TBA =", "N/A", "NA", "-", "", "c/o shipper", "C/SHIPPER"]) expect(parseSheetDate(blank, ref)).toBeNull();
    expect(() => parseSheetDate("10/11", ref)).toThrow(/ambiguous/);
    expect(() => parseSheetDate("6MAT=Y", ref)).toThrow(/not a date/);
  });

  it("parses CSV with quotes, commas and line breaks", () => {
    expect(parseCsv('a,"b,c","d ""e""",\n"x\ny",z')).toEqual([["a", "b,c", 'd "e"', ""], ["x\ny", "z"]]);
  });
});

describe("importing NNR's monitoring sheet", () => {
  it("checks the whole sheet first: layout, years, history, errors, merges", async () => {
    const r = await run({ dryRun: true });
    expect(r).toMatchObject({ layout: "nnr", startYear: 2025, total: 9, imported: 7, cancelled: 1 });
    expect(r.history).toBe(4); // Apr/Jul 2025, the split (TBA, follows Jul), Nov 2025
    expect(r.errors.map((e) => e.row)).toEqual([8, 12]);
    expect(r.errors[0].messages.join(" ")).toMatch(/Destination is required/);
    expect(r.mergedShippers).toEqual([{ from: "ACME TRADNG", to: "ACME TRADING", rows: 1 }]);
    expect(r.createdShippers.sort()).toEqual(["ACME TRADING", "BETA FOODS", "DELTA INC", "GAMMA PH"]);
  });

  it("imports every column the way the sheet means it", async () => {
    const r = await run();
    expect(r.imported).toBe(7);

    const lcl = await byHbl("NNRMNLTYOL7001");
    expect(lcl).toMatchObject({ cargoType: "LCL", lclQty: 3, lclUnit: "PALLET", podCode: "TYO", status: "CLOSED", importedAsHistory: true, carrierName: "ECU" });
    expect(lcl.requestedPickupAt?.toISOString()).toBe(fromManila(2025, 4, 4).toISOString());

    const fcl = await byHbl("NNRMNLNGOF7002");
    expect(fcl.shipper.name).toBe("ACME TRADING"); // typo merged
    expect(fcl.containerPlan).toEqual([{ size: "40HC", qty: 1 }, { size: "40", qty: 1 }]);
    expect((await byHbl("NNRMNLNGOF7003")).partOfHblNo).toBe("NNRMNLNGOF7002");

    const direct = await prisma.shipment.findFirstOrThrow({ where: { carrierRemarks: { contains: "DIRECT BL" } } });
    expect(direct).toMatchObject({ hblNo: null, podCode: null, destinationPort: "MOJI" });

    const cancelled = await byHbl("NNRMNLSINL7005");
    expect(cancelled).toMatchObject({ status: "CANCELLED", lclQty: 27, lclUnit: "BOX" });
    expect(cancelled.carrierRemarks).toMatch(/CANCELLED BOOKING/);

    const active = await byHbl("NNRMNLLCHF7006");
    expect(active).toMatchObject({
      importedAsHistory: false, carrierBookingRef: "MNLM1234567", arrastreResponsibility: "SHIPPER",
      declarationBy: "NNR", exportDeclarationStatus: "FILED", status: "DECLARED", podCode: "LCH",
    });
    expect(active.fsiCutoffAt?.toISOString()).toBe(fromManila(2026, 10, 11, 12).toISOString());
    expect(active.preadviseCutoffAt?.toISOString()).toBe(fromManila(2026, 10, 12, 23).toISOString());
    expect(active.etdMnl?.toISOString()).toBe(fromManila(2026, 10, 25).toISOString());
    expect(active.exportDeclarationUpdatedAt?.toISOString()).toBe(fromManila(2026, 10, 13).toISOString());

    const broker = await byHbl("NNRMNLHKGF7007");
    expect(broker).toMatchObject({ declarationBy: "NNR", declarationBroker: "AAI", exportDeclarationStatus: "PENDING" });
    expect(broker.carrierRemarks).toMatch(/BOC upload: c\/o shipper/);

    // The highest HBL in the file (even on a row with errors) moves the counter: next is 9991.
    expect(await nextHblNo(prisma, "TYO", "FCL")).toBe("NNRMNLTYOF9991");
  });

  it("re-importing skips everything already there; only the fixed rows would be new", async () => {
    const r = await run();
    expect(r.imported).toBe(0);
    expect(r.skipped).toHaveLength(7); // the direct-BL row is recognised by shipper/destination/pick-up/cargo
  });

  it("the app's own Excel export uses the same layout and re-imports", async () => {
    const shipments = await prisma.shipment.findMany({ where: { hblNo: { startsWith: "NNRMNL" }, source: "IMPORT", createdById: f.sup.id }, include: { shipper: { select: { name: true } }, assignedCs: { select: { name: true, email: true } } } });
    const wb = new ExcelJS.Workbook();
    rawSheet(wb, shipments);
    const xlsx = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await runImport(prisma, xlsx, { actor: { id: f.sup.id, role: "SUPERVISOR" }, now, dryRun: false, createMissingShippers: true, fileName: "export.xlsx" });
    expect(r.layout).toBe("nnr");
    expect(r.errors).toEqual([]);
    expect(r.skipped).toHaveLength(shipments.length); // all already imported: recognised by HBL
  });
});
