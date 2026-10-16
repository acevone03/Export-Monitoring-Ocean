import ExcelJS from "exceljs";
import { RAW_COLUMNS, type CellValue, type ExportShipment } from "../columns";
import { formatDateTime } from "../time";
import type { DailyReport } from "./daily";
import type { MonthlyReport } from "./monthly";

// Excel exports. Dates are real Excel date cells showing Manila wall-clock time:
// Excel has no time zones, so the instant is shifted by +8h before writing.

const MANILA_MS = 8 * 3_600_000;
const DATE_FMT = "dd-mmm-yyyy hh:mm";
const RED = "FFFDE2E2";
const HEADER = "FFE2E8F0";

const toCell = (v: CellValue) => (v instanceof Date ? new Date(v.getTime() + MANILA_MS) : v ?? "");

function table(
  ws: ExcelJS.Worksheet,
  columns: Array<{ header: string; width?: number }>,
  rows: CellValue[][],
  opts: { startRow?: number; fill?: string } = {},
) {
  const start = opts.startRow ?? 1;
  const header = ws.getRow(start);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.header;
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER } };
    const col = ws.getColumn(i + 1);
    col.width = Math.max(col.width ?? 0, c.width ?? 18);
  });
  rows.forEach((r, ri) => {
    const row = ws.getRow(start + 1 + ri);
    r.forEach((v, ci) => {
      const cell = row.getCell(ci + 1);
      cell.value = toCell(v) as ExcelJS.CellValue;
      if (v instanceof Date) cell.numFmt = DATE_FMT;
      if (opts.fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } };
    });
  });
  return start + 1 + rows.length;
}

function rawSheet(wb: ExcelJS.Workbook, shipments: ExportShipment[]) {
  const ws = wb.addWorksheet("Raw data", { views: [{ state: "frozen", ySplit: 1, xSplit: 1 }] });
  table(ws, RAW_COLUMNS, shipments.map((s) => RAW_COLUMNS.map((c) => c.value(s))));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: RAW_COLUMNS.length } };
}

function titleRow(ws: ExcelJS.Worksheet, text: string, sub: string) {
  ws.getCell("A1").value = text;
  ws.getCell("A1").font = { bold: true, size: 14 };
  ws.getCell("A2").value = sub;
  ws.getCell("A2").font = { italic: true, color: { argb: "FF64748B" } };
}

export async function dailyWorkbook(report: DailyReport, shipments: ExportShipment[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "NNR Export Monitor";
  const ws = wb.addWorksheet("Daily report", { views: [{ state: "frozen", ySplit: 2 }] });
  titleRow(ws, `NNR daily export report: ${report.date}`, `Generated ${formatDateTime(report.generatedAt)} (Asia/Manila)`);
  const cols = [
    { header: "Job No.", width: 16 }, { header: "Shipper", width: 30 }, { header: "Item", width: 34 },
    { header: "Due / time", width: 18 }, { header: "Done", width: 18 }, { header: "Details", width: 40 }, { header: "CS", width: 16 },
  ];
  let row = 4;
  for (const sec of report.sections) {
    const t = ws.getCell(`A${row}`);
    t.value = `${sec.title} (${sec.items.length})`;
    t.font = { bold: true, size: 12, color: sec.tone === "red" ? { argb: "FFB91C1C" } : undefined };
    row++;
    if (sec.items.length === 0) {
      ws.getCell(`A${row}`).value = "None";
      row += 2;
      continue;
    }
    row = table(ws, cols, sec.items.map((i) => [i.jobNo, i.shipper, i.what, i.at, i.doneAt, i.detail ?? "", i.cs]), {
      startRow: row,
      fill: sec.tone === "red" ? RED : undefined,
    }) + 1;
  }
  rawSheet(wb, shipments);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function monthlyWorkbook(r: MonthlyReport, shipments: ExportShipment[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "NNR Export Monitor";
  const sub = `Generated ${formatDateTime(r.generatedAt)} (Asia/Manila)`;

  const sum = wb.addWorksheet("Summary");
  titleRow(sum, `NNR monthly export report: ${r.label}`, sub);
  const containers = Object.entries(r.totals.containers).map(([k, v]) => `${v}x${k}`).join(", ") || "—";
  table(sum, [{ header: "Metric", width: 40 }, { header: "Value", width: 24 }], [
    ["Shipments (excl. cancelled)", r.totals.shipments],
    ["Cancelled", r.totals.cancelled],
    ["FCL shipments", r.totals.fcl],
    ["LCL shipments", r.totals.lcl],
    ["FCL containers", containers],
    ["Average pick-up delay (hours, actual − requested)", r.pickupDelay.avgHours ?? "—"],
    ["  based on pick-ups", r.pickupDelay.count],
    ["Average pick-up to ATD (hours)", r.pickupToAtd.avgHours ?? "—"],
    ["  based on departures", r.pickupToAtd.count],
    ["Arrastre paid on time", r.arrastre.onTime],
    ["Arrastre paid late", r.arrastre.late],
    ["Arrastre unpaid and overdue", r.arrastre.unpaidOverdue],
  ], { startRow: 4 });

  const ot = wb.addWorksheet("On-time rate");
  table(ot, [{ header: "Deadline", width: 24 }, { header: "On time" }, { header: "Late" }, { header: "Open & overdue" }, { header: "Total" }, { header: "On-time %" }],
    r.onTime.map((o) => [o.deadline, o.onTime, o.late, o.openOverdue, o.total, o.rate ?? "—"]));

  const missed = wb.addWorksheet("Missed deadlines", { views: [{ state: "frozen", ySplit: 1 }] });
  table(missed, [{ header: "Job No.", width: 16 }, { header: "Shipper", width: 30 }, { header: "CS", width: 16 }, { header: "Deadline", width: 22 }, { header: "Due" }, { header: "Done" }, { header: "Hours late" }],
    r.missed.map((m) => [m.jobNo, m.shipper, m.cs, m.deadline, m.dueAt, m.doneAt, m.lateHours ?? "still open"]));

  const by = wb.addWorksheet("Missed by CS & shipper");
  let next = table(by, [{ header: "CS", width: 24 }, { header: "Missed" }], r.missedByCs.map((x) => [x.key, x.count]));
  table(by, [{ header: "Shipper", width: 30 }, { header: "Missed" }], r.missedByShipper.map((x) => [x.key, x.count]), { startRow: next + 1 });

  const vol = wb.addWorksheet("Volume");
  next = table(vol, [{ header: "Destination", width: 26 }, { header: "Shipments" }], r.byDestination.map((x) => [x.key, x.count]));
  table(vol, [{ header: "Shipper", width: 30 }, { header: "Shipments" }], r.byShipper.map((x) => [x.key, x.count]), { startRow: next + 1 });

  rawSheet(wb, shipments);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
