import type { DeadlineType, Shipment } from "@prisma/client";
import { dueState, type DueState } from "./due";

// The five tracked deadlines (spec 7.1): when each is due and what completes it.
// Shared by the board, the shipment page and (Step 4) the alert engine.
type S = Pick<
  Shipment,
  | "status" | "atdMnl" | "arrastreResponsibility"
  | "requestedPickupAt" | "actualPickupAt"
  | "fsiCutoffAt" | "fsiSubmittedAt"
  | "preadviseCutoffAt" | "preadviseSentAt"
  | "bocDeadlineAt" | "bocUploadAt"
  | "arrastreDeadlineAt" | "arrastrePaidAt"
>;

export const DEADLINE_DEFS: Array<{
  type: DeadlineType;
  label: string;
  due: (s: S) => Date | null;
  done: (s: S) => Date | null;
}> = [
  { type: "PICKUP", label: "Pick-up", due: (s) => s.requestedPickupAt, done: (s) => s.actualPickupAt },
  { type: "FSI", label: "FSI cut-off", due: (s) => s.fsiCutoffAt, done: (s) => s.fsiSubmittedAt },
  { type: "PREADVISE", label: "Pre-advise cut-off", due: (s) => s.preadviseCutoffAt, done: (s) => s.preadviseSentAt },
  { type: "BOC_UPLOAD", label: "BOC portal upload", due: (s) => s.bocDeadlineAt, done: (s) => s.bocUploadAt },
  {
    type: "ARRASTRE",
    label: "Arrastre payment",
    due: (s) => (s.arrastreResponsibility === "NNR" ? s.arrastreDeadlineAt : null),
    done: (s) => s.arrastrePaidAt,
  },
];

export type DeadlineStatus = { type: DeadlineType; label: string; dueAt: Date | null; doneAt: Date | null; state: DueState };

/** True when no deadline can still be acted on: cancelled, closed, or already departed. */
export function deadlinesMoot(s: Pick<S, "status" | "atdMnl">) {
  return s.status === "CANCELLED" || s.status === "CLOSED" || !!s.atdMnl;
}

export function deadlineStatuses(s: S, now: Date): DeadlineStatus[] {
  const moot = deadlinesMoot(s);
  return DEADLINE_DEFS.map((d) => {
    const dueAt = d.due(s);
    const doneAt = d.done(s);
    return { type: d.type, label: d.label, dueAt, doneAt, state: moot && !doneAt ? "none" : dueState(dueAt, doneAt, now) };
  });
}

export type RowState = "overdue" | "soon" | "ok" | "inactive";

/** Board row colour: red if anything is overdue, amber if anything is due within 4h, else green. */
export function rowState(s: S, now: Date): RowState {
  if (s.status === "CANCELLED" || s.status === "CLOSED") return "inactive";
  const states = deadlineStatuses(s, now).map((d) => d.state);
  if (states.includes("overdue")) return "overdue";
  if (states.includes("soon")) return "soon";
  return "ok";
}
