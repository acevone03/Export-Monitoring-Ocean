import type { Prisma, PrismaClient } from "@prisma/client";
import { manilaParts } from "./time";

// [ASSUMPTION] Formats from spec Section 5.1, isolated here so they are cheap to change.
// Ocean export only, so the mode letter is fixed to "O".
//   Job No.:  EX-O-{YYMM}-{seq4}   sequence resets monthly
//   HBL No.:  NNRO{YY}{seq5}       sequence resets yearly, never reused

type Tx = PrismaClient | Prisma.TransactionClient;

const JOB_PREFIX = "EX-O-";
const HBL_PREFIX = "NNRO";
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
export async function nextSequence(db: Tx, key: string): Promise<number> {
  await db.$executeRaw`INSERT INTO "NumberSequence" ("key", "value") VALUES (${key}, 0) ON CONFLICT ("key") DO NOTHING`;
  const rows = await db.$queryRaw<Array<{ value: number | bigint }>>`
    UPDATE "NumberSequence" SET "value" = "value" + 1 WHERE "key" = ${key} RETURNING "value"`;
  if (rows.length !== 1) throw new Error(`Could not allocate sequence for ${key}`);
  return Number(rows[0].value);
}

export function formatJobNo(at: Date, seq: number): string {
  const p = manilaParts(at);
  return `${JOB_PREFIX}${pad(p.year % 100, 2)}${pad(p.month, 2)}-${pad(seq, 4)}`;
}

export function formatHblNo(at: Date, seq: number): string {
  const p = manilaParts(at);
  return `${HBL_PREFIX}${pad(p.year % 100, 2)}${pad(seq, 5)}`;
}

export async function nextJobNo(db: Tx, at: Date): Promise<string> {
  const p = manilaParts(at);
  const key = `JOB:${pad(p.year % 100, 2)}${pad(p.month, 2)}`;
  return formatJobNo(at, await nextSequence(db, key));
}

export async function nextHblNo(db: Tx, at: Date): Promise<string> {
  const p = manilaParts(at);
  const key = `HBL:${pad(p.year % 100, 2)}`;
  return formatHblNo(at, await nextSequence(db, key));
}
