import { z } from "zod";
import { parseManilaInput, startOfManilaDay } from "./time";
import { podCodeFor, POD_CODE_RE } from "./pod-codes";
import { CONTAINER_SIZES, PORTS_OF_LOADING, type ContainerPlan } from "./containers";

// Validation for the shipment form (create and edit). Every API boundary that
// writes shipment fields goes through ShipmentInputSchema.

export { CONTAINER_SIZES, type ContainerSize, type ContainerPlan } from "./containers";

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).transform((v) => v || null);

/** <input type="datetime-local"> value, interpreted as Asia/Manila. Empty -> null. */
/** A booking number used as a Direct BL's HBL No. (same rule as a manual HBL correction). */
export const DIRECT_HBL_RE = /^[A-Z0-9-]{4,30}$/;

export const manilaDateTime = z.string().trim().transform((v, ctx) => {
  if (!v) return null;
  const d = parseManilaInput(v);
  if (!d) {
    ctx.addIssue({ code: "custom", message: "Invalid date/time" });
    return z.NEVER;
  }
  return d;
});

/**
 * Date-only field (ETD, ETA): <input type="date"> "YYYY-MM-DD", stored as 00:00 Manila.
 * A date-time value (spreadsheet import, older forms) keeps just its Manila date. Empty -> null.
 */
