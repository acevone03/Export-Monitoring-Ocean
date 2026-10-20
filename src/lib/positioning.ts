import type { Shipment } from "@prisma/client";

/** All FCL positioning date-times of a shipment, earliest first (positioningAt plus morePositioningAt). */
export function positioningDates(s: Pick<Shipment, "positioningAt" | "morePositioningAt">): Date[] {
  const more = Array.isArray(s.morePositioningAt) ? (s.morePositioningAt as unknown[]).filter((x): x is string => typeof x === "string") : [];
  return [s.positioningAt, ...more.map((iso) => new Date(iso))]
    .filter((d): d is Date => !!d && !Number.isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
}
