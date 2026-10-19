import { describe, expect, it } from "vitest";
import { DEFAULT_CARRIERS, findCarrier, trackingTarget } from "@/lib/tracking";

describe("shipping line tracking links", () => {
  it("matches the carrier by name, alias or leading word", () => {
    expect(findCarrier(DEFAULT_CARRIERS, "MAERSK LINE PHILS")?.name).toBe("Maersk");
    expect(findCarrier(DEFAULT_CARRIERS, "Hapag Lloyd")?.name).toBe("Hapag-Lloyd");
    expect(findCarrier(DEFAULT_CARRIERS, "HLAG")?.name).toBe("Hapag-Lloyd");
    expect(findCarrier(DEFAULT_CARRIERS, "Ocean Network Express")?.name).toBe("ONE");
    expect(findCarrier(DEFAULT_CARRIERS, "ACME Consol")).toBeNull();
  });

  it("puts the booking number in links that take it, otherwise opens the tracking page", () => {
    const one = trackingTarget(DEFAULT_CARRIERS, "ONE", "SGNE12345");
    expect(one).toMatchObject({ carrier: "ONE", direct: true });
    expect(one!.url).toContain("trakNoParam=SGNE12345");
    const msc = trackingTarget(DEFAULT_CARRIERS, "MSC", "177ABC");
    expect(msc).toMatchObject({ carrier: "MSC", direct: false, url: "https://www.msc.com/en/track-a-shipment" });
  });

  it("gives no link without a booking number or for non-https links", () => {
    expect(trackingTarget(DEFAULT_CARRIERS, "ONE", "")).toBeNull();
    expect(trackingTarget([{ name: "X", aliases: [], url: "javascript:alert(1)" }], "X", "1")).toBeNull();
  });
});
