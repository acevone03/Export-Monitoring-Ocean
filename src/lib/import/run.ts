import ExcelJS from "exceljs";
import { Prisma, type PrismaClient, type Role } from "@prisma/client";
import { ShipmentInputSchema } from "../shipment-input";
import { toManilaInput, formatDateTime, fromManila, DAY } from "../time";
import { deriveStatus } from "../status";
import { computeCachedDeadlines, DEFAULT_RULES } from "../deadlines";
import { HBL_COUNTER_KEY, NNR_HBL_PARTS_RE, nextHblNo, nextJobNo } from "../numbering";
import { EVENT } from "../milestones";
import { normalizeName } from "../intake/to-form";
import { podCodeFor } from "../pod-codes";
import { cellText, ImportCellError } from "./parse";
import { readTable } from "./table";
import { detectLayout, readNnrRow, readTemplateRow, type ParsedRow } from "./rows";

// One-time import of the existing monitoring spreadsheet (spec 10.4).
// Reads NNR's own monitoring sheet (CSV or Excel, auto-detected) or the named-column template.
// Valid rows are imported; invalid rows are returned as an error list (and an Excel file with an
// "Error" column) for correction and re-upload. Rows already imported (same HBL No., Job No. or
// old booking no.) are skipped, so re-uploading is safe. Rows older than the history cut-off are
// imported as closed history: counted in volume reports, never alerting.

export type ImportActor = { id: string; role: Role };
export type RowError = { row: number; messages: string[]; values: string[] };
export type ImportResult = {
  dryRun: boolean;
  layout: "nnr" | "template";
  headers: string[];
  headerRows: string[][]; // the file's header row(s), repeated in the "rows to fix" file
  unknownHeaders: string[];
  missingHeaders: string[];
  total: number;
  imported: number;
  history: number;
  cancelled: number;
  skipped: Array<{ row: number; reason: string }>;
  errors: RowError[];
  createdShippers: string[];
  /** Near-identical shipper names treated as one shipper (typos), for the supervisor to check. */
  mergedShippers: Array<{ from: string; to: string; rows: number }>;
  /** Year given to the first dated row of an NNR sheet (dates there have no year). */
  startYear: number | null;
  importedJobNos: string[];
};

export type ImportOptions = {
  actor: ImportActor;
  now: Date;
  dryRun: boolean;
  createMissingShippers: boolean;
  fileName?: string;
  /** Rows whose booking happened before this are imported as closed history. null: none. Default: 30 days ago. */
  historyBefore?: Date | null;
  /** Year of the first rows when the sheet's dates have no year ("04-Apr"). Default: year of `now`. */
  startYear?: number;
  /** Treat shipper names one typo apart ("ACME TRADNG" / "ACME TRADING") as the same shipper. Default: true. */
  mergeSimilarShippers?: boolean;
};

export const MAX_IMPORT_ROWS = 5000;
const JOB_RE = /^EX-O-(\d{2})(\d{2})-(\d{4})$/;
const PLACEHOLDER_ID = "00000000-0000-4000-8000-000000000000";

type Prepared = {
  row: number;
  jobNo: string | null;
  hblNo: string | null;
  directBl: boolean;
  partOf: string | null;
  fingerprint: string; // for rows with no number: shipper|destination|pick-up|cargo
  shipperName: string;
  shipperId: string | null; // null: to be created
  createdAt: Date;
  data: Omit<Prisma.ShipmentUncheckedCreateInput, "jobNo" | "shipperId" | "createdById" | "createdAt">;
};

/** Edit distance with transpositions, for spotting shipper typos ("ACME TRADNG", "OINICS" for "IONICS"). */
function distance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return d[a.length][b.length];
}

const yearOf = (p: ParsedRow | undefined) => {
  const d = p?.dates.requestedPickup ?? p?.dates.etd;
  return d ? new Date(d.getTime() + 8 * 3_600_000).getUTCFullYear() : null;
};

/** Shipper name key ignoring case, punctuation, spaces and Inc/Corp/Co: "FOODFLOW INC" = "Food Flow". */
const shipperKey = (name: string) => normalizeName(name).replace(/[^a-z0-9]/g, "");

