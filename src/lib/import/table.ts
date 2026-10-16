import ExcelJS from "exceljs";
import { ImportCellError } from "./parse";

/** First worksheet of an .xlsx, or a .csv, as rows of raw cell values (header rows included). */
export async function readTable(buffer: Buffer, fileName = "file.xlsx"): Promise<unknown[][]> {
  if (/\.csv$/i.test(fileName)) return parseCsv(buffer.toString("utf8").replace(/^﻿/, ""));
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new ImportCellError("Could not read the file. Save it as Excel Workbook (.xlsx) or CSV.");
  }
  const ws = wb.worksheets[0];
  if (!ws) throw new ImportCellError("The file has no worksheet.");
  const width = ws.columnCount;
  const rows: unknown[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    rows.push(Array.from({ length: width }, (_, i) => row.getCell(i + 1).value));
  }
  return rows;
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
