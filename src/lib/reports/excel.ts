import ExcelJS from "exceljs";
import type { CellValue, ExportShipment } from "../columns";
import { EXTRA_COLUMNS, SHEET_COLUMNS, SHEET_VALUE } from "../nnr-sheet";
import { formatDateTime, isManilaMidnight } from "../time";
import type { DailyReport } from "./daily";
import type { MonthlyReport } from "./monthly";

// Excel exports. Dates are real Excel date cells showing Manila wall-clock time:
// Excel has no time zones, so the instant is shifted by +8h before writing.

const MANILA_MS = 8 * 3_600_000;
const DATE_FMT = "dd-mmm-yyyy hh:mm";
const DAY_FMT = "dd-mmm-yyyy"; // date-only values (ETD, ETA, cut-off) are stored at 00:00 Manila
const fmtFor = (d: Date) => (isManilaMidnight(d) ? DAY_FMT : DATE_FMT);
const RED = "FFFDE2E2";
const DUE_TODAY = "FFFCA5A5"; // red: due today
const DUE_TOMORROW = "FFFED7AA"; // orange: due tomorrow
const HEADER = "FFE2E8F0";

const toCell = (v: CellValue) => (v instanceof Date ? new Date(v.getTime() + MANILA_MS) : v ?? "");

function table(
  ws: ExcelJS.Worksheet,
  columns: Array<{ header: string; width?: number }>,
  rows: CellValue[][],
  opts: { startRow?: number; fill?: string; rowFill?: (rowIndex: number) => string | undefined } = {},
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
      if (v instanceof Date) cell.numFmt = fmtFor(v);
      const fill = opts.rowFill?.(ri) ?? opts.fill;
      if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    });
  });
  return start + 1 + rows.length;
}

/**
 * "Raw data": the shipments laid out exactly like NNR's monitoring sheet (same three header rows,
 * same columns, same order), so current habits keep working; app-only columns follow after REMARKS.
 */
export function rawSheet(wb: ExcelJS.Workbook, shipments: ExportShipment[]) {
  const ws = wb.addWorksheet("Raw data", { views: [{ state: "frozen", ySplit: 3, xSplit: 1 }] });
  const n = SHEET_COLUMNS.length;
  const head = (r: number, c: number, text: string) => {
    const cell = ws.getRow(r).getCell(c);
    cell.value = text;
    cell.font = { bold: true };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER } };
  };
  SHEET_COLUMNS.forEach((c, i) => {
    for (let r = 1; r <= 3; r++) head(r, i + 1, c.header[r - 1]);
    ws.getColumn(i + 1).width = c.width;
  });
  // Merged headings as in the original: single-label columns span all three rows; groups span across.
  SHEET_COLUMNS.forEach((c, i) => {
    const [top, mid, bottom] = c.header;
    if (top && !mid && !bottom) ws.mergeCells(1, i + 1, 3, i + 1);
    else if (!top && mid && !bottom) ws.mergeCells(2, i + 1, 3, i + 1);
  });
  for (const [from, to] of [[9, 10], [14, 16], [17, 18], [21, 22]]) ws.mergeCells(1, from, 2, to);
  ws.mergeCells(1, 5, 1, 8);
  EXTRA_COLUMNS.forEach((c, i) => {
    const col = n + 2 + i; // one empty column after REMARKS
    head(1, col, c.header);
    ws.mergeCells(1, col, 3, col);
    ws.getColumn(col).width = c.width;
  });
  shipments.forEach((s, ri) => {
    const row = ws.getRow(4 + ri);
    const put = (col: number, v: CellValue) => {
      const cell = row.getCell(col);
      cell.value = toCell(v) as ExcelJS.CellValue;
      if (v instanceof Date) cell.numFmt = fmtFor(v);
    };
    SHEET_COLUMNS.forEach((c, i) => put(i + 1, SHEET_VALUE[c.key](s)));
    EXTRA_COLUMNS.forEach((c, i) => put(n + 2 + i, c.value(s)));
  });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + shipments.length, column: n } };
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
      rowFill: (ri) => (sec.items[ri].dueTag === "today" ? DUE_TODAY : sec.items[ri].dueTag === "tomorrow" ? DUE_TOMORROW : undefined),
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
    ["Arrastre payments made this month", r.payments.arrastrePaid],
    ["E-track payments made this month", r.payments.etrackPaid],
    ["Departed this month, E-track not paid", r.payments.etrackUnpaidDeparted],
  ], { startRow: 4 });

  const pay = wb.addWorksheet("Payments", { views: [{ state: "frozen", ySplit: 1 }] });
  table(pay, [{ header: "Paid", width: 18 }, { header: "Payment", width: 12 }, { header: "Job No.", width: 16 }, { header: "HBL No.", width: 20 }, { header: "Shipper", width: 30 }, { header: "CS", width: 16 }],
    r.payments.rows.map((p) => [p.paidAt, p.what, p.jobNo, p.hblNo ?? "", p.shipper, p.cs]));

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
