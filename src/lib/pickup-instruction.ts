import type { PrismaClient, Shipment, Shipper } from "@prisma/client";
import { sendMail } from "./mailer";
import { EVENT } from "./milestones";
import { containerPlanText } from "./containers";
import { positioningDates } from "./positioning";
import { formatInstructionDate, formatInstructionDateTime } from "./time";

export { positioningDates };

// Pick-up instruction: the booking details the transport (trucking) company needs, emailed to the
// saved transport addresses when a shipment is created, and again on demand from the shipment page.
// When the consignee delivers the cargo themselves, nothing is emailed (status "not_needed").

export const TRANSPORT_EMAILS_KEY = "TRANSPORT_EMAILS";
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** Splits on commas, semicolons, spaces and new lines; returns valid unique emails and the rest. */
export function parseEmailList(text: string): { emails: string[]; invalid: string[] } {
  const parts = text.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
  const emails: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if (!EMAIL_RE.test(p)) invalid.push(p);
    else if (!emails.some((e) => e.toLowerCase() === p.toLowerCase())) emails.push(p);
  }
  return { emails, invalid };
}

export async function getTransportEmails(db: PrismaClient): Promise<string[]> {
  const row = await db.appSetting.findUnique({ where: { key: TRANSPORT_EMAILS_KEY } });
  return row ? parseEmailList(row.value).emails : [];
}

export async function setTransportEmails(db: PrismaClient, emails: string[]): Promise<void> {
  const value = emails.join("\n");
  await db.appSetting.upsert({ where: { key: TRANSPORT_EMAILS_KEY }, create: { key: TRANSPORT_EMAILS_KEY, value }, update: { value } });
}

type ShipmentWithShipper = Shipment & { shipper: Pick<Shipper, "code" | "name" | "contactPerson" | "phone" | "defaultPickupAddress"> };

const qtyText = (s: Shipment) =>
  s.lclQty ? `${s.lclQty} ${s.lclUnit === "BOX" ? (s.lclQty === 1 ? "BOX" : "BOXES") : s.lclQty === 1 ? "PALLET" : "PALLETS"}` : "";
const num = (n: number | null | undefined, unit: string) => (n === null || n === undefined ? "" : `${n.toLocaleString("en-US", { maximumFractionDigits: 3 })} ${unit}`);

export const ARRANGEMENT_LABEL = { NNR_PICKUP: "Pick-up by NNR", CONSIGNEE_DELIVERY: "Delivered by consignee" } as const;

/** One row per positioning date; numbered when there is more than one. Blank row when none. */
function positioningRows(s: Shipment): Array<[string, string]> {
  const all = positioningDates(s);
  if (all.length <= 1) return [["Positioning Date and Time", formatInstructionDateTime(all[0] ?? null)]];
  return all.map((d, i) => [`Positioning Date and Time ${i + 1}`, formatInstructionDateTime(d)]);
}

/** Label/value rows in the order the transport company reads them. Blank values are kept so gaps are visible. */
export function instructionRows(s: ShipmentWithShipper): Array<[string, string]> {
  const contact = [s.shipper.contactPerson, s.shipper.phone].filter(Boolean).join(" · ");
  const head: Array<[string, string]> = [
    ["Cargo Arrangement", ARRANGEMENT_LABEL[s.cargoArrangement]],
    ["Shipper", `${s.shipper.code} · ${s.shipper.name}`],
    ["Pick-up address", s.pickupAddress ?? s.shipper.defaultPickupAddress ?? ""],
    ["Contact", contact],
    ["Requested pick-up", formatInstructionDateTime(s.requestedPickupAt)],
    ["Booking Number", s.carrierBookingRef ?? ""],
    ["HBL", s.hblNo ?? ""],
    ["Commodity", s.cargoDescription ?? ""],
  ];
  const body: Array<[string, string]> =
    s.cargoType === "FCL"
      ? [
          ...positioningRows(s),
          ["Container Yard", s.containerYard ?? ""],
          ["Container Size", containerPlanText(s.containerPlan as Array<{ size: string; qty: number }> | null)],
          ["Port of Loading", s.portOfLoading ?? ""],
          ["Cut-off Time", formatInstructionDate(s.cyCutoffAt)],
          ["GW", num(s.grossWeightKg, "KGS")],
        ]
      : [
          ["Consol", s.consolidator ?? ""],
          ["Quantity", qtyText(s)],
          ["GW", num(s.grossWeightKg, "KGS")],
          ["CBM", num(s.cbm, "CBM")],
          ["Cargo Dimension", s.cargoDimensions ?? ""],
          ["Delivery Warehouse", s.deliveryWarehouse ?? ""],
        ];
  // COO is listed only when the shipment has one.
  const coo: Array<[string, string]> = s.hasCoo ? [["Certificate of Origin (COO)", "YES"]] : [];
  return [...head, ...body, ...coo, ["Destination", s.pod || s.destinationPort], ["Remarks", s.pickupRemarks ?? ""]];
}

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Container size for the subject: "1x40HC + 2x20 Reefer" (FCL) or "LCL 6 PALLETS". */
const sizeText = (s: Shipment) =>
  s.cargoType === "FCL" ? containerPlanText(s.containerPlan as Array<{ size: string; qty: number }> | null) : `LCL ${qtyText(s)}`.trim();

