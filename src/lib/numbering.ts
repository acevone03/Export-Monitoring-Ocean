import type { Prisma, PrismaClient, Mode } from "@prisma/client";
import { manilaParts } from "./time";

// [ASSUMPTION] Formats from spec Section 5.1, isolated here so they are cheap to change.
//   Job No.:   EX-{O|A}-{YYMM}-{seq4}   sequence resets monthly per mode
//   HBL/HAWB:  NNR{O|A}{YY}{seq5}        sequence resets yearly per mode, never reused

type Tx = PrismaClient | Prisma.TransactionClient;

const modeLetter = (mode: Mode) => (mode === "OCEAN" ? "O" : "A");
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

export function formatJobNo(mode: Mode, at: Date, seq: number): string {
  const p = manilaParts(at);
  return `EX-${modeLetter(mode)}-${pad(p.year % 100, 2)}${pad(p.month, 2)}-${pad(seq, 4)}`;
}

export function formatHblHawbNo(mode: Mode, at: Date, seq: number): string {
  const p = manilaParts(at);
  return `NNR${modeLetter(mode)}${pad(p.year % 100, 2)}${pad(seq, 5)}`;
}

export async function nextJobNo(db: Tx, mode: Mode, at: Date): Promise<string> {
  const p = manilaParts(at);
  const key = `JOB:${modeLetter(mode)}:${pad(p.year % 100, 2)}${pad(p.month, 2)}`;
  return formatJobNo(mode, at, await nextSequence(db, key));
}

export async function nextHblHawbNo(db: Tx, mode: Mode, at: Date): Promise<string> {
  const p = manilaParts(at);
  const key = `HBL:${modeLetter(mode)}:${pad(p.year % 100, 2)}`;
  return formatHblHawbNo(mode, at, await nextSequence(db, key));
}

/** Label shown in the UI for the house document number. */
export const houseDocLabel = (mode: Mode) => (mode === "OCEAN" ? "HBL No." : "HAWB No.");
