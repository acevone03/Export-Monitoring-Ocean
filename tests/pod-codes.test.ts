import { describe, expect, it } from "vitest";
import { podCodeFor } from "@/lib/pod-codes";
import { parseShipmentForm } from "@/lib/shipment-input";

describe("podCodeFor", () => {
  it("uses NNR's codes from the monitoring sheet, then the UN/LOCODE", () => {
    expect(podCodeFor("TOKYO")).toBe("TYO");
    expect(podCodeFor("Port Klang")).toBe("PKL");
    expect(podCodeFor("PORT KELANG")).toBe("PKL");
    expect(podCodeFor("Laem Chabang, Thailand")).toBe("LCH");
    expect(podCodeFor("PIPAVAV / ICD GARHI")).toBe("GHR");
    expect(podCodeFor("JPTYO Tokyo")).toBe("TYO");
    expect(podCodeFor("USLGB Long Beach")).toBe("LAX"); // NNR uses LAX for Long Beach
    expect(podCodeFor("PLGDN Gdansk")).toBe("GDN"); // unknown city: UN/LOCODE fallback
    expect(podCodeFor("Gdansk")).toBeNull();
    expect(podCodeFor("")).toBeNull();
  });

  it("the form fills the code from the destination, or asks for it", () => {
    const form = (o: Record<string, string>) => {
      const fd = new FormData();
      const base: Record<string, string> = {
        shipperId: "8c1f1d0e-3b7a-4b8e-9a51-1d2f3c4b5a69", assignedCsId: "8c1f1d0e-3b7a-4b8e-9a51-1d2f3c4b5a69",
        destinationPort: "NAGOYA", pod: "NAGOYA", cargoType: "FCL", containerPlan: '[{"size":"40","qty":1}]', arrastreResponsibility: "NNR",
      };
      for (const [k, v] of Object.entries({ ...base, ...o })) fd.set(k, v);
      return parseShipmentForm(fd);
    };
    const ok = form({});
    expect(ok.ok && ok.data.podCode).toBe("NGO");
    expect(ok.ok && ok.data.declarationBy).toBe("NNR");
    const typed = form({ destinationPort: "Gdansk", pod: "Gdansk", podCode: "gdn" });
    expect(typed.ok && typed.data.podCode).toBe("GDN");
    const unknown = form({ destinationPort: "Gdansk", pod: "Gdansk" });
    expect(!unknown.ok && unknown.fieldErrors.podCode).toMatch(/3-letter/);
  });
});
