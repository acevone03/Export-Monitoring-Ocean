// One-time spreadsheet import: FIXED column mapping (spec 10.4, no mapping UI).
// Each field lists the header spellings it accepts (case and spacing ignored).
// Documented in docs/import.md; keep the two in sync (a test checks every header is documented).

export const IMPORT_FIELDS = [
  { key: "jobNo", headers: ["Job No.", "Job No", "Booking No.", "Booking No", "Booking No. (manual)"], note: "Kept if it is a valid EX-O-YYMM-#### number not already used; otherwise a new Job No. is issued and the old one is kept on the timeline." },
  { key: "hblNo", headers: ["HBL No.", "HBL No", "HBL"], note: "Kept as is (already given to customers). `NNRMNLNGOF8687 / PART OF 8665` links a split shipment. Blank: a new HBL No. is issued." },
  { key: "shipper", headers: ["Shipper"], required: true, note: "Matched to the shipper list ignoring punctuation and Inc/Corp/Co. Unknown shippers are created (option) or reported." },
  { key: "consignee", headers: ["Consignee"] },
  { key: "destination", headers: ["Destination", "Destination Port"], required: true },
  { key: "pod", headers: ["POD", "Port of Discharge"], note: "Blank: same as Destination." },
  { key: "cargo", headers: ["Cargo", "Containers", "Container", "Volume"], required: true, note: "FCL like `2x40HC + 1x20` (40HQ/40'HC/40GP accepted); LCL like `LCL 6 PALLET`, `6 plts`, `30 ctns`." },
  { key: "carrier", headers: ["Carrier", "Shipping Line"] },
  { key: "bookingRef", headers: ["Carrier Booking Ref", "Carrier Booking No.", "Booking Ref"] },
  { key: "requestedPickup", headers: ["Requested Pick-up", "Requested Pickup", "Pick-up Date", "Pickup Date"] },
  { key: "actualPickup", headers: ["Actual Pick-up", "Actual Pickup"] },
  { key: "fsiCutoff", headers: ["FSI Cut-off", "FSI Cutoff"] },
  { key: "fsiSubmitted", headers: ["FSI Submitted"] },
  { key: "preadviseCutoff", headers: ["Pre-advise Cut-off", "Preadvise Cut-off", "Pre-advise Cutoff"] },
  { key: "preadviseSent", headers: ["Pre-advise Sent", "Preadvise Sent"] },
  { key: "arrastreCutoff", headers: ["Arrastre Cut-off", "Arrastre Cutoff"] },
  { key: "declaration", headers: ["Export Declaration", "Export Decl.", "Declaration"], note: "PENDING, FILED, ASSESSED or RELEASED. Blank: PENDING." },
  { key: "bocUploaded", headers: ["BOC Uploaded", "BOC Upload"] },
  { key: "arrastreBy", headers: ["Arrastre By", "Arrastre"], note: "NNR or SHIPPER. Blank: the shipper's default." },
  { key: "arrastrePaid", headers: ["Arrastre Paid"] },
  { key: "docsSent", headers: ["Export Docs Sent", "Docs Sent"] },
  { key: "etd", headers: ["ETD MNL", "ETD"] },
  { key: "atd", headers: ["ATD MNL", "ATD"] },
  { key: "eta", headers: ["ETA"] },
  { key: "ata", headers: ["ATA"] },
  { key: "status", headers: ["Status"], note: "Only `Cancelled` and `Closed` are used; every other status is recalculated from the dates." },
  { key: "cs", headers: ["Assigned CS", "CS"], note: "User name or email of an active CS/supervisor. Blank: the person importing." },
  { key: "remarks", headers: ["Carrier Remarks", "Remarks"] },
] as const;

export type ImportKey = (typeof IMPORT_FIELDS)[number]["key"];

/** Computed in the app, so ignored on import (they appear in our own Excel exports). */
export const IGNORED_HEADERS = ["BOC Upload Deadline", "Arrastre Deadline"];

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

export function resolveHeaders(headers: string[]) {
  const map: Partial<Record<ImportKey, number>> = {};
  const unknown: string[] = [];
  const ignored = new Set(IGNORED_HEADERS.map(norm));
  headers.forEach((h, i) => {
    if (!h.trim()) return;
    const n = norm(h);
    const field = IMPORT_FIELDS.find((f) => f.headers.some((x) => norm(x) === n));
    if (field && map[field.key] === undefined) map[field.key] = i;
    else if (!field && !ignored.has(n)) unknown.push(h.trim());
  });
  const missingRequired = IMPORT_FIELDS.filter((f) => "required" in f && f.required && map[f.key] === undefined).map((f) => f.headers[0]);
  return { map, unknown, missingRequired };
}
