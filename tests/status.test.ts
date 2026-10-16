import { describe, expect, it } from "vitest";
import { deriveStatus, type StatusInput } from "@/lib/status";

const now = new Date("2026-10-16T02:00:00Z");
const t = (h: number) => new Date(now.getTime() + h * 3600_000);

const base: StatusInput = {
  requestedPickupAt: null,
  actualPickupAt: null,
  fsiSubmittedAt: null,
  preadviseSentAt: null,
  exportDeclarationStatus: "PENDING",
  bocUploadAt: null,
  arrastreResponsibility: "NNR",
  arrastrePaidAt: null,
  exportDocsSentAt: null,
  atdMnl: null,
  eta: null,
  ata: null,
  closedAt: null,
  cancelledAt: null,
};
const s = (o: Partial<StatusInput>) => deriveStatus({ ...base, ...o }, now);

describe("deriveStatus", () => {
  it("walks the happy path in order", () => {
    let cur: Partial<StatusInput> = {};
    const steps: Array<[Partial<StatusInput>, string]> = [
      [{}, "BOOKED"],
      [{ requestedPickupAt: t(5) }, "PICKUP_SCHEDULED"],
      [{ actualPickupAt: t(-1) }, "PICKED_UP"],
      [{ fsiSubmittedAt: t(-1) }, "FSI_DONE"],
      [{ preadviseSentAt: t(-1) }, "PREADVISED"],
      [{ exportDeclarationStatus: "FILED" }, "DECLARED"],
      [{ bocUploadAt: t(-1) }, "BOC_UPLOADED"],
      [{ arrastrePaidAt: t(-1) }, "ARRASTRE_PAID"],
      [{ exportDocsSentAt: t(-1) }, "DOCS_SENT"],
      [{ atdMnl: t(-1), eta: t(48) }, "DEPARTED"],
      [{ ata: t(-1) }, "ARRIVED"],
      [{ closedAt: t(-1) }, "CLOSED"],
    ];
    for (const [patch, expected] of steps) {
      cur = { ...cur, ...patch };
      expect(s(cur)).toBe(expected);
    }
  });

  it("cancellation wins over everything", () => {
    expect(s({ atdMnl: t(-1), closedAt: t(-1), cancelledAt: t(-2) })).toBe("CANCELLED");
  });

  it("ignores arrastre payment unless NNR is responsible", () => {
    expect(s({ bocUploadAt: t(-1), arrastreResponsibility: "SHIPPER", arrastrePaidAt: t(-1) })).toBe("BOC_UPLOADED");
  });

  it("counts as arrived once departed and ETA has passed, even without ATA", () => {
    expect(s({ atdMnl: t(-48), eta: t(-1) })).toBe("ARRIVED");
    expect(s({ atdMnl: t(-48), eta: t(1) })).toBe("DEPARTED");
    // ETA passing without departure does not mean arrived.
    expect(s({ eta: t(-1) })).toBe("BOOKED");
  });

  it("moves forward when a later step is confirmed out of order", () => {
    expect(s({ requestedPickupAt: t(1), bocUploadAt: t(-1) })).toBe("BOC_UPLOADED");
  });
});