export async function runImport(db: PrismaClient, buffer: Buffer, opts: ImportOptions): Promise<ImportResult> {
  const table = await readTable(buffer, opts.fileName);
  const layout = detectLayout(table);
  const headers = (table[0] ?? []).map(cellText);
  const result: ImportResult = {
    dryRun: opts.dryRun, layout: layout.kind, headers,
    headerRows: table.slice(0, layout.dataStart).map((r) => r.map(cellText)),
    unknownHeaders: layout.kind === "template" ? layout.unknown : [],
    missingHeaders: layout.kind === "template" ? layout.missing : [],
    total: 0, imported: 0, history: 0, cancelled: 0, skipped: [], errors: [], createdShippers: [], mergedShippers: [], startYear: null, importedJobNos: [],
  };
  if (result.missingHeaders.length) return result;

  const dataRows = table
    .slice(layout.dataStart)
    .map((values, i) => ({ row: i + layout.dataStart + 1, values }))
    .filter((r) => r.values.some((v) => cellText(v) !== ""));
  if (dataRows.length > MAX_IMPORT_ROWS) {
    result.errors.push({ row: 0, messages: [`Too many rows (${dataRows.length}); import at most ${MAX_IMPORT_ROWS} per file.`], values: [] });
    return result;
  }
  result.total = dataRows.length;

  // ---------- read every row
  // Sheets type dates without a year ("04-Apr") in booking order. Each row's year follows from the
  // previous rows; the start year is chosen so the latest bookings land near today (unless given).
  const readAll = (year: number): ParsedRow[] => {
    let ref = fromManila(year, 1, 1);
    let refSet = false;
    const out: ParsedRow[] = [];
    for (const { row, values } of dataRows) {
      if (layout.kind !== "nnr") {
        out.push(readTemplateRow(values, row, layout.map));
        continue;
      }
      let p = readNnrRow(values, row, ref, layout.extras);
      const anchor = p.dates.requestedPickup ?? p.dates.etd;
      if (anchor && !refSet) {
        // First dated row: put it in the start year, then re-read so the row's other dates follow it.
        ref = fromManila(year, 1, 1);
        p = readNnrRow(values, row, ref, layout.extras);
        refSet = true;
      }
      const a2 = p.dates.requestedPickup ?? p.dates.etd;
      if (a2) ref = a2;
      p.activityDate ??= ref;
      out.push(p);
    }
    return out;
  };
  const thisYear = new Date(opts.now.getTime() + 8 * 3_600_000).getUTCFullYear();
  let parsed = readAll(opts.startYear ?? thisYear);
  if (opts.startYear === undefined && layout.kind === "nnr") {
    // Bookings far in the future? Then the sheet started a year earlier (it is in booking order).
    const latest = (rows: ParsedRow[]) => Math.max(0, ...rows.map((p) => (p.dates.requestedPickup ?? p.dates.etd)?.getTime() ?? 0));
    for (let year = thisYear - 1; year >= thisYear - 3; year--) {
      if (latest(parsed) <= opts.now.getTime() + 120 * DAY) break;
      parsed = readAll(year);
    }
  }
  result.startYear = parsed.length && layout.kind === "nnr" ? yearOf(parsed.find((p) => p.dates.requestedPickup || p.dates.etd)) : null;

  // ---------- validate and prepare
  const shippers = await db.shipper.findMany({ select: { id: true, name: true, defaultArrastre: true } });
  const users = await db.user.findMany({ where: { active: true, role: { in: ["CS", "SUPERVISOR"] } }, select: { id: true, name: true, email: true } });
  const ruleRows = await db.deadlineRule.findMany();
  const rules = ruleRows.length ? ruleRows : DEFAULT_RULES;
  const historyBefore = opts.historyBefore === undefined ? new Date(opts.now.getTime() - 30 * DAY) : opts.historyBefore;
  const newShipperNames = new Map<string, string>(); // shipperKey -> name as first written, for shippers to be created
  const shipperByKey = new Map(shippers.map((x) => [shipperKey(x.name), x] as const));
  const merged = new Map<string, { from: string; to: string; rows: number }>();
  const mergeSimilar = opts.mergeSimilarShippers ?? true;
  // Spelling to use for each name in the file: an existing shipper if one is the same or one typo
  // away; otherwise the most-used spelling among names one typo apart.
  const counts = new Map<string, { name: string; n: number }>();
  for (const p of parsed) {
    const k = shipperKey(p.shipperName);
    if (!k) continue;
    const c = counts.get(k) ?? { name: p.shipperName, n: 0 };
    c.n++;
    counts.set(k, c);
  }
  const canonical = new Map<string, { key: string; name: string; existing: boolean }>();
  const reps: Array<{ key: string; name: string; existing: boolean }> = [...shipperByKey.entries()].map(([k, x]) => ({ key: k, name: x.name, existing: true }));
  for (const [k, c] of [...counts.entries()].sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))) {
    const near = k.length >= 5 ? reps.find((r) => r.key !== k && distance(r.key, k) <= 1) : undefined;
    const rep = reps.find((r) => r.key === k) ?? (mergeSimilar ? near : undefined);
    if (!rep && near && !mergeSimilar) continue; // reported as "did you mean" below
    if (rep) canonical.set(k, rep);
    else {
      const own = { key: k, name: c.name, existing: false };
      reps.push(own);
      canonical.set(k, own);
    }
  }
  const seenHbl = new Set<string>();
  const seenJob = new Set<string>();
  const prepared: Prepared[] = [];

  for (const p of parsed) {
    const errors = [...p.errors];

    // Shipper: same name ignoring spacing/punctuation; one typo away is merged into the main
    // spelling (option, listed for review) or reported; anything else is a new shipper (option).
    const key = shipperKey(p.shipperName);
    const rep = key ? canonical.get(key) : undefined;
    let shipperName = p.shipperName;
    let shipper: (typeof shippers)[number] | null = null;
    if (!p.shipperName) errors.push("Shipper is empty");
    else if (rep) {
      shipperName = rep.name;
      shipper = rep.existing ? shipperByKey.get(rep.key) ?? null : null;
      if (rep.key !== key) {
        const id = `${p.shipperName}→${rep.name}`;
        const m = merged.get(id) ?? { from: p.shipperName, to: rep.name, rows: 0 };
        m.rows++;
        merged.set(id, m);
      }
      if (!shipper && !opts.createMissingShippers) errors.push(`Shipper "${p.shipperName}" is not in the shipper list`);
    } else if (mergeSimilar === false) {
      const near = [...shipperByKey.values()].find((x) => key.length >= 5 && distance(shipperKey(x.name), key) <= 1);
      errors.push(near ? `Shipper "${p.shipperName}" is not an exact match; did you mean "${near.name}"?` : `Shipper "${p.shipperName}" is not in the shipper list`);
    }

    // Assigned CS: email is unique; a shared name is refused. Blank: the importer.
    const csText = p.csText.toLowerCase();
    const byEmail = csText ? users.find((u) => u.email.toLowerCase() === csText) : undefined;
    const byName = csText && !byEmail ? users.filter((u) => u.name.toLowerCase() === csText) : [];
    const cs = !csText ? users.find((u) => u.id === opts.actor.id) : byEmail ?? (byName.length === 1 ? byName[0] : undefined);
    if (!cs) {
      errors.push(
        !csText ? "No assigned CS and the importer is not a CS/supervisor"
        : byName.length > 1 ? `Assigned CS "${p.csText}" matches ${byName.length} users; use their email instead`
        : `Assigned CS "${p.csText}" is not an active CS or supervisor`,
      );
    }

    // Numbers
    if (p.hblNo && !/^[A-Z0-9-]{4,30}$/.test(p.hblNo)) errors.push(`HBL No. "${p.hblNo}" may only contain letters, digits and dashes`);
    if (p.hblNo && seenHbl.has(p.hblNo)) errors.push(`HBL No. ${p.hblNo} appears twice in this file`);
    if (p.jobNo && JOB_RE.test(p.jobNo) && seenJob.has(p.jobNo)) errors.push(`Job No. ${p.jobNo} appears twice in this file`);

    const arrastre = p.arrastreBy ?? shipper?.defaultArrastre ?? "NNR";
    const destination = p.destination;
    const pod = p.pod || destination;
    // Direct-BL rows get no NNR HBL, so their destination code is not needed (placeholder for validation).
    const podCode = p.podCode ?? podCodeFor(pod) ?? podCodeFor(destination) ?? (p.directBl ? "DBL" : "");
    const d = p.dates;

    // Same rules as the shipment form
    const form = ShipmentInputSchema.safeParse({
      shipperId: shipper?.id ?? PLACEHOLDER_ID,
      consigneeName: p.consignee,
      destinationPort: destination,
      pod,
      cargoType: p.cargo?.cargoType ?? "FCL",
      containerPlan: JSON.stringify(p.cargo?.cargoType === "FCL" ? p.cargo.containerPlan : [{ size: "20", qty: 1 }]),
      lclQty: p.cargo?.cargoType === "LCL" ? String(p.cargo.lclQty) : "",
      lclUnit: p.cargo?.cargoType === "LCL" ? p.cargo.lclUnit : "",
      requestedPickupAt: toManilaInput(d.requestedPickup ?? null),
      fsiCutoffAt: toManilaInput(d.fsiCutoff ?? null),
      preadviseCutoffAt: toManilaInput(d.preadviseCutoff ?? null),
      arrastreCutoffAt: toManilaInput(arrastre === "NNR" ? d.arrastreCutoff ?? null : null),
      etdMnl: toManilaInput(d.etd ?? null),
      eta: toManilaInput(d.eta ?? null),
      arrastreResponsibility: arrastre,
      carrierName: p.carrier,
      carrierBookingRef: p.bookingRef,
      carrierRemarks: p.remarks,
      assignedCsId: cs?.id ?? PLACEHOLDER_ID,
      podCode,
      declarationBy: p.declarationBy,
      declarationBroker: p.declarationBroker ?? "",
      partOfHblNo: "",
    });
    if (!form.success) for (const i of form.error.issues) errors.push(`${String(i.path[0] ?? "Row")}: ${i.message}`);
    if (d.ata && !d.atd) errors.push("ATA is set but ATD is empty");
    if (d.ata && d.atd && d.ata <= d.atd) errors.push("ATA must be after ATD");
    if (d.arrastrePaid && arrastre === "SHIPPER") errors.push("Arrastre Paid is set but arrastre is paid by the shipper");

    if (errors.length || !form.success || !p.cargo || !cs) {
      result.errors.push({ row: p.row, messages: errors.length ? errors : ["Row could not be read"], values: p.values });
      continue;
    }
    const f = form.data;
    if (!shipper && !newShipperNames.has(shipperKey(shipperName))) newShipperNames.set(shipperKey(shipperName), shipperName);
    if (p.hblNo) seenHbl.add(p.hblNo);
    if (p.jobNo) seenJob.add(p.jobNo);

    const isHistory = !!historyBefore && !!p.activityDate && p.activityDate < historyBefore && !p.cancelled;
    const createdAt = [d.requestedPickup, d.etd, d.fsiCutoff].filter((x): x is Date => !!x).sort((a, b) => a.getTime() - b.getTime())[0] ?? p.activityDate ?? opts.now;
    if (isHistory) result.history++;
    if (p.cancelled) result.cancelled++;
    prepared.push({
      row: p.row, jobNo: p.jobNo, hblNo: p.hblNo, directBl: p.directBl, partOf: p.partOf, shipperName, shipperId: shipper?.id ?? null, createdAt,
      fingerprint: [shipperKey(shipperName), destination.toUpperCase(), d.requestedPickup?.toISOString() ?? "", JSON.stringify(p.cargo)].join("|"),
      data: {
        consigneeName: f.consigneeName, destinationPort: f.destinationPort, pod: f.pod, podCode: p.directBl ? null : f.podCode, cargoType: f.cargoType,
        containerPlan: f.containerPlan.length ? f.containerPlan : Prisma.DbNull, lclQty: f.lclQty, lclUnit: f.lclUnit,
        requestedPickupAt: f.requestedPickupAt, actualPickupAt: d.actualPickup ?? null,
        fsiCutoffAt: f.fsiCutoffAt, fsiSubmittedAt: d.fsiSubmitted ?? null,
        preadviseCutoffAt: f.preadviseCutoffAt, preadviseSentAt: d.preadviseSent ?? null,
        arrastreResponsibility: f.arrastreResponsibility, arrastreCutoffAt: f.arrastreCutoffAt,
        declarationBy: f.declarationBy, declarationBroker: f.declarationBroker,
        exportDeclarationStatus: p.declarationStatus,
        exportDeclarationUpdatedAt: p.declarationStatus === "PENDING" ? null : p.declarationAt ?? opts.now,
        bocUploadAt: d.bocUploaded ?? null, arrastrePaidAt: d.arrastrePaid ?? null,
        exportDocsSentAt: d.docsSent ?? null, exportDocsToCarrierAt: d.docsToCarrier ?? null,
        carrierName: f.carrierName, carrierBookingRef: f.carrierBookingRef, carrierRemarks: f.carrierRemarks,
        etdMnl: f.etdMnl, atdMnl: d.atd ?? null, eta: f.eta, ata: d.ata ?? null,
        cancelledAt: p.cancelled ? opts.now : null,
        cancelReason: p.cancelled ? "Imported as cancelled" : null,
        closedAt: p.closed || isHistory ? opts.now : null,
        importedAsHistory: isHistory,
        assignedCsId: f.assignedCsId, source: "IMPORT",
      },
    });
  }

  result.createdShippers = [...newShipperNames.values()];
  result.mergedShippers = [...merged.values()];
  if (opts.dryRun) {
    result.imported = prepared.length;
    return result;
  }

  // ---------- write
  const shipperIds = new Map<string, string>();
  for (const [k, name] of newShipperNames) {
    const s = await db.shipper.upsert({ where: { name }, create: { name }, update: {} });
    shipperIds.set(k, s.id);
  }
  // Move the counters past every number kept from the file BEFORE generating new ones,
  // so a number generated for an early row cannot collide with one kept further down.
  // Every row counts, including rows with errors: their numbers exist and will be re-imported once fixed.
  await db.$transaction(async (tx) => {
    for (const p of parsed) await bumpCounters(tx, p.jobNo ?? "", p.hblNo ?? "");
  });
  // "PART OF 8665": resolve the running number to the full HBL No. from the file or the database.
  const byNumber = new Map<string, string>();
  for (const p of prepared) {
    const m = p.hblNo ? NNR_HBL_PARTS_RE.exec(p.hblNo) : null;
    if (m) byNumber.set(String(Number(m[3])), p.hblNo!);
  }

  let imported = 0;
  for (const p of prepared) {
    const outcome = await db.$transaction(async (tx) => {
      if (p.hblNo && (await tx.shipment.findUnique({ where: { hblNo: p.hblNo } }))) return `HBL No. ${p.hblNo} already exists (already imported?)`;
      const keepJob = p.jobNo && JOB_RE.test(p.jobNo) && !(await tx.shipment.findUnique({ where: { jobNo: p.jobNo } }));
      if (p.jobNo && JOB_RE.test(p.jobNo) && !keepJob) return `Job No. ${p.jobNo} already exists (already imported?)`;
      // Rows with no HBL and no Job No. (e.g. DIRECT BL) are recognised by what they contain.
      if (!p.hblNo && !p.jobNo) {
        const prior = await tx.milestoneEvent.findFirst({ where: { type: EVENT.IMPORTED, value: { contains: `"fingerprint":${JSON.stringify(p.fingerprint)}` } } });
        if (prior) return "Same shipment (shipper, destination, pick-up, cargo) was already imported";
      }
      if (p.jobNo && !JOB_RE.test(p.jobNo)) {
        const prior = await tx.milestoneEvent.findFirst({ where: { type: EVENT.IMPORTED, value: { contains: `"legacyJobNo":${JSON.stringify(p.jobNo)}` } } });
        if (prior) return `Old booking no. ${p.jobNo} was already imported`;
      }

      const jobNo = keepJob ? p.jobNo! : await nextJobNo(tx, p.createdAt);
      const hblNo = p.directBl ? null : p.hblNo ?? (await nextHblNo(tx, p.data.podCode as string, p.data.cargoType as "FCL" | "LCL"));
      let partOfHblNo: string | null = null;
      if (p.partOf) {
        partOfHblNo = /^\d+$/.test(p.partOf)
          ? byNumber.get(String(Number(p.partOf))) ??
            (await tx.shipment.findFirst({ where: { hblNo: { endsWith: p.partOf } }, select: { hblNo: true } }))?.hblNo ??
            p.partOf
          : p.partOf;
      }
      const shipperId = p.shipperId ?? shipperIds.get(shipperKey(p.shipperName))!;
      const fields = { ...p.data, partOfHblNo } as Prisma.ShipmentUncheckedCreateInput;
      const derived = {
        status: deriveStatus(fields as Parameters<typeof deriveStatus>[0], opts.now),
        ...computeCachedDeadlines(rules, fields as Parameters<typeof computeCachedDeadlines>[1]),
      };
      const s = await tx.shipment.create({
        data: { ...fields, ...derived, jobNo, hblNo, shipperId, createdById: opts.actor.id, createdAt: p.createdAt },
      });
      await tx.milestoneEvent.create({
        data: {
          shipmentId: s.id, type: EVENT.IMPORTED, actorId: opts.actor.id, source: "IMPORT", occurredAt: opts.now,
          value: JSON.stringify({
            row: p.row, legacyJobNo: p.jobNo && !keepJob ? p.jobNo : null, history: !!p.data.importedAsHistory, at: formatDateTime(opts.now),
            ...(!p.hblNo && !p.jobNo ? { fingerprint: p.fingerprint } : {}),
          }),
        },
      });
      result.importedJobNos.push(jobNo);
      return null;
    });
    if (outcome) result.skipped.push({ row: p.row, reason: outcome });
    else imported++;
  }
  result.imported = imported;
  return result;
}