export const manilaDate = z.string().trim().transform((v, ctx) => {
  if (!v) return null;
  const d = parseManilaInput(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00` : v);
  if (!d) {
    ctx.addIssue({ code: "custom", message: "Invalid date" });
    return z.NEVER;
  }
  return startOfManilaDay(d);
});

// Pick-up instruction fields are optional keys so older callers (the spreadsheet import) still validate.
const instrText = (max: number) => z.string().trim().max(max, `Keep it under ${max} characters`).optional().transform((v) => v || null);
const instrDateTime = z.string().optional().transform((v) => v ?? "").pipe(manilaDateTime);
/** <input type="date"> value (YYYY-MM-DD) as Manila midnight. Empty -> null. */
const instrDate = z.string().trim().optional().transform((v, ctx) => {
  if (!v) return null;
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? parseManilaInput(`${v}T00:00`) : null;
  if (!d) {
    ctx.addIssue({ code: "custom", message: "Invalid date" });
    return z.NEVER;
  }
  return d;
});
const instrNumber = (label: string, max: number) =>
  z.string().trim().optional()
    .transform((v) => (v ? Number(v.replace(/,/g, "")) : null))
    .pipe(z.number(`${label} must be a number`).min(0, `${label} cannot be negative`).max(max).nullable());

const ContainerPlanSchema = z.array(
  z.object({
    size: z.enum(CONTAINER_SIZES),
    qty: z.coerce.number().int().min(1, "Quantity must be at least 1").max(99),
  }),
);

export const ShipmentInputSchema = z
  .object({
    shipperId: z.string().uuid("Pick a shipper from the list"),
    consigneeName: optText(200),
    // Optional so callers that predate the field (the spreadsheet import) still validate.
    pickupAddress: z.string().trim().max(300, "Address is too long").optional().transform((v) => v || null),
    destinationPort: text(100).min(1, "Destination is required"),
    pod: text(100).min(1, "Port of discharge is required"),
    cargoType: z.enum(["FCL", "LCL"]),
    containerPlan: z
      .string()
      .transform((v, ctx) => {
        if (!v) return [];
        try {
          return JSON.parse(v);
        } catch {
          ctx.addIssue({ code: "custom", message: "Invalid container plan" });
          return z.NEVER;
        }
      })
      .pipe(ContainerPlanSchema),
    lclQty: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : Number(v)))
      .pipe(z.number("LCL quantity must be a number").int().min(1).max(9999).nullable()),
    lclUnit: z
      .string()
      .transform((v) => v || null)
      .pipe(z.enum(["PALLET", "BOX"]).nullable()),
    requestedPickupAt: manilaDateTime,
    fsiCutoffAt: manilaDateTime,
    preadviseCutoffAt: manilaDateTime,
    arrastreCutoffAt: manilaDateTime,
    etdMnl: manilaDate,
    eta: manilaDate,
    arrastreResponsibility: z.enum(["NNR", "SHIPPER"]),
    carrierName: optText(100),
    carrierBookingRef: optText(50),
    carrierRemarks: optText(2000),
    assignedCsId: z.string().uuid("Choose the assigned CS"),
    // HBL destination code (TYO in NNRMNLTYOF9904). Blank: worked out from the destination.
    podCode: z.string().trim().toUpperCase().max(3),
    // NNR consolidation (NNR's own HBL number) or DIRECT (the booking number is the HBL). Optional key: older callers mean NNR.
    hblType: z.string().optional().transform((v) => v || "NNR").pipe(z.enum(["NNR", "DIRECT"], "Choose NNR Consolidation or Direct")),
    declarationBy: z.string().transform((v) => v || "NNR").pipe(z.enum(["NNR", "SHIPPER"])),
    declarationForwarder: optText(100),
    partOfHblNo: z.string().trim().toUpperCase().max(30).transform((v) => v || null),
    // Pick-up instruction: FCL
    positioningAt: instrDateTime,
    containerYard: instrText(200),
    portOfLoading: z.string().optional().transform((v) => v || null).pipe(z.enum(PORTS_OF_LOADING, "Pick a port of loading from the list").nullable()),
    cyCutoffAt: instrDate,
    // Pick-up instruction: LCL
    consolidator: instrText(100),
    grossWeightKg: instrNumber("Gross weight", 1_000_000),
    cbm: instrNumber("CBM", 10_000),
    cargoDescription: instrText(500),
    cargoDimensions: instrText(500),
    deliveryWarehouse: instrText(200),
    // Both
    pickupRemarks: instrText(2000),
  })
  .superRefine((v, ctx) => {
    if (v.cargoType === "FCL") {
      if (v.containerPlan.length === 0) {
        ctx.addIssue({ code: "custom", path: ["containerPlan"], message: "Add at least one container" });
      }
      const sizes = v.containerPlan.map((c) => c.size);
      if (new Set(sizes).size !== sizes.length) {
        ctx.addIssue({ code: "custom", path: ["containerPlan"], message: "List each container size once" });
      }
    }
    if (v.cargoType === "LCL" && (!v.lclQty || !v.lclUnit)) {
      ctx.addIssue({ code: "custom", path: ["lclQty"], message: "Enter LCL quantity and unit" });
    }
    if (v.etdMnl && v.eta && v.eta < v.etdMnl) {
      ctx.addIssue({ code: "custom", path: ["eta"], message: "ETA cannot be before ETD" });
    }
    const code = v.podCode || podCodeFor(v.pod) || podCodeFor(v.destinationPort);
    if (v.hblType === "DIRECT") {
      // The booking number becomes the HBL No., so it must be there and usable as one.
      if (!v.carrierBookingRef) {
        ctx.addIssue({ code: "custom", path: ["carrierBookingRef"], message: "Booking number is required for a Direct BL (it becomes the HBL)" });
      } else if (!DIRECT_HBL_RE.test(v.carrierBookingRef.toUpperCase())) {
        ctx.addIssue({ code: "custom", path: ["carrierBookingRef"], message: "For a Direct BL the booking number may only have letters, digits and dashes (4–30)" });
      }
    } else if (!code || !POD_CODE_RE.test(code)) {
      ctx.addIssue({ code: "custom", path: ["podCode"], message: "Enter the 3-letter HBL destination code (e.g. TYO)" });
    }
  })
  // Drop the fields that do not apply to the chosen cargo type.
  .transform((v) => {
    // Only NNR HBLs use the destination code; a Direct BL keeps it if known, for reference.
    const podCode: string | null = v.podCode || podCodeFor(v.pod) || podCodeFor(v.destinationPort) || null;
    // FCL cut-off is the positioning date (NNR, 19-Oct-2026), so it is never entered separately.
    const cyCutoffAt = v.positioningAt ? startOfManilaDay(v.positioningAt) : null;
    return v.cargoType === "FCL"
      ? { ...v, podCode, cyCutoffAt, lclQty: null, lclUnit: null, consolidator: null, grossWeightKg: null, cbm: null, cargoDescription: null, cargoDimensions: null, deliveryWarehouse: null }
      : { ...v, podCode, containerPlan: [] as ContainerPlan, positioningAt: null, containerYard: null, portOfLoading: null, cyCutoffAt: null };
  });

export type ShipmentInput = z.output<typeof ShipmentInputSchema>;

export const SHIPMENT_FORM_KEYS = [
  "shipperId",
  "consigneeName",
  "pickupAddress",
  "destinationPort",
  "pod",
  "cargoType",
  "containerPlan",
  "lclQty",
  "lclUnit",
  "requestedPickupAt",
  "fsiCutoffAt",
  "preadviseCutoffAt",
  "etdMnl",
  "eta",
  "arrastreResponsibility",
  "carrierName",
  "carrierBookingRef",
  "carrierRemarks",
  "assignedCsId",
  "arrastreCutoffAt",
  "podCode",
  "hblType",
  "declarationBy",
  "declarationForwarder",
  "partOfHblNo",
  "positioningAt",
  "containerYard",
  "portOfLoading",
  "cyCutoffAt",
  "consolidator",
  "grossWeightKg",
  "cbm",
  "cargoDescription",
  "cargoDimensions",
  "deliveryWarehouse",
  "pickupRemarks",
] as const;

export type FieldErrors = Partial<Record<string, string>>;

/**
 * Pick-up instruction fields the transport company cannot work without. Checked on the form only
 * (not the spreadsheet import), for new shipments and for edits before the pick-up is done.
 */
export function missingInstructionFields(d: ShipmentInput): FieldErrors {
  const e: FieldErrors = {};
  if (d.cargoType === "FCL") {
    if (!d.positioningAt) e.positioningAt = "Positioning date and time is required for FCL";
    if (!d.portOfLoading) e.portOfLoading = "Port of loading is required for FCL";
  }
  return e;
}

/** FormData -> validated input, or the first error per field. */
export function parseShipmentForm(
  form: FormData,
  opts: { requireInstruction?: boolean } = {},
): { ok: true; data: ShipmentInput } | { ok: false; fieldErrors: FieldErrors } {
  const raw = Object.fromEntries(SHIPMENT_FORM_KEYS.map((k) => [k, String(form.get(k) ?? "")]));
  const parsed = ShipmentInputSchema.safeParse(raw);
  if (parsed.success) {
    const missing = opts.requireInstruction ? missingInstructionFields(parsed.data) : {};
    return Object.keys(missing).length ? { ok: false, fieldErrors: missing } : { ok: true, data: parsed.data };
  }
  const fieldErrors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "_form");
    fieldErrors[key] ??= issue.message;
  }
  // Show the required-field errors together with the others, not on a second save.
  if (opts.requireInstruction && raw.cargoType === "FCL") {
    if (!raw.positioningAt.trim()) fieldErrors.positioningAt ??= "Positioning date and time is required for FCL";
    if (!raw.portOfLoading.trim()) fieldErrors.portOfLoading ??= "Port of loading is required for FCL";
  }
  return { ok: false, fieldErrors };
}
