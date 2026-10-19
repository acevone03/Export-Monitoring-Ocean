import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "./helpers";
import { createShipper, DuplicateShipperError, findOrCreateShipper, formatShipperCode, SHIPPER_CODE_RE, shipperKey } from "@/lib/shippers";
import { parseShipmentForm } from "@/lib/shipment-input";

const tag = () => randomUUID().slice(0, 6);

describe("shipper codes", () => {
  it("formats codes as SHP- plus at least four digits", () => {
    expect(formatShipperCode(7)).toBe("SHP-0007");
    expect(formatShipperCode(12345)).toBe("SHP-12345");
    expect(SHIPPER_CODE_RE.test("SHP-0007")).toBe(true);
  });

  it("gives every new shipper the next, unique code", async () => {
    const a = await createShipper(prisma, { name: `Alpha Trading ${tag()}` });
    const b = await createShipper(prisma, { name: `Beta Foods ${tag()}` });
    expect(a.code).toMatch(SHIPPER_CODE_RE);
    expect(Number(b.code.slice(4))).toBe(Number(a.code.slice(4)) + 1);
  });
});

describe("no repeated shipper names", () => {
  it("treats case, spacing, punctuation and Inc/Corp as the same name", () => {
    expect(shipperKey("Food Flow, Inc.")).toBe(shipperKey("FOODFLOW INC"));
    expect(shipperKey("ABC Corp.")).toBe(shipperKey("abc corporation"));
    expect(shipperKey("ABC Trading")).not.toBe(shipperKey("ABD Trading"));
  });

  it("rejects a second shipper with the same name and does not use up a code", async () => {
    const t = tag();
    const first = await createShipper(prisma, { name: `Mabini Exports ${t} Inc.` });
    await expect(createShipper(prisma, { name: `  MABINI exports ${t}, inc ` })).rejects.toBeInstanceOf(DuplicateShipperError);
    await expect(createShipper(prisma, { name: `Mabini Exports ${t} Corporation` })).rejects.toThrow(first.code);
    const next = await createShipper(prisma, { name: `Someone Else ${t}` });
    expect(Number(next.code.slice(4))).toBe(Number(first.code.slice(4)) + 1);
  });

  it("find-or-create returns the existing shipper instead of a duplicate", async () => {
    const t = tag();
    const first = await createShipper(prisma, { name: `Cebu Crafts ${t}` });
    const again = await findOrCreateShipper(prisma, `CEBU CRAFTS ${t} INC.`);
    expect(again.id).toBe(first.id);
    const fresh = await findOrCreateShipper(prisma, `Davao Fruits ${t}`);
    expect(fresh.code).toMatch(SHIPPER_CODE_RE);
  });
});

describe("shipment pick-up address", () => {
  const uuid = "8c1f1d0e-3b7a-4b8e-9a51-1d2f3c4b5a69";
  const form = (o: Record<string, string>) => {
    const fd = new FormData();
    const base = {
      shipperId: uuid, assignedCsId: uuid, destinationPort: "USLAX Los Angeles", pod: "USLGB Long Beach",
      cargoType: "FCL", containerPlan: JSON.stringify([{ size: "40HC", qty: "1" }]), arrastreResponsibility: "NNR",
    };
    for (const [k, v] of Object.entries({ ...base, ...o })) fd.set(k, v);
    return fd;
  };

  it("keeps the address from the form, blank as null", () => {
    const r = parseShipmentForm(form({ pickupAddress: "  Lot 4, LISP II, Calamba, Laguna " }));
    expect(r.ok && r.data.pickupAddress).toBe("Lot 4, LISP II, Calamba, Laguna");
    const blank = parseShipmentForm(form({ pickupAddress: "" }));
    expect(blank.ok && blank.data.pickupAddress).toBeNull();
  });
});
