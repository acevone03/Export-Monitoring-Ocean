import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { formatHblHawbNo, formatJobNo, nextHblHawbNo, nextJobNo } from "@/lib/numbering";
import { fromManila } from "@/lib/time";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
beforeEach(() => prisma.numberSequence.deleteMany());

describe("number formats", () => {
  it("formats Job No. as EX-{O|A}-{YYMM}-{seq4}", () => {
    expect(formatJobNo("OCEAN", fromManila(2026, 10, 16), 1)).toBe("EX-O-2610-0001");
    expect(formatJobNo("AIR", fromManila(2026, 1, 5), 123)).toBe("EX-A-2601-0123");
  });

  it("formats HBL/HAWB as NNR{O|A}{YY}{seq5}", () => {
    expect(formatHblHawbNo("OCEAN", fromManila(2026, 10, 16), 7)).toBe("NNRO2600007");
    expect(formatHblHawbNo("AIR", fromManila(2027, 1, 1), 12345)).toBe("NNRA2712345");
  });

  it("uses the Manila calendar, not UTC, for the month", () => {
    // 31-Oct-2026 23:30 UTC is already 01-Nov-2026 in Manila.
    expect(formatJobNo("OCEAN", new Date(Date.UTC(2026, 9, 31, 23, 30)), 1)).toBe("EX-O-2611-0001");
  });
});

describe("sequence allocation", () => {
  it("resets monthly per mode", async () => {
    const oct = fromManila(2026, 10, 10);
    const nov = fromManila(2026, 11, 1);
    expect(await nextJobNo(prisma, "OCEAN", oct)).toBe("EX-O-2610-0001");
    expect(await nextJobNo(prisma, "OCEAN", oct)).toBe("EX-O-2610-0002");
    expect(await nextJobNo(prisma, "AIR", oct)).toBe("EX-A-2610-0001");
    expect(await nextJobNo(prisma, "OCEAN", nov)).toBe("EX-O-2611-0001");
  });

  it("HBL sequence does not reset monthly", async () => {
    expect(await nextHblHawbNo(prisma, "OCEAN", fromManila(2026, 10, 1))).toBe("NNRO2600001");
    expect(await nextHblHawbNo(prisma, "OCEAN", fromManila(2026, 11, 1))).toBe("NNRO2600002");
  });

  it("never hands out duplicates under concurrency", { timeout: 60_000 }, async () => {
    const at = fromManila(2026, 10, 16);
    const N = 40;
    // Separate clients = separate connections, closer to several server processes.
    const clients = Array.from({ length: 4 }, () => new PrismaClient());
    try {
      const results = await Promise.all(
        Array.from({ length: N }, (_, i) => {
          const db = clients[i % clients.length];
          return db.$transaction((tx) => nextJobNo(tx, "OCEAN", at), { maxWait: 20_000, timeout: 20_000 });
        }),
      );
      expect(new Set(results).size).toBe(N);
      const seqs = results.map((r) => Number(r.slice(-4))).sort((a, b) => a - b);
      expect(seqs).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    } finally {
      await Promise.all(clients.map((c) => c.$disconnect()));
    }
  });
});
