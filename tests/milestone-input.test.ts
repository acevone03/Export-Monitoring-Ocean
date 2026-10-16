import { describe, expect, it } from "vitest";
import { MilestoneFormSchema } from "@/lib/milestone-input";

describe("MilestoneFormSchema", () => {
  it("treats a missing or blank time as 'now' (null)", () => {
    // Regression: the export-docs form has no time field at all.
    const docs = MilestoneFormSchema.parse({ kind: "DOCS_SENT", recipient: "ops@x.test", subject: "Docs" });
    expect(docs).toMatchObject({ kind: "DOCS_SENT", at: null });
    expect(MilestoneFormSchema.parse({ kind: "PICKED_UP", at: "" })).toMatchObject({ at: null });
  });

  it("reads a given time as Manila", () => {
    const r = MilestoneFormSchema.parse({ kind: "DEPARTED", at: "2026-10-22T08:00", eta: "" });
    expect(r).toMatchObject({ at: new Date("2026-10-22T00:00:00Z"), eta: null });
  });

  it("requires a cancel reason and docs recipient", () => {
    expect(MilestoneFormSchema.safeParse({ kind: "CANCELLED", reason: "" }).success).toBe(false);
    expect(MilestoneFormSchema.safeParse({ kind: "DOCS_SENT", recipient: "", subject: "x" }).success).toBe(false);
  });
});
