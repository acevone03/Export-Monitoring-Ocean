// Destination codes used inside NNR HBL numbers (NNRMNL + code + F/L + running number).
// Built from NNR's own monitoring sheet (the most common code per destination name).
// Add a line here when a new destination appears; CS can also type the code on the form.

const CITY_CODES: Record<string, string> = {
  AKITA: "AXT", ATLANTA: "ATL", BANGKOK: "BKK", BARCELONA: "BCN", BRISBANE: "BNE", BUSAN: "PUS", PUSAN: "PUS",
  CHARLOTTE: "CLT", CHENNAI: "CHE", CHICAGO: "CHI", COLUMBUS: "CMH", DALIAN: "DLC", DETROIT: "DET", DURBAN: "DUR",
  FELIXSTOWE: "FXT", FREMANTLE: "FRE", GENOVA: "GOA", GENOA: "GOA", HAIPHONG: "HPH", HAKATA: "HKT", HAMBURG: "HAM",
  HOCHIMINH: "HCM", HOCHIMINHCITY: "HCM", HONGKONG: "HKG", ICDGARHI: "GHR", PIPAVAV: "GHR", MANESAR: "GHR",
  JACKSONVILLE: "JAX", JAKARTA: "JKT", KANSAS: "MKC", KANSASCITY: "MKC", KAOHSIUNG: "KHH", KOBE: "KOB",
  LAEMCHABANG: "LCH", LEHAVRE: "LEH", LISBON: "LIS", LOSANGELES: "LAX", LONGBEACH: "LAX", LAX: "LAX",
  MANZANILLO: "ZLO", MATSUYAMA: "MYJ", MIAMI: "MIA", NAGOYA: "NGO", NANSHA: "NNS", NEWYORK: "NYC",
  NHAVASHEVA: "NHV", NINGBO: "NBO", OAKLAND: "OAK", OSAKA: "OSA", PASIRGUDANG: "PGU", PENANG: "PEN",
  PORTKELANG: "PKL", PORTKLANG: "PKL", ROTTERDAM: "RTM", SALERNO: "SAL", SEATTLE: "SEA", SHANGHAI: "SHA",
  SHEKOU: "SKU", SHENZHEN: "SZP", SHIMIZU: "SMZ", SINGAPORE: "SIN", SOUTHAMPTON: "SOU", SYDNEY: "SYD",
  TAICHUNG: "TXG", TOKYO: "TYO", TOMAKOMAI: "TMK", XIAMEN: "XMN", YOKOHAMA: "YOK",
};

const key = (s: string) => s.toUpperCase().replace(/[^A-Z]/g, "");

/**
 * HBL destination code for a destination as typed: a UN/LOCODE prefix ("JPTYO Tokyo" -> TYO),
 * a known city name ("TOKYO", "Port Klang"), or the first known city in "PIPAVAV / ICD GARHI".
 * Returns null when unknown; CS then enter the code on the form.
 */
export function podCodeFor(destination: string | null | undefined): string | null {
  if (!destination) return null;
  const raw = destination.trim();
  // "USLGB Long Beach": NNR's own code for the city wins (LAX); the UN/LOCODE is the fallback.
  const locode = /^([A-Z]{2})([A-Z]{3})\s+(.+)$/.exec(raw);
  const s = locode ? locode[3] : raw;
  const fromCity = cityCode(s);
  if (fromCity) return fromCity;
  return locode ? locode[2] : null;
}

function cityCode(s: string): string | null {
  const whole = CITY_CODES[key(s)];
  if (whole) return whole;
  for (const part of s.split(/[\/,;]| - /)) {
    const c = CITY_CODES[key(part)];
    if (c) return c;
  }
  // "Port Klang, Malaysia" style: try the leading words.
  const words = s.toUpperCase().replace(/[^A-Z ]/g, " ").split(/\s+/).filter(Boolean);
  for (let n = Math.min(3, words.length); n > 0; n--) {
    const c = CITY_CODES[words.slice(0, n).join("")];
    if (c) return c;
  }
  return null;
}

export const POD_CODE_RE = /^[A-Z]{3}$/;
