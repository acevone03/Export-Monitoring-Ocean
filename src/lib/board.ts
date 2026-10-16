import { z } from "zod";
import type { Shipment, ShipmentStatus } from "@prisma/client";
import { fromManila } from "./time";
import { rowState, type RowState } from "./deadline-status";
import { missingMandatory } from "./mandatory";

// Board filters come from the URL (?view=overdue&shipper=...), so views can be bookmarked.
export const BOARD_VIEWS = ["active", "overdue", "soon", "missing", "all"] as const;
export type BoardView = (typeof BOARD_VIEWS)[number];

const STATUSES = [
  "BOOKED", "PICKUP_SCHEDULED", "PICKED_UP", "FSI_DONE", "PREADVISED", "DECLARED", "BOC_UPLOADED",
  "ARRASTRE_PAID", "DOCS_SENT", "DEPARTED", "ARRIVED", "CLOSED", "CANCELLED",
] as const;

const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === "" || Array.isArray(v) ? undefined : v), schema.optional()).catch(undefined);

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const BoardFiltersSchema = z.object({
  view: z.enum(BOARD_VIEWS).catch("active").default("active"),
  status: optional(z.enum(STATUSES)),
  shipper: optional(z.string().uuid()),
  cs: optional(z.string().uuid()),
  etdFrom: optional(dateOnly),
  etdTo: optional(dateOnly),
});
export type BoardFilters = z.infer<typeof BoardFiltersSchema>;

/** Garbage in the URL is ignored rather than erroring: a bad filter just does not apply. */
export function parseBoardFilters(params: Record<string, string | string[] | undefined>): BoardFilters {
  return BoardFiltersSchema.parse(params);
}

const dayStart = (d: string) => fromManila(+d.slice(0, 4), +d.slice(5, 7), +d.slice(8, 10));

/** Prisma `where` for the filters the database can answer. */
export function boardWhere(f: BoardFilters) {
  const etd: { gte?: Date; lt?: Date } = {};
  if (f.etdFrom) etd.gte = dayStart(f.etdFrom);
  if (f.etdTo) etd.lt = new Date(dayStart(f.etdTo).getTime() + 24 * 60 * 60 * 1000); // inclusive end day
  const status: { in?: ShipmentStatus[]; equals?: ShipmentStatus } = {};
  if (f.status) status.equals = f.status;
  else if (f.view !== "all") status.in = STATUSES.filter((s) => s !== "CLOSED" && s !== "CANCELLED") as ShipmentStatus[];
  return {
    status,
    ...(f.shipper ? { shipperId: f.shipper } : {}),
    ...(f.cs ? { assignedCsId: f.cs } : {}),
    ...(f.etdFrom || f.etdTo ? { etdMnl: etd } : {}),
  };
}

const SEVERITY: Record<RowState, number> = { overdue: 0, soon: 1, ok: 2, inactive: 3 };

/** Computed filters (deadline state, missing data) and sort order, applied after the query. */
export function arrangeBoard<T extends Shipment>(rows: T[], view: BoardView, now: Date) {
  const withState = rows.map((s) => ({ s, state: rowState(s, now), missing: missingMandatory(s) }));
  const kept = withState.filter(({ state, missing }) =>
    view === "overdue" ? state === "overdue" : view === "soon" ? state === "soon" : view === "missing" ? missing.length > 0 : true,
  );
  // Most urgent first, then by ETD (unknown ETD last), then newest Job No.
  return kept.sort(
    (a, b) =>
      SEVERITY[a.state] - SEVERITY[b.state] ||
      (a.s.etdMnl?.getTime() ?? Infinity) - (b.s.etdMnl?.getTime() ?? Infinity) ||
      b.s.jobNo.localeCompare(a.s.jobNo),
  );
}

/** Counts for the quick-filter chips, over the same base query. */
export function boardCounts<T extends Shipment>(rows: T[], now: Date) {
  let overdue = 0, soon = 0, missing = 0;
  for (const s of rows) {
    const st = rowState(s, now);
    if (st === "overdue") overdue++;
    if (st === "soon") soon++;
    if (missingMandatory(s).length) missing++;
  }
  return { overdue, soon, missing };
}
