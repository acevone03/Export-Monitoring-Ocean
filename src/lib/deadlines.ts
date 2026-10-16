import type { DeadlineType, ArrastreResponsibility } from "@prisma/client";

// Rule format (spec 7.2): due = shipment[baseField] + offsetMinutes. No rule language.
export type RuleLike = { deadlineType: DeadlineType; baseField: string; offsetMinutes: number; enabled: boolean };

// Fields a rule may reference. Kept explicit so a typo in a rule fails loudly.
export const RULE_BASE_FIELDS = [
  "requestedPickupAt",
  "fsiCutoffAt",
  "preadviseCutoffAt",
  "etdMnl",
  "arrastreCutoffAt",
] as const;
export type RuleBaseField = (typeof RULE_BASE_FIELDS)[number];

export type DeadlineShipment = Record<RuleBaseField, Date | null> & {
  arrastreResponsibility: ArrastreResponsibility;
};

// [ASSUMPTION] Defaults from spec 7.2; editable by the supervisor in deadline_rules.
export const DEFAULT_RULES: Array<RuleLike & { reminderOffsets: number[]; overdueRepeatMinutes: number; overdueMaxPerDay: number }> = [
  { deadlineType: "PICKUP", baseField: "requestedPickupAt", offsetMinutes: 0 },
  { deadlineType: "FSI", baseField: "fsiCutoffAt", offsetMinutes: 0 },
  { deadlineType: "PREADVISE", baseField: "preadviseCutoffAt", offsetMinutes: 0 },
  { deadlineType: "BOC_UPLOAD", baseField: "fsiCutoffAt", offsetMinutes: -24 * 60 },
  // NNR enters the terminal's arrastre cut-off per shipment (monitoring sheet column), so it is used as is.
  { deadlineType: "ARRASTRE", baseField: "arrastreCutoffAt", offsetMinutes: 0 },
].map((r) => ({
  ...(r as RuleLike),
  enabled: true,
  reminderOffsets: [24 * 60, 4 * 60, 60],
  overdueRepeatMinutes: 120,
  overdueMaxPerDay: 3,
}));

/** Due time for one deadline, or null if not applicable / base date unknown. */
export function computeDueAt(rule: RuleLike, s: DeadlineShipment): Date | null {
  if (!rule.enabled) return null;
  if (rule.deadlineType === "ARRASTRE" && s.arrastreResponsibility !== "NNR") return null;
  if (!(RULE_BASE_FIELDS as readonly string[]).includes(rule.baseField)) {
    throw new Error(`Unknown base field in deadline rule: ${rule.baseField}`);
  }
  const base = s[rule.baseField as RuleBaseField];
  if (!base) return null;
  return new Date(base.getTime() + rule.offsetMinutes * 60_000);
}

/** The two computed deadlines cached on the shipment row. */
export function computeCachedDeadlines(rules: RuleLike[], s: DeadlineShipment) {
  const find = (t: DeadlineType) => rules.find((r) => r.deadlineType === t);
  const boc = find("BOC_UPLOAD");
  const arr = find("ARRASTRE");
  return {
    bocDeadlineAt: boc ? computeDueAt(boc, s) : null,
    arrastreDeadlineAt: arr ? computeDueAt(arr, s) : null,
  };
}
