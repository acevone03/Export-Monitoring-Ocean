import { describe, expect, it } from "vitest";
import { parseShipmentForm } from "@/lib/shipment-input";

const uuid = "8c1f1d0e-3b7a-4b8e-9a51-1d2f3c4b5a69";
const form = (o: Record<string, string>) => {
  const fd = new FormData();
  const base: Record<string, string> = {
    shipperId: uuid, assignedCsId: uuid, destinationPort: "USLAX Los Angeles", pod: "USLGB Long Beach",
    cargoType: "FCL", containerPlan: JSON.stringify([{ size: "40HC", qty: "2" }]), arrastreResponsibility: "NNR",
  };
  for (const [k, v] of Object.entries({ ...base, ...o })) fd.set(k, v);
  return fd;
};

describe("parseShipmentForm", () => {
  it("parses a valid FCL booking and reads dates as Manila time", () => {
    const r = parseShipmentForm(form({ requestedPickupAt: "2026-10-20T09:00", lclQty: "5", lclUnit: "BOX" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.requestedPickupAt?.toISOString()).toBe("2026-10-20T01:00:00.000Z");
    expect(r.data.containerPlan).toEqual([{ size: "40HC", qty: 2 }]);
    expect(r.data.lclQty).toBeNull(); // LCL fields dropped for FCL
    expect(r.data.consigneeName).toBeNull();
  });

  it("supports container combinations", () => {
    const r = parseShipmentForm(form({ containerPlan: JSON.stringify([{ size: "20", qty: 1 }, { size: "40", qty: 3 }]) }));
    expect(r.ok && r.data.containerPlan).toEqual([{ size: "20", qty: 1 }, { size: "40", qty: 3 }]);
  });

  it("requires containers for FCL and quantity+unit for LCL", () => {
    const fcl = parseShipmentForm(form({ containerPlan: "[]" }));
    expect(!fcl.ok && fcl.fieldErrors.containerPlan).toMatch(/at least one/);
    const lcl = parseShipmentForm(form({ cargoType: "LCL", lclQty: "", lclUnit: "" }));
    expect(!lcl.ok && lcl.fieldErrors.lclQty).toMatch(/LCL/);
    const ok = parseShipmentForm(form({ cargoType: "LCL", lclQty: "6", lclUnit: "PALLET" }));
    expect(ok.ok && ok.data.containerPlan).toEqual([]);
  });

  it("rejects duplicate sizes, ETA before ETD, missing shipper and bad dates", () => {
    expect(parseShipmentForm(form({ containerPlan: JSON.stringify([{ size: "20", qty: 1 }, { size: "20", qty: 1 }]) })).ok).toBe(false);
    const eta = parseShipmentForm(form({ etdMnl: "2026-10-20T10:00", eta: "2026-10-19T10:00" }));
    expect(!eta.ok && eta.fieldErrors.eta).toMatch(/after ETD/);
    const shipper = parseShipmentForm(form({ shipperId: "" }));
    expect(!shipper.ok && shipper.fieldErrors.shipperId).toMatch(/shipper/);
    const bad = parseShipmentForm(form({ fsiCutoffAt: "tomorrow" }));
    expect(!bad.ok && bad.fieldErrors.fsiCutoffAt).toMatch(/Invalid/);
  });
});
