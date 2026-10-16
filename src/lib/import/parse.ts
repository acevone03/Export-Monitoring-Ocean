import { fromManila } from "../time";

// Cell parsers for the spreadsheet import. All return null for blank cells and throw ImportCellError
// with a message meant for the person fixing the spreadsheet.

export class ImportCellError extends Error {}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MANILA_MS = 8 * 3_600_000;

/** exceljs cell value -> plain text (rich text, formulas, hyperlinks unwrapped). */
export function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as Array<{ text: string }>).map((r) => r.text).join("").trim();
    if ("result" in o) return cellText(o.result);
    if ("text" in o) return cellText(o.text);
    return "";
  }
  return String(v).trim();
}

/**
 * Date/time cell -> UTC instant, reading wall-clock values as Asia/Manila.
 * Accepts real Excel date cells, Excel serial numbers, DD-MMM-YYYY [HH:mm] and YYYY-MM-DD [HH:mm].
 * Slash dates like 10/11/2026 are refused: day/month order cannot be known.
 */
export function parseImportDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "object" && !(v instanceof Date) && "result" in (v as object)) return parseImportDate((v as { result: unknown }).result);
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new ImportCellError("not a valid date");
    // Excel stores wall-clock time without a zone; exceljs hands it over as if it were UTC.
    return new Date(v.getTime() - MANILA_MS);
  }
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) throw new ImportCellError(`"${v}" is not a date`);
    const ms = Math.round((v - 25569) * 86_400_000); // Excel serial -> wall clock as UTC
    return new Date(ms - MANILA_MS);
  }
  const s = cellText(v);
  if (!s) return null;
  let m = /^(\d{1,2})[-\s]([A-Za-z]{3,4})[-\s](\d{4})(?:[ T,]+(\d{1,2}):(\d{2}))?$/.exec(s);
  if (m) {
    const month = MONTHS[m[2].toLowerCase()];
    if (!month) throw new ImportCellError(`unknown month in "${s}"`);
    return checked(+m[3], month, +m[1], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, s);
  }
  m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(s);
  if (m) return checked(+m[1], +m[2], +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0, s);
  if (/^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}/.test(s)) throw new ImportCellError(`"${s}" is ambiguous (day/month order); use 16-Oct-2026 or 2026-10-16`);
  throw new ImportCellError(`"${s}" is not a date; use 16-Oct-2026 09:00 or 2026-10-16 09:00`);
}

function checked(y: number, mo: number, d: number, h: number, mi: number, raw: string): Date {
  const date = fromManila(y, mo, d, h, mi);
  const back = new Date(date.getTime() + MANILA_MS);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() + 1 !== mo || back.getUTCDate() !== d || h > 23 || mi > 59) {
    throw new ImportCellError(`"${raw}" is not a real date`);
  }
  return date;
}

export type ParsedCargo =
  | { cargoType: "FCL"; containerPlan: Array<{ size: "20" | "40" | "40HC"; qty: number }> }
  | { cargoType: "LCL"; lclQty: number; lclUnit: "PALLET" | "BOX" };

/** "FCL 2x40HC + 1x20", "2 X 40'HQ", "LCL 6 PALLET", "6 plts", "30 ctns". */
export function parseCargo(raw: string): ParsedCargo {
  const s = raw.trim();
  if (!s) throw new ImportCellError("cargo is empty");
  const lcl = /(\d+)\s*(pallets?|plts?|pallet|box(?:es)?|cartons?|ctns?|cases?|pkgs?|packages?)\b/i.exec(s);
  if (/\blcl\b/i.test(s) || (lcl && !/\d\s*[x×*]\s*\d/i.test(s))) {
    if (!lcl) throw new ImportCellError(`LCL cargo "${s}" needs a quantity and unit, e.g. "LCL 6 PALLET"`);
    const unit = /^(pallets?|plts?|pallet)$/i.test(lcl[2]) ? "PALLET" : "BOX";
    return { cargoType: "LCL", lclQty: Number(lcl[1]), lclUnit: unit };
  }
  const plan = new Map<"20" | "40" | "40HC", number>();
  const re = /(\d+)\s*[x×X*]\s*(20|40|45)\s*'?\s*(HC|HQ|GP|DC|DV|ST)?/gi;
  let m: RegExpExecArray | null;
  let found = false;
  while ((m = re.exec(s))) {
    found = true;
    if (m[2] === "45") throw new ImportCellError(`45' containers are not supported ("${s}")`);
    const size = m[2] === "20" ? "20" : m[3] && /^(HC|HQ)$/i.test(m[3]) ? "40HC" : "40";
    plan.set(size, (plan.get(size) ?? 0) + Number(m[1]));
  }
  if (!found) throw new ImportCellError(`cannot read cargo "${s}"; use e.g. "2x40HC + 1x20" or "LCL 6 PALLET"`);
  return { cargoType: "FCL", containerPlan: [...plan.entries()].map(([size, qty]) => ({ size, qty })) };
}
