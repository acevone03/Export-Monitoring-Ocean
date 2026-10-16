import { fromManila, manilaParts, DAY } from "../time";

// Manila calendar periods as UTC instants [start, end).

export type Period = { start: Date; end: Date };

export function manilaDay(d: Date, plusDays = 0): Period {
  const p = manilaParts(d);
  const start = new Date(fromManila(p.year, p.month, p.day).getTime() + plusDays * DAY);
  return { start, end: new Date(start.getTime() + DAY) };
}

/** "2026-10" -> October 2026 in Manila. */
export function manilaMonth(ym: string): Period & { label: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m || +m[2] < 1 || +m[2] > 12) throw new Error(`Invalid month: ${ym}`);
  const y = +m[1], mo = +m[2];
  const start = fromManila(y, mo, 1);
  const end = mo === 12 ? fromManila(y + 1, 1, 1) : fromManila(y, mo + 1, 1);
  const label = new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return { start, end, label };
}

export function monthKeyOf(d: Date): string {
  const p = manilaParts(d);
  return `${p.year}-${String(p.month).padStart(2, "0")}`;
}

export const within = (d: Date | null | undefined, p: Period) => !!d && d >= p.start && d < p.end;
