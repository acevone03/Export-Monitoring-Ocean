// Asia/Manila is UTC+8 with no DST, so a fixed offset is exact.
export const TZ = "Asia/Manila";
const OFFSET_MS = 8 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Calendar parts of a UTC instant as seen in Manila. */
export function manilaParts(d: Date) {
  const m = new Date(d.getTime() + OFFSET_MS);
  return {
    year: m.getUTCFullYear(),
    month: m.getUTCMonth() + 1,
    day: m.getUTCDate(),
    hour: m.getUTCHours(),
    minute: m.getUTCMinutes(),
  };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** DD-MMM-YYYY, e.g. 16-Oct-2026 */
export function formatDate(d: Date | null | undefined): string {
  if (!d) return "";
  const p = manilaParts(d);
  return `${pad(p.day)}-${MONTHS[p.month - 1]}-${p.year}`;
}

/** DD-MMM-YYYY HH:mm (24h, Manila) */
export function formatDateTime(d: Date | null | undefined): string {
  if (!d) return "";
  const p = manilaParts(d);
  return `${formatDate(d)} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** Build a UTC instant from Manila wall-clock values. */
export function fromManila(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - OFFSET_MS);
}

/** Parse the value of an <input type="datetime-local"> as Manila time. */
export function parseManilaInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  return fromManila(+m[1], +m[2], +m[3], +m[4], +m[5]);
}

/** Format for an <input type="datetime-local"> in Manila time. */
export function toManilaInput(d: Date | null | undefined): string {
  if (!d) return "";
  const p = manilaParts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

/** Pick-up instruction date: 13/NOV/2026 */
export function formatInstructionDate(d: Date | null | undefined): string {
  if (!d) return "";
  const p = manilaParts(d);
  return `${pad(p.day)}/${MONTHS[p.month - 1].toUpperCase()}/${p.year}`;
}

/** Pick-up instruction date and time: 13/NOV/2026 13:00H */
export function formatInstructionDateTime(d: Date | null | undefined): string {
  if (!d) return "";
  const p = manilaParts(d);
  return `${formatInstructionDate(d)} ${pad(p.hour)}:${pad(p.minute)}H`;
}

/** 00:00 Manila on the same Manila calendar day (date-only fields such as ETD, ETA, cut-off). */
export function startOfManilaDay(d: Date): Date {
  const p = manilaParts(d);
  return fromManila(p.year, p.month, p.day);
}

/** 23:59 Manila on the same day: a date-only due date counts as on time until the day ends. */
export function endOfManilaDay(d: Date | null | undefined): Date | null {
  return d ? new Date(startOfManilaDay(d).getTime() + DAY - 60_000) : null;
}

/** True for values stored as a date only (exactly 00:00 Manila). */
export const isManilaMidnight = (d: Date) => startOfManilaDay(d).getTime() === d.getTime();

/** Format for an <input type="date"> in Manila time. */
export const toManilaDateInput = (d: Date | null | undefined) => toManilaInput(d).slice(0, 10);
