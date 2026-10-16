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
