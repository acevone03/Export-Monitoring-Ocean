import ExcelJS from "exceljs";
import { Prisma, type PrismaClient, type Role } from "@prisma/client";
import { ShipmentInputSchema } from "../shipment-input";
import { toManilaInput, formatDateTime } from "../time";
import { deriveStatus } from "../status";
import { computeCachedDeadlines, DEFAULT_RULES } from "../deadlines";
import { nextHblNo, nextJobNo } from "../numbering";
import { EVENT } from "../milestones";
import { matchShipper, normalizeName } from "../intake/to-form";
import { IMPORT_FIELDS, resolveHeaders, type ImportKey } from "./mapping";
import { cellText, ImportCellError, parseCargo, parseImportDate } from "./parse";

// One-time import of the existing monitoring spreadsheet (spec 10.4).
// Valid rows are imported; invalid rows are returned as an error list (and an Excel file with an
// "Error" column) for correction and re-upload. Rows already imported (same HBL No. or Job No.)
// are skipped, so re-uploading a corrected file is safe.

export type ImportActor = { id: string; role: Role };
export type RowError = { row: number; messages: string[]; values: string[] };
export type ImportResult = {
  dryRun: boolean;
  headers: string[];
  unknownHeaders: string[];
  missingHeaders: string[];
  total: number;
  imported: number;
  skipped: Array<{ row: number; reason: string }>;
  errors: RowError[];
  createdShippers: string[];
  importedJobNos: string[];
};

export const MAX_IMPORT_ROWS = 5000;
const JOB_RE = /^EX-O-(\d{2})(\d{2})-(\d{4})$/;
const HBL_RE = /^NNRO(\d{2})(\d{5})$/;
const DATE_FIELDS = [
  "requestedPickup", "actualPickup", "fsiCutoff", "fsiSubmitted", "preadviseCutoff", "preadviseSent",
  "bocUploaded", "arrastrePaid", "docsSent", "etd", "atd", "eta", "ata",
] as const;

type Prepared = {
  row: number;
  jobNo: string | null;
  hblNo: string | null;
  shipperName: string;
  shipperId: string | null; // null: to be created
  createdAt: Date;
  data: Omit<Prisma.ShipmentUncheckedCreateInput, "jobNo" | "shipperId" | "createdById" | "createdAt">;
};

export async function readSheet(buffer: Buffer): Promise<{ headers: string[]; rows: unknown[][] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new ImportCellError("The file has no worksheet.");
  const width = ws.columnCount;
  const values = (r: ExcelJS.Row) => Array.from({ length: width }, (_, i) => r.getCell(i + 1).value);
  const headers = values(ws.getRow(1)).map(cellText);
  const rows: unknown[][] = [];
  for (let r = 2; r <= ws.rowCount; r++) rows.push(values(ws.getRow(r)));
  return { headers, rows };
}

