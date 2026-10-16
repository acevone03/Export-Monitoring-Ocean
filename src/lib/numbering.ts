import type { Prisma, PrismaClient } from "@prisma/client";
import { manilaParts } from "./time";

// Number formats, isolated here so they are cheap to change.
//   Job No.:  EX-O-{YYMM}-{seq4}           spec 5.1; sequence resets monthly
//   HBL No.:  NNRMNL{POD}{F|L}{seq4+}      NNR's real format, e.g. NNRMNLTYOF9904:
//             destination code + F (FCL) / L (LCL) + one running number that never resets.
//             The first number issued is HBL_START_AFTER + 1 (env), and an import moves the
//             counter past every HBL it brings in.

type Tx = PrismaClient | Prisma.TransactionClient;

const JOB_PREFIX = "EX-O-";
const HBL_PREFIX = "NNRMNL";
export const HBL_COUNTER_KEY = "HBL";
/** NNR HBLs, including the older MNL… form without NNR: groups = destination code, F/L, running number. */
export const NNR_HBL_PARTS_RE = /^(?:NNR)?M[NB]L([A-Z]{3})([FL])(\d{4,})$/;
const pad = (n: number, w: number) => String(n).padStart(w, "0");

/**
 * Atomically increments and returns the next value of a named counter.
 *
 * Two plain SQL statements, valid on both SQLite (>= 3.35) and Postgres:
 *   1. make sure the row exists (no-op if it does, no error on a race)
 *   2. UPDATE ... SET value = value + 1 ... RETURNING value
 * Both are writes, so SQLite takes the write lock up front (no read-then-upgrade
 * deadlock) and Postgres row-locks the counter until the surrounding transaction ends.
 * Call this FIRST inside a transaction that also creates the shipment, so a rolled-back
 * shipment also rolls back its number.
 */
export async function nextSequence(db: Tx, key: string, startAfter = 0): Promise<number> {
  await db.$executeRaw`INSERT INTO "NumberSequence" ("key", "value") VALUES (${key}, ${startAfter}) ON CONFLICT ("key") DO NOTHING`;
  const rows = await db.$queryRaw<Array<{ value: number | bigint }>>`
    UPDATE "NumberSequence" SET "value" = "value" + 1 WHERE "key" = ${key} RETURNING "value"`;
  if (rows.length !== 1) throw new Error(`Could not allocate sequence for ${key}`);
  return Number(rows[0].value);
}

export function formatJobNo(at: Date, seq: number): string {
  const p = manilaParts(at);
  return `${JOB_PREFIX}${pad(p.year % 100, 2)}${pad(p.month, 2)}-${pad(seq, 4)}`;
}

export function formatHblNo(podCode: string, cargoType: "FCL" | "LCL", seq: number): string {
  return `${HBL_PREFIX}${podCode}${cargoType === "FCL" ? "F" : "L"}${pad(seq, 4)}`;
}

export async function nextJobNo(db: Tx, at: Date): Promise<string> {
  const p = manilaParts(at);
  const key = `JOB:${pad(p.year % 100, 2)}${pad(p.month, 2)}`;
  return formatJobNo(at, await nextSequence(db, key));
}

export const hblStartAfter = () => {
  const n = Number(process.env.HBL_START_AFTER ?? 0);
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

export async function nextHblNo(db: Tx, podCode: string, cargoType: "FCL" | "LCL"): Promise<string> {
  return formatHblNo(podCode, cargoType, await nextSequence(db, HBL_COUNTER_KEY, hblStartAfter()));
}
