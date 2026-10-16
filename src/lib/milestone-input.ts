import { z } from "zod";
import { manilaDateTime } from "./shipment-input";

// Form payload for recording a milestone from the shipment page.
// Every time field is optional: blank (or absent) means "now", applied by the caller.
const optionalTime = z.string().optional().transform((v) => v ?? "").pipe(manilaDateTime);
const str = z.string().trim();

export const MilestoneFormSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("PICKED_UP"), at: optionalTime }),
  z.object({ kind: z.literal("FSI_SUBMITTED"), at: optionalTime }),
  z.object({ kind: z.literal("PREADVISE_SENT"), at: optionalTime }),
  z.object({ kind: z.literal("DECLARATION_STATUS"), status: z.enum(["PENDING", "FILED", "ASSESSED", "RELEASED"]) }),
  z.object({ kind: z.literal("BOC_UPLOADED"), at: optionalTime }),
  z.object({ kind: z.literal("ARRASTRE_PAID"), at: optionalTime }),
  z.object({
    kind: z.literal("DOCS_SENT"),
    at: optionalTime,
    recipient: str.min(3, "Enter who the docs were sent to").max(300),
    subject: str.min(1, "Enter the email subject").max(300),
  }),
  z.object({ kind: z.literal("DOCS_TO_OVERSEAS"), at: optionalTime }),
  z.object({ kind: z.literal("DEPARTED"), at: optionalTime, eta: optionalTime }),
  z.object({ kind: z.literal("ARRIVED"), at: optionalTime }),
  z.object({ kind: z.literal("CLOSED") }),
  z.object({ kind: z.literal("CANCELLED"), reason: str.min(3, "Give a reason for cancelling").max(500) }),
]);
