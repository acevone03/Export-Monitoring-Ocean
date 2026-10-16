import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, parseManilaInput, toManilaInput } from "@/lib/time";

describe("Manila time helpers", () => {
  it("formats DD-MMM-YYYY and 24h time in Asia/Manila", () => {
    const d = new Date("2026-10-16T15:30:00Z"); // 23:30 Manila
    expect(formatDate(d)).toBe("16-Oct-2026");
    expect(formatDateTime(d)).toBe("16-Oct-2026 23:30");
    expect(formatDateTime(new Date("2026-10-16T16:05:00Z"))).toBe("17-Oct-2026 00:05");
  });

  it("round-trips datetime-local input as Manila time", () => {
    const d = parseManilaInput("2026-10-16T09:00")!;
    expect(d.toISOString()).toBe("2026-10-16T01:00:00.000Z");
    expect(toManilaInput(d)).toBe("2026-10-16T09:00");
  });
});
