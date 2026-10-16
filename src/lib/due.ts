// Colour state of a deadline (board rows, detail page). Amber window per spec 10.1.
export const AMBER_WINDOW_MS = 4 * 60 * 60 * 1000;
export type DueState = "done" | "overdue" | "soon" | "ok" | "none";

export function dueState(dueAt: Date | null, doneAt: Date | null | boolean, now: Date): DueState {
  if (doneAt) return "done";
  if (!dueAt) return "none";
  const left = dueAt.getTime() - now.getTime();
  if (left < 0) return "overdue";
  if (left <= AMBER_WINDOW_MS) return "soon";
  return "ok";
}
