import { z } from "zod";
import { parseManilaInput } from "./time";

// Validation for the shipment form (create and edit). Every API boundary that
// writes shipment fields goes through ShipmentInputSchema.

export const CONTAINER_SIZES = ["20", "40", "40HC"] as const;
export type ContainerSize = (typeof CONTAINER_SIZES)[number];
export type ContainerPlan = Array<{ size: ContainerSize; qty: number }>;

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).transform((v) => v || null);

/** <input type="datetime-local"> value, interpreted as Asia/Manila. Empty -> null. */
export const manilaDateTime = z.string().trim().transform((v, ctx) => {
  if (!v) return null;
  const d = parseManilaInput(v);
  if (!d) {
    ctx.addIssue({ code: "custom", message: "Invalid date/time" });
    return z.NEVER;
  }
  return d;
});

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
    etdMnl: manilaDateTime,
    eta: manilaDateTime,
    arrastreResponsibility: z.enum(["NNR", "SHIPPER"]),
    carrierName: optText(100),
    carrierBookingRef: optText(50),
    carrierRemarks: optText(2000),
    assignedCsId: z.string().uuid("Choose the assigned CS"),
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
    if (v.etdMnl && v.eta && v.eta <= v.etdMnl) {
      ctx.addIssue({ code: "custom", path: ["eta"], message: "ETA must be after ETD" });
    }
  })
  // Drop the fields that do not apply to the chosen cargo type.
  .transform((v) =>
    v.cargoType === "FCL"
      ? { ...v, lclQty: null, lclUnit: null }
      : { ...v, containerPlan: [] as ContainerPlan },
  );

export type ShipmentInput = z.output<typeof ShipmentInputSchema>;

export const SHIPMENT_FORM_KEYS = [
  "shipperId",
  "consigneeName",
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
] as const;

export type FieldErrors = Partial<Record<string, string>>;

/** FormData -> validated input, or the first error per field. */
export function parseShipmentForm(
  form: FormData,
): { ok: true; data: ShipmentInput } | { ok: false; fieldErrors: FieldErrors } {
  const raw = Object.fromEntries(SHIPMENT_FORM_KEYS.map((k) => [k, String(form.get(k) ?? "")]));
  const parsed = ShipmentInputSchema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  const fieldErrors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "_form");
    fieldErrors[key] ??= issue.message;
  }
  return { ok: false, fieldErrors };
}
