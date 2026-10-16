import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runImport, errorsWorkbook } from "@/lib/import/run";
import { resolveHeaders, IMPORT_FIELDS } from "@/lib/import/mapping";
import { parseCargo, parseImportDate } from "@/lib/import/parse";
import { nextHblNo, nextJobNo } from "@/lib/numbering";
import { fromManila } from "@/lib/time";
import { prisma, fixtures } from "./helpers";

afterAll(() => prisma.$disconnect());

describe("cell parsers", () => {
  it("reads Excel date cells, serial numbers and text dates as Manila time", () => {
    const want = fromManila(2026, 10, 20, 9, 0).toISOString(); // 01:00Z
    expect(parseImportDate(new Date(Date.UTC(2026, 9, 20, 9, 0)))?.toISOString()).toBe(want);
    expect(parseImportDate("20-Oct-2026 09:00")?.toISOString()).toBe(want);
    expect(parseImportDate("2026-10-20 09:00")?.toISOString()).toBe(want);
    expect(parseImportDate(46315.375)?.toISOString()).toBe(want);
    expect(parseImportDate("20-Oct-2026")?.toISOString()).toBe(fromManila(2026, 10, 20).toISOString());
    expect(parseImportDate("")).toBeNull();
  });

  it("refuses ambiguous or impossible dates", () => {
    expect(() => parseImportDate("10/11/2026")).toThrow(/ambiguous/);
    expect(() => parseImportDate("31-Feb-2026")).toThrow(/not a real date/);
    expect(() => parseImportDate("next week")).toThrow(/not a date/);
  });

  it("reads container and LCL notations", () => {
    expect(parseCargo("FCL 2x40HC + 1x20")).toEqual({ cargoType: "FCL", containerPlan: [{ size: "40HC", qty: 2 }, { size: "20", qty: 1 }] });
    expect(parseCargo("2 X 40'HQ, 1x40GP, 1x40")).toEqual({ cargoType: "FCL", containerPlan: [{ size: "40HC", qty: 2 }, { size: "40", qty: 2 }] });
    expect(parseCargo("LCL 6 PALLET")).toEqual({ cargoType: "LCL", lclQty: 6, lclUnit: "PALLET" });
    expect(parseCargo("30 ctns")).toEqual({ cargoType: "LCL", lclQty: 30, lclUnit: "BOX" });
    expect(() => parseCargo("1x45HC")).toThrow(/45/);
    expect(() => parseCargo("some boxes")).toThrow(/cannot read/);
  });

  it("maps header variants and reports unknown and missing columns", () => {
    const r = resolveHeaders(["Booking No.", "shipper", "DESTINATION", "Containers", "Pickup Date", "Notes", "BOC Upload Deadline"]);
    expect(r.map).toMatchObject({ jobNo: 0, shipper: 1, destination: 2, cargo: 3, requestedPickup: 4 });
    expect(r.unknown).toEqual(["Notes"]);
    expect(resolveHeaders(["Shipper"]).missingRequired).toEqual(["Destination", "Cargo"]);
  });

  it("documents every accepted header in docs/import.md", () => {
    const doc = readFileSync(path.resolve(__dirname, "../docs/import.md"), "utf8");
    for (const f of IMPORT_FIELDS) for (const h of f.headers) expect(doc).toContain(h);
  });
});