export async function runImport(
  db: PrismaClient,
  buffer: Buffer,
  opts: { actor: ImportActor; now: Date; dryRun: boolean; createMissingShippers: boolean },
): Promise<ImportResult> {
  const { headers, rows } = await readSheet(buffer);
  const { map, unknown, missingRequired } = resolveHeaders(headers);
  const result: ImportResult = {
    dryRun: opts.dryRun, headers, unknownHeaders: unknown, missingHeaders: missingRequired,
    total: 0, imported: 0, skipped: [], errors: [], createdShippers: [], importedJobNos: [],
  };
  if (missingRequired.length) return result;

  const shippers = await db.shipper.findMany({ select: { id: true, name: true, defaultArrastre: true } });
  const users = await db.user.findMany({ where: { active: true, role: { in: ["CS", "SUPERVISOR"] } }, select: { id: true, name: true, email: true } });
  const ruleRows = await db.deadlineRule.findMany();
  const rules = ruleRows.length ? ruleRows : DEFAULT_RULES;
  const seenHbl = new Set<string>();
  const seenJob = new Set<string>();
  const prepared: Prepared[] = [];

  const dataRows = rows
    .map((values, i) => ({ row: i + 2, values }))
    .filter((r) => r.values.some((v) => cellText(v) !== ""));
  if (dataRows.length > MAX_IMPORT_ROWS) {
    result.errors.push({ row: 0, messages: [`Too many rows (${dataRows.length}); import at most ${MAX_IMPORT_ROWS} per file.`], values: [] });
    return result;
  }
  result.total = dataRows.length;

  for (const { row, values } of dataRows) {
    const raw = (k: ImportKey) => (map[k] === undefined ? undefined : values[map[k]!]);
    const text = (k: ImportKey) => cellText(raw(k));
    const errors: string[] = [];
    const label = (k: ImportKey) => IMPORT_FIELDS.find((f) => f.key === k)!.headers[0];

    // Dates
    const dates: Partial<Record<(typeof DATE_FIELDS)[number], Date | null>> = {};
    for (const k of DATE_FIELDS) {
      try {
        dates[k] = parseImportDate(raw(k));
      } catch (e) {
        errors.push(`${label(k)}: ${(e as Error).message}`);
      }
    }

    // Cargo
    let cargo: ReturnType<typeof parseCargo> | null = null;
    try {
      cargo = parseCargo(text("cargo"));
    } catch (e) {
      errors.push(`Cargo: ${(e as Error).message}`);
    }

    // Shipper
    const shipperName = text("shipper");
    const match = matchShipper(shipperName, shippers.map((s) => ({ ...s })));
    const shipper = match.exact ? match.shipper : null;
    if (!shipperName) errors.push("Shipper is empty");
    else if (!shipper && match.shipper) errors.push(`Shipper "${shipperName}" is not an exact match; did you mean "${match.shipper.name}"?`);
    else if (!shipper && !opts.createMissingShippers) errors.push(`Shipper "${shipperName}" is not in the shipper list`);

    // Assigned CS
    // Email is unique; names may not be, so an ambiguous name is reported instead of guessed.
    const csText = text("cs").toLowerCase();
    const byEmail = csText ? users.find((u) => u.email.toLowerCase() === csText) : undefined;
    const byName = csText && !byEmail ? users.filter((u) => u.name.toLowerCase() === csText) : [];
    const cs = !csText ? users.find((u) => u.id === opts.actor.id) : byEmail ?? (byName.length === 1 ? byName[0] : undefined);
    if (!cs) {
      errors.push(
        !csText ? "No assigned CS and the importer is not a CS/supervisor"
        : byName.length > 1 ? `Assigned CS "${text("cs")}" matches ${byName.length} users; use their email instead`
        : `Assigned CS "${text("cs")}" is not an active CS or supervisor`,
      );
    }

    // Enumerations
    const declText = text("declaration").toUpperCase();
    const declaration = declText || "PENDING";
    if (!["PENDING", "FILED", "ASSESSED", "RELEASED"].includes(declaration)) errors.push(`Export Declaration "${text("declaration")}" must be PENDING, FILED, ASSESSED or RELEASED`);
    const arrText = text("arrastreBy").toUpperCase();
    const arrastre = arrText ? (arrText.startsWith("NNR") ? "NNR" : arrText.startsWith("SHIP") ? "SHIPPER" : null) : shipper?.defaultArrastre ?? "NNR";
    if (!arrastre) errors.push(`Arrastre By "${text("arrastreBy")}" must be NNR or SHIPPER`);
    const status = text("status").toLowerCase();

    // Numbers
    const jobNo = text("jobNo").toUpperCase() || null;
    const hblNo = text("hblNo").toUpperCase().replace(/\s+/g, "") || null;
    if (hblNo && !/^[A-Z0-9-]{4,30}$/.test(hblNo)) errors.push(`HBL No. "${hblNo}" may only contain letters, digits and dashes`);
    if (hblNo && seenHbl.has(hblNo)) errors.push(`HBL No. ${hblNo} appears twice in this file`);
    if (jobNo && JOB_RE.test(jobNo) && seenJob.has(jobNo)) errors.push(`Job No. ${jobNo} appears twice in this file`);

    // Same validation as the shipment form
    // Validate even when the CS or cargo failed, so every problem in the row is reported at once.
    {
      const parsed = ShipmentInputSchema.safeParse({
        shipperId: shipper?.id ?? "00000000-0000-4000-8000-000000000000",
        consigneeName: text("consignee"),
        destinationPort: text("destination"),
        pod: text("pod") || text("destination"),
        cargoType: cargo?.cargoType ?? "FCL",
        containerPlan: JSON.stringify(cargo?.cargoType === "FCL" ? cargo.containerPlan : [{ size: "20", qty: 1 }]),
        lclQty: cargo?.cargoType === "LCL" ? String(cargo.lclQty) : "",
        lclUnit: cargo?.cargoType === "LCL" ? cargo.lclUnit : "",
        requestedPickupAt: toManilaInput(dates.requestedPickup ?? null),
        fsiCutoffAt: toManilaInput(dates.fsiCutoff ?? null),
        preadviseCutoffAt: toManilaInput(dates.preadviseCutoff ?? null),
        etdMnl: toManilaInput(dates.etd ?? null),
        eta: toManilaInput(dates.eta ?? null),
        arrastreResponsibility: arrastre ?? "NNR",
        carrierName: text("carrier"),
        carrierBookingRef: text("bookingRef"),
        carrierRemarks: text("remarks"),
        assignedCsId: cs?.id ?? "00000000-0000-4000-8000-000000000000",
      });
      if (!parsed.success) for (const i of parsed.error.issues) errors.push(`${String(i.path[0] ?? "Row")}: ${i.message}`);
      if (dates.ata && !dates.atd) errors.push("ATA is set but ATD is empty");
      if (dates.ata && dates.atd && dates.ata <= dates.atd) errors.push("ATA must be after ATD");
      if (dates.arrastrePaid && arrastre === "SHIPPER") errors.push("Arrastre Paid is set but arrastre is paid by the shipper");

      if (errors.length === 0 && parsed.success && cargo && cs) {
        const p = parsed.data;
        const createdAt = [dates.requestedPickup, dates.etd, dates.fsiCutoff].filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0] ?? opts.now;
        prepared.push({
          row, jobNo, hblNo, shipperName, shipperId: shipper?.id ?? null, createdAt,
          data: {
            consigneeName: p.consigneeName, destinationPort: p.destinationPort, pod: p.pod, cargoType: p.cargoType,
            containerPlan: p.containerPlan.length ? p.containerPlan : Prisma.DbNull, lclQty: p.lclQty, lclUnit: p.lclUnit,
            requestedPickupAt: p.requestedPickupAt, actualPickupAt: dates.actualPickup ?? null,
            fsiCutoffAt: p.fsiCutoffAt, fsiSubmittedAt: dates.fsiSubmitted ?? null,
            preadviseCutoffAt: p.preadviseCutoffAt, preadviseSentAt: dates.preadviseSent ?? null,
            arrastreResponsibility: p.arrastreResponsibility,
            exportDeclarationStatus: declaration as "PENDING" | "FILED" | "ASSESSED" | "RELEASED",
            exportDeclarationUpdatedAt: declaration === "PENDING" ? null : opts.now,
            bocUploadAt: dates.bocUploaded ?? null, arrastrePaidAt: dates.arrastrePaid ?? null, exportDocsSentAt: dates.docsSent ?? null,
            carrierName: p.carrierName, carrierBookingRef: p.carrierBookingRef, carrierRemarks: p.carrierRemarks,
            etdMnl: p.etdMnl, atdMnl: dates.atd ?? null, eta: p.eta, ata: dates.ata ?? null,
            cancelledAt: status.startsWith("cancel") ? opts.now : null,
            cancelReason: status.startsWith("cancel") ? "Imported as cancelled" : null,
            closedAt: status.startsWith("close") ? opts.now : null,
            assignedCsId: p.assignedCsId, source: "IMPORT",
          },
        });
        if (hblNo) seenHbl.add(hblNo);
        if (jobNo) seenJob.add(jobNo);
      }
    }
    if (errors.length) result.errors.push({ row, messages: errors, values: values.map(cellText) });
  }

  // New shippers (named in valid rows only), de-duplicated by normalized name.
  const toCreate = new Map<string, string>();
  for (const p of prepared) if (!p.shipperId) toCreate.set(normalizeName(p.shipperName), p.shipperName);
  result.createdShippers = [...toCreate.values()];
  if (opts.dryRun) {
    result.imported = prepared.length;
    return result;
  }

  const shipperIds = new Map<string, string>();
  for (const [key, name] of toCreate) {
    const s = await db.shipper.upsert({ where: { name }, create: { name }, update: {} });
    shipperIds.set(key, s.id);
  }

  // Move the counters past every number kept from the file BEFORE generating any new ones;
  // otherwise a number generated for an early row could collide with one kept further down.
  await db.$transaction(async (tx) => {
    for (const p of prepared) await bumpCounters(tx, p.jobNo ?? "", p.hblNo ?? "");
  });

  let imported = 0;
  for (const p of prepared) {
    const outcome = await db.$transaction(async (tx) => {
      if (p.hblNo && (await tx.shipment.findUnique({ where: { hblNo: p.hblNo } }))) return `HBL No. ${p.hblNo} already exists (already imported?)`;
      const keepJob = p.jobNo && JOB_RE.test(p.jobNo) && !(await tx.shipment.findUnique({ where: { jobNo: p.jobNo } }));
      if (p.jobNo && JOB_RE.test(p.jobNo) && !keepJob) return `Job No. ${p.jobNo} already exists (already imported?)`;
      if (p.jobNo && !JOB_RE.test(p.jobNo)) {
        const prior = await tx.milestoneEvent.findFirst({ where: { type: EVENT.IMPORTED, value: { contains: `"legacyJobNo":${JSON.stringify(p.jobNo)}` } } });
        if (prior) return `Old booking no. ${p.jobNo} was already imported`;
      }

      const jobNo = keepJob ? p.jobNo! : await nextJobNo(tx, p.createdAt);
      const hblNo = p.hblNo ?? (await nextHblNo(tx, p.createdAt));
      await bumpCounters(tx, jobNo, hblNo);

      const shipperId = p.shipperId ?? shipperIds.get(normalizeName(p.shipperName))!;
      const fields = { ...p.data } as Prisma.ShipmentUncheckedCreateInput;
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
          value: JSON.stringify({ row: p.row, legacyJobNo: p.jobNo && !keepJob ? p.jobNo : null, at: formatDateTime(opts.now) }),
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

/** Kept EX-O / NNRO numbers move the counters past them, so new numbers never collide. */
async function bumpCounters(tx: Prisma.TransactionClient, jobNo: string, hblNo: string) {
  const j = JOB_RE.exec(jobNo);
  if (j) await raise(tx, `JOB:${j[1]}${j[2]}`, Number(j[3]));
  const h = HBL_RE.exec(hblNo);
  if (h) await raise(tx, `HBL:${h[1]}`, Number(h[2]));
}

async function raise(tx: Prisma.TransactionClient, key: string, atLeast: number) {
  await tx.$executeRaw`INSERT INTO "NumberSequence" ("key", "value") VALUES (${key}, ${atLeast}) ON CONFLICT ("key") DO UPDATE SET "value" = CASE WHEN "NumberSequence"."value" < ${atLeast} THEN ${atLeast} ELSE "NumberSequence"."value" END`;
}

/** The failed rows as an Excel file: original columns plus an "Error" column, ready to fix and re-upload. */
export async function errorsWorkbook(result: ImportResult): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Rows to fix", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.addRow(["Error", "Original row", ...result.headers]);
  ws.getRow(1).font = { bold: true };
  for (const e of result.errors) ws.addRow([e.messages.join("; "), e.row, ...e.values]);
  ws.getColumn(1).width = 60;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
