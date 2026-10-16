import { IMPORT_FIELDS, resolveHeaders, type ImportKey } from "./mapping";
import { cellText, ImportCellError, isDateRange, isNotApplicable, isShipperHandled, parseCargo, parseImportDate, parseSheetDate, type ParsedCargo } from "./parse";
import { SHEET_COLUMNS, type SheetKey } from "../nnr-sheet";
import { NNR_HBL_PARTS_RE } from "../numbering";

// Two spreadsheet layouts are accepted. Both are turned into the same ParsedRow:
//   - "nnr":      NNR's own monitoring sheet (3 header rows, fixed columns: src/lib/nnr-sheet.ts),
//                 also what the app's Excel "Raw data" sheet writes, so exports re-import.
//   - "template": one header row with named columns (docs/import.md, docs/import-template.xlsx).

export const DATE_KEYS = [
  "requestedPickup", "actualPickup", "fsiCutoff", "fsiSubmitted", "preadviseCutoff", "preadviseSent", "arrastreCutoff",
  "bocUploaded", "arrastrePaid", "docsSent", "docsToOverseas", "etd", "atd", "eta", "ata",
] as const;
export type DateKey = (typeof DATE_KEYS)[number];

export type ParsedRow = {
  row: number; // spreadsheet row number, for messages
  values: string[]; // original cells, for the "rows to fix" file
  errors: string[];
  jobNo: string | null;
  hblNo: string | null;
  directBl: boolean; // "DIRECT BL": shipped on the carrier's own BL, no NNR house BL
  partOf: string | null; // full HBL No. or just its running number ("8665")
  shipperName: string;
  consignee: string;
  destination: string;
  pod: string;
  podCode: string | null; // from the HBL No. when it has one
  cargo: ParsedCargo | null;
  carrier: string;
  bookingRef: string;
  remarks: string;
  csText: string;
  dates: Partial<Record<DateKey, Date | null>>;
  declarationStatus: "PENDING" | "FILED" | "ASSESSED" | "RELEASED";
  declarationAt: Date | null;
  declarationBy: "NNR" | "SHIPPER";
  declarationForwarder: string | null;
  arrastreBy: "NNR" | "SHIPPER" | null; // null: the shipper's default
  cancelled: boolean;
  closed: boolean;
  activityDate: Date | null; // when this booking happened (for the history cut-off)
};

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

export type Layout = { kind: "nnr"; dataStart: number; extras: Record<string, number> } | { kind: "template"; dataStart: number; map: Partial<Record<ImportKey, number>>; unknown: string[]; missing: string[] };

export function detectLayout(rows: unknown[][]): Layout {
  const first = (rows[0] ?? []).map(cellText);
  const looksNnr = norm(first[0] ?? "").startsWith("HBLNO") && first.some((h) => norm(h).includes("REQUESTEDPICKUP"));
  if (looksNnr) {
    // Our own exports add app columns after REMARKS (JOB NO., ASSIGNED CS, …); read them back if present.
    const extras: Record<string, number> = {};
    first.forEach((h, i) => {
      if (i >= SHEET_COLUMNS.length && h.trim()) extras[norm(h)] = i;
    });
    return { kind: "nnr", dataStart: 3, extras };
  }
  const { map, unknown, missingRequired } = resolveHeaders(first);
  return { kind: "template", dataStart: 1, map, unknown, missing: missingRequired };
}

const label = (k: ImportKey) => IMPORT_FIELDS.find((f) => f.key === k)!.headers[0];

function splitHbl(raw: string): { hblNo: string | null; partOf: string | null } {
  const s = raw.toUpperCase().trim();
  if (!s) return { hblNo: null, partOf: null };
  const m = /^([A-Z0-9-]+)\s*\/\s*PART\s*OF\s*([A-Z0-9-]+)\s*$/.exec(s);
  if (m) return { hblNo: m[1], partOf: m[2] };
  return { hblNo: s.replace(/\s+/g, ""), partOf: null };
}

const forwarder = (s: string) => /\(([^)]+)\)/.exec(s)?.[1]?.trim() ?? (/-\s*([A-Z]{2,})\s*$/.exec(s.toUpperCase())?.[1] ?? null);