async function oneRow(head: string[], row: unknown[]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("x");
  ws.addRow(head);
  ws.addRow(row);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("runImport", () => {
  let f: Awaited<ReturnType<typeof fixtures>>;
  let file: Buffer;
  const now = fromManila(2026, 10, 16, 10, 0);
  const HEAD = ["Job No.", "HBL No.", "Shipper", "Destination", "Cargo", "Requested Pick-up", "Actual Pick-up", "ETD MNL", "ATD MNL", "ATA", "Arrastre By", "Status", "Assigned CS", "Notes"];

  beforeAll(async () => {
    f = await fixtures();
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Monitoring");
    ws.addRow(HEAD);
    const xl = (y: number, m: number, d: number, h = 0) => new Date(Date.UTC(y, m - 1, d, h)); // Excel wall clock
    ws.addRow(["EX-O-2601-0900", "NNRMNLLAXF9500", f.shipper.name, "USLAX Los Angeles", "2x40HC", xl(2026, 1, 10, 9), xl(2026, 1, 10, 11), xl(2026, 1, 14, 8), xl(2026, 1, 14, 20), "", "NNR", "Departed", f.cs.email, "ok"]); // 2 valid (CS by email)
    ws.addRow(["B-1234", "", "Mabuhay Exports Inc.", "SGSIN Singapore", "LCL 6 pallets", "20-Oct-2026 09:00", "", "", "", "", "", "", "", ""]); // 3 valid, new shipper, importer as CS
    ws.addRow(["", "", f.shipper.name, "JPTYO Tokyo", "1x20", "10/11/2026", "", "", "", "", "", "", "", ""]); // 4 ambiguous date
    ws.addRow(["", "", f.shipper.name, "", "1x20", "", "", "", "", "", "", "", "Nobody", ""]); // 5 no destination, unknown CS
    ws.addRow(["", "", f.shipper.name, "HKHKG Hong Kong", "1x40", "", "", "", "", xl(2026, 2, 1), "", "", "", ""]); // 6 ATA without ATD
    ws.addRow(["", "NNRMNLPUSF9501", f.shipper.name, "KRPUS Busan", "1x20", "", "", "", "", "", "SHIPPER", "Cancelled", "", ""]); // 7 valid, cancelled
    ws.addRow(["", "NNRMNLLAXF9500", f.shipper.name, "KRPUS Busan", "1x20", "", "", "", "", "", "", "", "", ""]); // 8 duplicate HBL in file
    ws.addRow([]); // blank, ignored
    file = Buffer.from(await wb.xlsx.writeBuffer());
  });

  it("dry run validates everything and writes nothing", async () => {
    const before = await prisma.shipment.count();
    const r = await runImport(prisma, file, { actor: { id: f.sup.id, role: "SUPERVISOR" }, now, dryRun: true, createMissingShippers: true, historyBefore: null });
    expect(r).toMatchObject({ dryRun: true, total: 7, imported: 3, unknownHeaders: ["Notes"], createdShippers: ["Mabuhay Exports Inc."] });
    expect(r.errors.map((e) => e.row)).toEqual([4, 5, 6, 8]);
    expect(r.errors[0].messages[0]).toMatch(/Requested Pick-up: .*ambiguous/);
    expect(r.errors[1].messages.join(" ")).toMatch(/Assigned CS "Nobody".*/);
    expect(r.errors[1].messages.join(" ")).toMatch(/Destination is required/);
    expect(r.errors[2].messages).toContain("ATA is set but ATD is empty");
    expect(r.errors[3].messages).toContain("HBL No. NNRMNLLAXF9500 appears twice in this file");
    // Names are not unique: ambiguous names are refused, not guessed.
    await prisma.user.create({ data: { name: f.cs.name, email: `twin-${f.cs.email}`, passwordHash: "x", role: "CS" } });
    const amb = await runImport(prisma, await oneRow(["Shipper", "Destination", "Cargo", "Assigned CS"], [f.shipper.name, "X", "1x20", "CS"]), { actor: { id: f.sup.id, role: "SUPERVISOR" }, now, dryRun: true, createMissingShippers: false, historyBefore: null });
    expect(amb.errors[0]?.messages.join(" ") ?? "").toMatch(/matches \d+ users; use their email/);
    expect(await prisma.shipment.count()).toBe(before);
    expect(await prisma.shipper.findUnique({ where: { name: "Mabuhay Exports Inc." } })).toBeNull();
  });

  it("imports valid rows, keeps numbers, derives status, and bumps counters", async () => {
    const r = await runImport(prisma, file, { actor: { id: f.sup.id, role: "SUPERVISOR" }, now, dryRun: false, createMissingShippers: true, historyBefore: null });
    expect(r.imported).toBe(3);
    expect(r.errors).toHaveLength(4);

    const kept = await prisma.shipment.findUniqueOrThrow({ where: { hblNo: "NNRMNLLAXF9500" } });
    expect(kept).toMatchObject({ jobNo: "EX-O-2601-0900", status: "DEPARTED", source: "IMPORT", assignedCsId: f.cs.id });
    expect(kept.requestedPickupAt?.toISOString()).toBe(fromManila(2026, 1, 10, 9).toISOString());
    expect(kept.createdAt.toISOString()).toBe(fromManila(2026, 1, 10, 9).toISOString()); // counts in its own month

    const lcl = await prisma.shipment.findFirstOrThrow({ where: { shipper: { name: "Mabuhay Exports Inc." } } });
    expect(lcl).toMatchObject({ cargoType: "LCL", lclQty: 6, lclUnit: "PALLET", assignedCsId: f.sup.id, status: "PICKUP_SCHEDULED" });
    expect(lcl.jobNo).toMatch(/^EX-O-2610-\d{4}$/);
    const ev = await prisma.milestoneEvent.findFirstOrThrow({ where: { shipmentId: lcl.id, type: "IMPORTED" } });
    expect(JSON.parse(ev.value!)).toMatchObject({ row: 3, legacyJobNo: "B-1234" });

    expect((await prisma.shipment.findUniqueOrThrow({ where: { hblNo: "NNRMNLPUSF9501" } })).status).toBe("CANCELLED");
    // Regression: the HBL generated for the LCL row must not take a number kept further down the file.
    expect(lcl.hblNo).not.toBe("NNRMNLPUSF9501");
    expect(lcl.hblNo).toMatch(/^NNRMNLSINL\d{4}$/); // generated: destination SIN, LCL
    expect(Number(lcl.hblNo!.slice(-4))).toBeGreaterThan(9501);
    // Counters moved past the kept numbers
    expect(await nextJobNo(prisma, fromManila(2026, 1, 20))).toBe("EX-O-2601-0901");
    expect(Number((await nextHblNo(prisma, "TYO", "FCL")).slice(-4))).toBeGreaterThan(9501);
  });

  it("re-importing the same file skips what is already there", async () => {
    const r = await runImport(prisma, file, { actor: { id: f.sup.id, role: "SUPERVISOR" }, now, dryRun: false, createMissingShippers: true, historyBefore: null });
    expect(r.imported).toBe(0);
    expect(r.skipped.map((s) => s.row)).toEqual([2, 3, 7]);
    expect(r.skipped[1].reason).toMatch(/B-1234 was already imported/);
  });

  it("produces an error workbook with the original values and an Error column", async () => {
    const r = await runImport(prisma, file, { actor: { id: f.sup.id, role: "SUPERVISOR" }, now, dryRun: true, createMissingShippers: true, historyBefore: null });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await errorsWorkbook(r)) as unknown as ExcelJS.Buffer);
    const ws = wb.worksheets[0];
    // Same layout as the upload (so it can be re-uploaded), with ERROR / ORIGINAL ROW at the end.
    expect(ws.getRow(1).getCell(1).value).toBe("Job No.");
    const errCol = (ws.getRow(1).values as unknown[]).indexOf("ERROR");
    expect(errCol).toBeGreaterThan(14);
    expect(ws.getRow(1).getCell(errCol + 1).value).toBe("ORIGINAL ROW");
    expect(ws.rowCount).toBe(5);
    expect(String(ws.getRow(2).getCell(errCol).value)).toMatch(/ambiguous/);
    expect(ws.getRow(2).getCell(errCol + 1).value).toBe(4);
  });

  it("treats a one-typo shipper name as the same shipper (listed), or reports it when merging is off", async () => {
    const typo = f.shipper.name.replace(/r/, "rr"); // e.g. "Shipper ab12" -> "Shiprper ab12"
    const file = await oneRow(["Shipper", "Destination", "Cargo"], [typo, "TOKYO", "1x20"]);
    const merged = await runImport(prisma, file, { actor: { id: f.sup.id, role: "SUPERVISOR" }, now, dryRun: true, createMissingShippers: true, historyBefore: null });
    expect(merged.errors).toEqual([]);
    expect(merged.createdShippers).toEqual([]);
    expect(merged.mergedShippers).toEqual([{ from: typo, to: f.shipper.name, rows: 1 }]);
    const strict = await runImport(prisma, file, { actor: { id: f.sup.id, role: "SUPERVISOR" }, now, dryRun: true, createMissingShippers: true, historyBefore: null, mergeSimilarShippers: false });
    expect(strict.errors[0]?.messages.join(" ")).toMatch(new RegExp(`did you mean "${f.shipper.name}"`));
    // Spacing and punctuation never make a different shipper.
    const spaced = await runImport(prisma, await oneRow(["Shipper", "Destination", "Cargo"], [f.shipper.name.toUpperCase().replace(" ", "  "), "TOKYO", "1x20"]), { actor: { id: f.sup.id, role: "SUPERVISOR" }, now, dryRun: true, createMissingShippers: true, historyBefore: null });
    expect(spaced.createdShippers).toEqual([]);
    expect(spaced.mergedShippers).toEqual([]);
  });

  it("stops early when required columns are missing", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("x").addRow(["Shipper", "Remarks"]);
    const r = await runImport(prisma, Buffer.from(await wb.xlsx.writeBuffer()), { actor: { id: f.sup.id, role: "SUPERVISOR" }, now, dryRun: false, createMissingShippers: true, historyBefore: null });
    expect(r.missingHeaders).toEqual(["Destination", "Cargo"]);
    expect(r.imported).toBe(0);
  });
});

describe("generated docs", () => {
  it("docs/process-map.md contains the same diagram the app renders", async () => {
    const { PROCESS_MERMAID } = await import("@/lib/process-map");
    const doc = readFileSync(path.resolve(__dirname, "../docs/process-map.md"), "utf8");
    expect(doc).toContain("```mermaid\n" + PROCESS_MERMAID + "\n```");
  });
});
