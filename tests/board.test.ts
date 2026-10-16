import { describe, expect, it } from "vitest";
import type { Shipment } from "@prisma/client";
import { arrangeBoard, boardCounts, boardWhere, parseBoardFilters } from "@/lib/board";
import { deadlineStatuses, rowState } from "@/lib/deadline-status";
import { canAccessShipment, shipmentScope } from "@/lib/access";

const now = new Date("2026-10-16T02:00:00Z");
const h = (n: number) => new Date(now.getTime() + n * 3600_000);
let seq = 0;
const ship = (o: Partial<Shipment> = {}): Shipment =>
  ({
    id: `id-${++seq}`, jobNo: `EX-O-2610-${String(seq).padStart(4, "0")}`, status: "PICKUP_SCHEDULED",
    arrastreResponsibility: "NNR", atdMnl: null, etdMnl: h(72),
    requestedPickupAt: h(24), actualPickupAt: null, fsiCutoffAt: h(48), fsiSubmittedAt: null,
    preadviseCutoffAt: h(50), preadviseSentAt: null, bocDeadlineAt: h(24), bocUploadAt: null,
    arrastreDeadlineAt: h(48), arrastrePaidAt: null, carrierName: "Maersk", carrierBookingRef: "X", eta: null,
    assignedCsId: "cs", createdById: "cs",
    ...o,
  }) as Shipment;

describe("rowState", () => {
  it("is red when any deadline is overdue, amber within 4h, green otherwise", () => {
    expect(rowState(ship(), now)).toBe("ok");
    expect(rowState(ship({ requestedPickupAt: h(3) }), now)).toBe("soon");
    expect(rowState(ship({ requestedPickupAt: h(3), bocDeadlineAt: h(-1) }), now)).toBe("overdue");
  });

  it("ignores completed deadlines", () => {
    expect(rowState(ship({ requestedPickupAt: h(-5), actualPickupAt: h(-6) }), now)).toBe("ok");
  });

  it("ignores the arrastre deadline when the shipper pays", () => {
    expect(rowState(ship({ arrastreDeadlineAt: h(-1), arrastreResponsibility: "SHIPPER" }), now)).toBe("ok");
  });

  it("stops flagging open deadlines once departed, and greys out closed/cancelled", () => {
    const departed = ship({ status: "DEPARTED", atdMnl: h(-1), bocDeadlineAt: h(-30) });
    expect(rowState(departed, now)).toBe("ok");
    expect(deadlineStatuses(departed, now).find((d) => d.type === "BOC_UPLOAD")?.state).toBe("none");
    expect(rowState(ship({ status: "CANCELLED", requestedPickupAt: h(-5) }), now)).toBe("inactive");
  });
});

describe("board filters", () => {
  it("parses valid filters and ignores garbage instead of failing", () => {
    expect(parseBoardFilters({})).toEqual({ view: "active" });
    const f = parseBoardFilters({ view: "nonsense", status: "FLYING", shipper: "not-a-uuid", etdFrom: "2026-10-01", etdTo: "31/10/2026" });
    expect(f).toEqual({ view: "active", etdFrom: "2026-10-01" });
  });

  it("hides closed and cancelled unless asked, and makes the ETD range inclusive in Manila time", () => {
    const w = boardWhere(parseBoardFilters({ etdFrom: "2026-10-01", etdTo: "2026-10-31" }));
    expect(w.status.in).not.toContain("CLOSED");
    expect(w.status.in).not.toContain("CANCELLED");
    expect(w.etdMnl).toEqual({ gte: new Date("2026-09-30T16:00:00Z"), lt: new Date("2026-10-31T16:00:00Z") });
    expect(boardWhere(parseBoardFilters({ view: "all" })).status).toEqual({});
    expect(boardWhere(parseBoardFilters({ status: "CLOSED" })).status).toEqual({ equals: "CLOSED" });
  });

  it("filters by computed view and sorts most urgent first, then by ETD", () => {
    const late = ship({ requestedPickupAt: h(-2) });
    const soon = ship({ requestedPickupAt: h(2) });
    const okEarly = ship({ etdMnl: h(30) });
    const okLate = ship({ etdMnl: h(90) });
    const missing = ship({ carrierBookingRef: null });
    const rows = [okLate, missing, soon, okEarly, late];
    expect(arrangeBoard(rows, "active", now).map((r) => r.s.id)).toEqual([late.id, soon.id, okEarly.id, missing.id, okLate.id]);
    expect(arrangeBoard(rows, "overdue", now).map((r) => r.s.id)).toEqual([late.id]);
    expect(arrangeBoard(rows, "soon", now).map((r) => r.s.id)).toEqual([soon.id]);
    expect(arrangeBoard(rows, "missing", now).map((r) => r.s.id)).toEqual([missing.id]);
    expect(boardCounts(rows, now)).toEqual({ overdue: 1, soon: 1, missing: 1 });
  });
});

describe("shipment access", () => {
  const s = { assignedCsId: "a", createdById: "b" };
  it("supervisors see all; CS see assigned or created; field sees none", () => {
    expect(canAccessShipment({ id: "x", role: "SUPERVISOR" }, s)).toBe(true);
    expect(canAccessShipment({ id: "a", role: "CS" }, s)).toBe(true);
    expect(canAccessShipment({ id: "b", role: "CS" }, s)).toBe(true);
    expect(canAccessShipment({ id: "c", role: "CS" }, s)).toBe(false);
    expect(canAccessShipment({ id: "a", role: "FIELD" }, s)).toBe(false);
    expect(shipmentScope({ id: "c", role: "CS" })).toEqual({ OR: [{ assignedCsId: "c" }, { createdById: "c" }] });
    expect(shipmentScope({ id: "x", role: "SUPERVISOR" })).toEqual({});
  });
});