function cargoFrom(fcl: string, lcl: string, hblLetter: string | null): { cargo: ParsedCargo | null; error: string | null; note: string | null } {
  const clean = (t: string) => (/^[-–]+$/.test(t.trim()) ? "" : t.trim());
  const f = clean(fcl);
  const l = clean(lcl);
  try {
    if (f && l && !/^LCL$/i.test(l)) return { cargo: null, error: "Cargo: both FCL containers and an LCL quantity are filled in", note: null };
    if (f) return { cargo: parseCargo(f), error: null, note: null };
    if (l) {
      if (/^LCL$/i.test(l)) return { cargo: null, error: "Cargo: LCL quantity missing (e.g. 3 PALLETS)", note: null };
      const c = parseCargo(/lcl/i.test(l) ? l : `LCL ${l}`);
      // "1 PALLET AND 9 CTS": the first quantity is used; keep the full text in remarks.
      const mixed = /\band\b|&|\+/i.test(l);
      return { cargo: c, error: null, note: mixed ? `LCL: ${l}` : null };
    }
    return { cargo: null, error: hblLetter ? `Cargo: no containers or LCL quantity (HBL says ${hblLetter === "F" ? "FCL" : "LCL"})` : "Cargo: no containers or LCL quantity", note: null };
  } catch (e) {
    return { cargo: null, error: `Cargo: ${(e as Error).message}`, note: null };
  }
}

/** One data row of NNR's monitoring sheet. `ref` is the running date used to give "04-Apr" its year. */
export function readNnrRow(values: unknown[], row: number, ref: Date, extras: Record<string, number>): ParsedRow {
  const at = (k: SheetKey) => values[SHEET_COLUMNS.findIndex((c) => c.key === k)];
  const text = (k: SheetKey) => cellText(at(k)).trim();
  const extra = (h: string) => (extras[norm(h)] !== undefined ? cellText(values[extras[norm(h)]]).trim() : "");
  const errors: string[] = [];

  const directBl = /^DIRECT\s*B\/?L$/i.test(text("hbl"));
  const { hblNo, partOf } = directBl ? { hblNo: null, partOf: null } : splitHbl(text("hbl"));
  const parts = hblNo ? NNR_HBL_PARTS_RE.exec(hblNo) : null;
  // Notes kept in remarks so nothing typed in the sheet is lost.
  const notes: string[] = [];
  if (directBl) notes.push("DIRECT BL (no NNR HBL)");
  for (const k of ["reqPickup", "bocUpload"] as const) {
    const t = text(k);
    if (isShipperHandled(t)) notes.push(`${k === "reqPickup" ? "Pick-up" : "BOC upload"}: c/o shipper`);
    if (isDateRange(t)) notes.push(`${k === "reqPickup" ? "Pick-up" : "BOC upload"}: ${t}`);
  }

  // Requested pick-up first: it anchors the year for the row's other dates.
  const dates: ParsedRow["dates"] = {};
  const date = (key: DateKey, k: SheetKey, anchor: Date) => {
    try {
      dates[key] = parseSheetDate(at(k), anchor);
    } catch (e) {
      errors.push(`${SHEET_COLUMNS.find((c) => c.key === k)!.header.filter(Boolean).join(" ")}: ${(e as Error).message}`);
    }
  };
  date("requestedPickup", "reqPickup", ref);
  const anchor = dates.requestedPickup ?? ref;
  date("actualPickup", "actualPickup", anchor);
  date("fsiCutoff", "fsiCutoff", anchor);
  date("preadviseCutoff", "preadviseCutoff", anchor);
  date("arrastreCutoff", "arrastreCutoff", anchor);
  date("bocUploaded", "bocUpload", anchor);
  date("arrastrePaid", "arrastrePaid", anchor);
  date("docsSent", "docsSent", anchor);
  date("docsToOverseas", "docsToOverseas", anchor);
  date("etd", "etd", anchor);
  date("atd", "atd", anchor);
  date("eta", "eta", dates.etd ?? anchor);
  date("ata", "ata", dates.atd ?? dates.etd ?? anchor);

  // Export declaration: the filing date sits under whoever handled it.
  let declarationBy: "NNR" | "SHIPPER" = "NNR";
  let declarationAt: Date | null = null;
  let declarationForwarder: string | null = null;
  for (const [k, by] of [["declShipper", "SHIPPER"], ["declNnr", "NNR"]] as const) {
    const t = text(k);
    if (!t || isNotApplicable(t)) continue;
    declarationBy = by;
    if (/C\/?O/i.test(t)) {
      if (by === "NNR") declarationForwarder = forwarder(t);
      continue;
    }
    try {
      declarationAt = parseSheetDate(at(k), anchor);
    } catch (e) {
      errors.push(`Export declaration c/o ${by === "NNR" ? "NNR" : "shipper"}: ${(e as Error).message}`);
    }
  }

  const arrastreNA = isNotApplicable(at("arrastreCutoff")) || isNotApplicable(at("arrastrePaid"));
  const { cargo, error: cargoError, note } = cargoFrom(text("fcl40") + (text("fcl20") && text("fcl20") !== "-" ? ` + ${text("fcl20")}` : ""), text("lcl"), parts?.[2] ?? null);
  if (cargoError) errors.push(cargoError);

  const remarks = [text("remarks"), note, ...notes].filter(Boolean).join("; ");
  const activityDate = [dates.atd, dates.etd, dates.actualPickup, dates.requestedPickup].find(Boolean) ?? null;
  return {
    row, values: values.map(cellText), errors,
    jobNo: extra("JOB NO.") || null, hblNo, directBl, partOf,
    shipperName: text("shipper").replace(/\s+/g, " "),
    consignee: extra("CONSIGNEE"),
    destination: text("destination").replace(/\s+/g, " ").replace(/,$/, ""),
    pod: extra("POD"),
    podCode: parts?.[1] ?? null,
    cargo, carrier: text("carrier"), bookingRef: text("booking"), remarks, csText: extra("CS EMAIL") || extra("ASSIGNED CS"),
    dates,
    declarationStatus: declarationAt ? "FILED" : "PENDING",
    declarationAt, declarationBy, declarationForwarder,
    arrastreBy: arrastreNA ? "SHIPPER" : dates.arrastreCutoff || dates.arrastrePaid ? "NNR" : null,
    cancelled: /CANCEL/i.test(remarks) || /^cancel/i.test(extra("STATUS")),
    closed: /^closed/i.test(extra("STATUS")),
    activityDate,
  };
}