/**
 * "ATW for Luzon Coco Products Inc. / MAEU123 / 1x40HC / NNRMNLTYOF9905" — blanks are left out.
 * A resent instruction starts with "REVISED " so transport can spot it in the inbox.
 */
export function instructionSubject(s: ShipmentWithShipper, revised = false): string {
  const parts = [s.shipper.name, s.carrierBookingRef, sizeText(s), s.hblNo ?? s.jobNo].map((x) => x?.trim()).filter(Boolean);
  return `${revised ? "REVISED " : ""}ATW for ${parts.join(" / ")}`;
}

export type MailOptions = { revised?: boolean; previousSentAt?: Date | null };

export function buildInstructionMail(s: ShipmentWithShipper, opts: MailOptions = {}): { subject: string; text: string; html: string } {
  const subject = instructionSubject(s, opts.revised);
  const title = `${opts.revised ? "REVISED " : ""}PICK-UP INSTRUCTION (${s.cargoType})`;
  const revisedNote = opts.revised
    ? `This replaces the instruction sent${opts.previousSentAt ? ` on ${formatInstructionDateTime(opts.previousSentAt)}` : " earlier"}. Please follow this one.`
    : null;
  const rows = instructionRows(s);
  const width = Math.max(...rows.map(([k]) => k.length));
  const text = [
    title,
    ...(revisedNote ? [revisedNote] : []),
    "",
    ...rows.map(([k, v]) => `${k.padEnd(width)} : ${v}`),
    "",
    "Please confirm receipt and the truck/driver details. Thank you.",
    `NNR Global Logistics · Job No. ${s.jobNo}`,
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a">
<p style="font-size:16px;font-weight:bold;margin:0 0 8px">${esc(title)}</p>
${revisedNote ? `<p style="color:#b91c1c;font-weight:bold;margin:0 0 8px">${esc(revisedNote)}</p>` : ""}
<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;border:1px solid #cbd5e1">
${rows.map(([k, v]) => `<tr><td style="border:1px solid #cbd5e1;background:#f1f5f9;font-weight:bold;white-space:nowrap">${esc(k)}</td><td style="border:1px solid #cbd5e1">${esc(v) || "&nbsp;"}</td></tr>`).join("\n")}
</table>
<p>Please confirm receipt and the truck/driver details. Thank you.</p>
<p style="color:#64748b">NNR Global Logistics · Job No. ${esc(s.jobNo)}</p>
</div>`;
  return { subject, text, html };
}

export type InstructionResult =
  | { status: "sent"; to: string[] }
  | { status: "not_needed" } // delivered by consignee: transport is not involved
  | { status: "no_recipients" }
  | { status: "failed"; to: string[]; error: string };

/** Emails the instruction to the saved transport addresses and logs it on the timeline. Never throws for mail errors. */
export async function sendPickupInstruction(
  db: PrismaClient,
  shipmentId: string,
  actorId: string | null,
  now: Date,
  opts: { revised?: boolean } = {},
): Promise<InstructionResult> {
  const s = await db.shipment.findUniqueOrThrow({
    where: { id: shipmentId },
    include: { shipper: { select: { code: true, name: true, contactPerson: true, phone: true, defaultPickupAddress: true } } },
  });
  if (s.cargoArrangement === "CONSIGNEE_DELIVERY") return { status: "not_needed" };
  const to = await getTransportEmails(db);
  if (to.length === 0) return { status: "no_recipients" };
  // Only call it "revised" if an earlier one actually went out.
  const revised = !!opts.revised && !!s.pickupInstructionSentAt;
  const mail = buildInstructionMail(s, { revised, previousSentAt: s.pickupInstructionSentAt });
  try {
    await sendMail({ to, ...mail });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.milestoneEvent.create({
      data: { shipmentId, type: EVENT.PICKUP_INSTRUCTION_FAILED, value: JSON.stringify({ to, error: error.slice(0, 300) }), actorId, source: "WEB", occurredAt: now },
    });
    return { status: "failed", to, error };
  }
  await db.$transaction([
    db.shipment.update({ where: { id: shipmentId }, data: { pickupInstructionSentAt: now } }),
    db.milestoneEvent.create({
      data: { shipmentId, type: EVENT.PICKUP_INSTRUCTION_SENT, value: JSON.stringify({ to, subject: mail.subject, revised }), actorId, source: "WEB", occurredAt: now },
    }),
  ]);
  return { status: "sent", to };
}

// Fields that appear on the instruction. When an edit changes any of them, the instruction is resent.
const INSTRUCTION_FIELDS = [
  "cargoArrangement", "shipperId", "pickupAddress", "requestedPickupAt", "carrierBookingRef", "hblNo", "cargoType", "containerPlan", "lclQty", "lclUnit",
  "pod", "destinationPort", "positioningAt", "morePositioningAt", "containerYard", "portOfLoading", "cyCutoffAt", "consolidator", "grossWeightKg", "cbm",
  "cargoDescription", "cargoDimensions", "deliveryWarehouse", "pickupRemarks", "hasCoo",
] as const satisfies ReadonlyArray<keyof Shipment>;

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a instanceof Date ? a.toISOString() : a ?? null) === JSON.stringify(b instanceof Date ? b.toISOString() : b ?? null);

/** Names of instruction fields that differ between two versions of a shipment. */
export function instructionChanges(before: Shipment, after: Shipment): string[] {
  return INSTRUCTION_FIELDS.filter((k) => !same(before[k], after[k]));
}
