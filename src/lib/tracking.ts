import type { PrismaClient } from "@prisma/client";

// Shipping line track & trace links for booking numbers.
// A link containing {ref} opens the result directly; one without it opens the carrier's tracking page,
// and the app copies the booking number so CS can paste it (Ctrl+V). Carriers change their sites, so
// supervisors/CS can edit this list on the Carriers page; it is stored in AppSetting CARRIER_TRACKING.

export type CarrierLink = {
  name: string;
  /** Other ways the carrier is written in the "Shipping line / co-loader" field, e.g. MSK, HLAG. */
  aliases: string[];
  url: string;
};

export const CARRIER_TRACKING_KEY = "CARRIER_TRACKING";

// Official tracking pages, checked 19-Oct-2026. ONE and COSCO accept the number in the link.
export const DEFAULT_CARRIERS: CarrierLink[] = [
  { name: "Maersk", aliases: ["MAERSK LINE", "MSK", "MAEU"], url: "https://www.maersk.com/tracking/" },
  { name: "MSC", aliases: ["MEDITERRANEAN SHIPPING", "MSCU"], url: "https://www.msc.com/en/track-a-shipment" },
  { name: "CMA CGM", aliases: ["CMA", "CMDU"], url: "https://www.cma-cgm.com/products-services/ecommerce/container-tracking" },
  { name: "ONE", aliases: ["OCEAN NETWORK EXPRESS", "ONEY"], url: "https://ecomm.one-line.com/one-ecom/manage-shipment/cargo-tracking?trakNoParam={ref}" },
  { name: "Evergreen", aliases: ["EVERGREEN LINE", "EMC", "EGLV"], url: "https://www.shipmentlink.com/" },
  { name: "COSCO", aliases: ["COSCO SHIPPING", "COSU"], url: "https://elines.coscoshipping.com/ebusiness/cargoTracking?trackingType=BOOKING&number={ref}" },
  { name: "Hapag-Lloyd", aliases: ["HAPAG", "HLAG", "HLC", "HLCU"], url: "https://www.hapag-lloyd.com/en/online-business/track/track.html" },
  { name: "Wan Hai", aliases: ["WAN HAI LINES", "WHL", "WHLC"], url: "https://shipper.wanhai.com/" },
  { name: "OOCL", aliases: ["ORIENT OVERSEAS", "OOLU"], url: "https://www.oocl.com/eng/ourservices/eservices/cargotracking" },
  { name: "Yang Ming", aliases: ["YANG MING LINE", "YML", "YMLU"], url: "https://www.yangming.com/en/esolution/cargo_tracking" },
];

const key = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The carrier a "Shipping line / co-loader" value refers to: exact name or alias first, then a word match. */
export function findCarrier(carriers: CarrierLink[], carrierName: string | null | undefined): CarrierLink | null {
  if (!carrierName?.trim()) return null;
  const k = key(carrierName);
  const names = (c: CarrierLink) => [c.name, ...c.aliases].map(key).filter(Boolean);
  const exact = carriers.find((c) => names(c).includes(k));
  if (exact) return exact;
  // "Maersk Line Phils", "MSC (via XYZ)": the value starts with a known name of 3+ letters.
  const words = carrierName.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  return carriers.find((c) => names(c).some((n) => n.length >= 3 && (k.startsWith(n) || words.includes(n)))) ?? null;
}

export type TrackTarget = { carrier: string; url: string; direct: boolean };

/** Where clicking a booking number goes, or null when the carrier is unknown or there is no number. */
export function trackingTarget(carriers: CarrierLink[], carrierName: string | null | undefined, ref: string | null | undefined): TrackTarget | null {
  const c = findCarrier(carriers, carrierName);
  const r = ref?.trim();
  if (!c || !r || !/^https:\/\//.test(c.url)) return null;
  const direct = c.url.includes("{ref}");
  return { carrier: c.name, url: direct ? c.url.replaceAll("{ref}", encodeURIComponent(r)) : c.url, direct };
}

/** Saved list, or the defaults when nobody has edited it. */
export async function getCarrierLinks(db: PrismaClient): Promise<CarrierLink[]> {
  const row = await db.appSetting.findUnique({ where: { key: CARRIER_TRACKING_KEY } });
  if (!row) return DEFAULT_CARRIERS;
  try {
    const list = JSON.parse(row.value) as CarrierLink[];
    return Array.isArray(list) ? list.filter((c) => c && typeof c.name === "string" && typeof c.url === "string").map((c) => ({ ...c, aliases: c.aliases ?? [] })) : DEFAULT_CARRIERS;
  } catch {
    return DEFAULT_CARRIERS;
  }
}

export async function setCarrierLinks(db: PrismaClient, list: CarrierLink[]): Promise<void> {
  const value = JSON.stringify(list);
  await db.appSetting.upsert({ where: { key: CARRIER_TRACKING_KEY }, create: { key: CARRIER_TRACKING_KEY, value }, update: { value } });
}