/** One data row of the named-column template (docs/import.md). Dates must carry a year. */
export function readTemplateRow(values: unknown[], row: number, map: Partial<Record<ImportKey, number>>): ParsedRow {
  const raw = (k: ImportKey) => (map[k] === undefined ? undefined : values[map[k]!]);
  const text = (k: ImportKey) => cellText(raw(k)).trim();
  const errors: string[] = [];
  const dates: ParsedRow["dates"] = {};
  const TEMPLATE_DATES: Array<[DateKey, ImportKey]> = [
    ["requestedPickup", "requestedPickup"], ["actualPickup", "actualPickup"], ["fsiCutoff", "fsiCutoff"], ["fsiSubmitted", "fsiSubmitted"],
    ["preadviseCutoff", "preadviseCutoff"], ["preadviseSent", "preadviseSent"], ["arrastreCutoff", "arrastreCutoff"],
    ["bocUploaded", "bocUploaded"], ["arrastrePaid", "arrastrePaid"], ["docsSent", "docsSent"], ["etd", "etd"], ["atd", "atd"], ["eta", "eta"], ["ata", "ata"],
  ];
  for (const [d, k] of TEMPLATE_DATES) {
    try {
      dates[d] = parseImportDate(raw(k));
    } catch (e) {
      errors.push(`${label(k)}: ${(e as Error).message}`);
    }
  }
  let cargo: ParsedCargo | null = null;
  try {
    cargo = parseCargo(text("cargo"));
  } catch (e) {
    errors.push(`Cargo: ${(e as Error).message}`);
  }
  const decl = text("declaration").toUpperCase() || "PENDING";
  if (!["PENDING", "FILED", "ASSESSED", "RELEASED"].includes(decl)) errors.push(`Export Declaration "${text("declaration")}" must be PENDING, FILED, ASSESSED or RELEASED`);
  const arr = text("arrastreBy").toUpperCase();
  const arrastreBy = !arr ? null : arr.startsWith("NNR") ? "NNR" : arr.startsWith("SHIP") ? "SHIPPER" : undefined;
  if (arrastreBy === undefined) errors.push(`Arrastre By "${text("arrastreBy")}" must be NNR or SHIPPER`);
  const status = text("status").toLowerCase();
  const { hblNo, partOf } = splitHbl(text("hblNo"));
  return {
    row, values: values.map(cellText), errors,
    jobNo: text("jobNo").toUpperCase() || null, hblNo, directBl: false, partOf,
    shipperName: text("shipper"), consignee: text("consignee"), destination: text("destination"), pod: text("pod"),
    podCode: hblNo ? NNR_HBL_PARTS_RE.exec(hblNo)?.[1] ?? null : null,
    cargo, carrier: text("carrier"), bookingRef: text("bookingRef"), remarks: text("remarks"), csText: text("cs"),
    dates,
    declarationStatus: (["PENDING", "FILED", "ASSESSED", "RELEASED"].includes(decl) ? decl : "PENDING") as ParsedRow["declarationStatus"],
    declarationAt: null, declarationBy: "NNR", declarationForwarder: null,
    arrastreBy: arrastreBy ?? null,
    cancelled: status.startsWith("cancel"),
    closed: status.startsWith("close"),
    activityDate: [dates.atd, dates.etd, dates.actualPickup, dates.requestedPickup].find(Boolean) ?? null,
  };
}

export { ImportCellError };
