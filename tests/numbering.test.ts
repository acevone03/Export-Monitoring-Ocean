import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { formatHblNo, formatJobNo, nextHblNo, nextJobNo } from "@/lib/numbering";
import { fromManila } from "@/lib/time";

const prisma = new PrismaClient();
afterAll(() => prisma.$disconnect());
beforeEach(() => prisma.numberSequence.deleteMany());

describe("number formats", () => {
  it("formats Job No. as EX-O-{YYMM}-{seq4}", () => {
    expect(formatJobNo(fromManila(2026, 10, 16), 1)).toBe("EX-O-2610-0001");
    expect(formatJobNo(fromManila(2026, 1, 5), 123)).toBe("EX-O-2601-0123");
  });

  it("formats HBL No. the NNR way: NNRMNL + destination + F/L + running number", () => {
    expect(formatHblNo("TYO", "FCL", 9904)).toBe("NNRMNLTYOF9904");
    expect(formatHblNo("BKK", "LCL", 12345)).toBe("NNRMNLBKKL12345");
    expect(formatHblNo("SIN", "FCL", 7)).toBe("NNRMNLSINF0007");
  });

  it("uses the Manila calendar, not UTC, for the month", () => {
    // 31-Oct-2026 23:30 UTC is already 01-Nov-2026 in Manila.
    expect(formatJobNo(new Date(Date.UTC(2026, 9, 31, 23, 30)), 1)).toBe("EX-O-2611-0001");
  });
});

describe("sequence allocation", () => {
  it("resets Job No. monthly", async () => {
    const oct = fromManila(2026, 10, 10);
    const nov = fromManila(2026, 11, 1);
    expect(await nextJobNo(prisma, oct)).toBe("EX-O-2610-0001");
    expect(await nextJobNo(prisma, oct)).toBe("EX-O-2610-0002");
    expect(await nextJobNo(prisma, nov)).toBe("EX-O-2611-0001");
  });

  it("HBL sequence is one running number that never resets", async () => {
    // One running number for all destinations and years, continuing after HBL_START_AFTER.
    process.env.HBL_START_AFTER = "9903";
    expect(await nextHblNo(prisma, "TYO", "FCL")).toBe("NNRMNLTYOF9904");
    expect(await nextHblNo(prisma, "BKK", "LCL")).toBe("NNRMNLBKKL9905");
    expect(await nextHblNo(prisma, "TYO", "FCL")).toBe("NNRMNLTYOF9906");
    delete process.env.HBL_START_AFTER;
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
          return db.$transaction((tx) => nextJobNo(tx, at), { maxWait: 20_000, timeout: 20_000 });
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