/** Kept EX-O Job Nos. and NNR HBL Nos. move the counters past them, so new numbers never collide. */
async function bumpCounters(tx: Prisma.TransactionClient, jobNo: string, hblNo: string) {
  const j = JOB_RE.exec(jobNo);
  if (j) await raise(tx, `JOB:${j[1]}${j[2]}`, Number(j[3]));
  const h = NNR_HBL_PARTS_RE.exec(hblNo);
  if (h) await raise(tx, HBL_COUNTER_KEY, Number(h[3]));
}

async function raise(tx: Prisma.TransactionClient, key: string, atLeast: number) {
  await tx.$executeRaw`INSERT INTO "NumberSequence" ("key", "value") VALUES (${key}, ${atLeast}) ON CONFLICT ("key") DO UPDATE SET "value" = CASE WHEN "NumberSequence"."value" < ${atLeast} THEN ${atLeast} ELSE "NumberSequence"."value" END`;
}

/**
 * The failed rows as an Excel file in the same layout as the upload (same header rows, same columns),
 * with "Error" and "Original row" added at the end, so it can be fixed and uploaded again as is.
 */
export async function errorsWorkbook(result: ImportResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Rows to fix", { views: [{ state: "frozen", ySplit: result.headerRows.length }] });
  const width = Math.max(...result.headerRows.map((r) => r.length), ...result.errors.map((e) => e.values.length), 1);
  const errCol = width + 2; // one empty column, then Error and Original row
  result.headerRows.forEach((h, i) => {
    const row = ws.getRow(i + 1);
    h.forEach((v, c) => (row.getCell(c + 1).value = v));
    row.font = { bold: true };
  });
  ws.getRow(1).getCell(errCol).value = "ERROR";
  ws.getRow(1).getCell(errCol + 1).value = "ORIGINAL ROW";
  result.errors.forEach((e, i) => {
    const row = ws.getRow(result.headerRows.length + 1 + i);
    e.values.forEach((v, c) => (row.getCell(c + 1).value = v));
    row.getCell(errCol).value = e.messages.join("; ");
    row.getCell(errCol + 1).value = e.row;
  });
  ws.getColumn(errCol).width = 70;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export { ImportCellError };
