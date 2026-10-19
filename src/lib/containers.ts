// Container sizes NNR books, in the order CS see them on the pick-up instruction.
// Plain data (no imports) so the browser form can use it too.

export const CONTAINER_SIZES = ["40", "20", "40HC", "20RF", "40RF"] as const;
export type ContainerSize = (typeof CONTAINER_SIZES)[number];
export type ContainerPlan = Array<{ size: ContainerSize; qty: number }>;

/** As written on the instruction: "1x40", "2x20 Reefer". */
export const CONTAINER_LABEL: Record<ContainerSize, string> = {
  "40": "40", "20": "20", "40HC": "40HC", "20RF": "20 Reefer", "40RF": "40 Reefer",
};

/** "1x40HC + 2x20 Reefer"; unknown sizes are shown as stored. */
export function containerPlanText(plan: Array<{ size: string; qty: number }> | null | undefined, sep = " + "): string {
  return (plan ?? []).map((c) => `${c.qty}x${CONTAINER_LABEL[c.size as ContainerSize] ?? c.size}`).join(sep);
}

/** Ports of loading on the FCL pick-up instruction. */
export const PORTS_OF_LOADING = ["MICP/NORTH", "SOUTH/ATI", "PORT OF BATANGAS", "SUBIC"] as const;
