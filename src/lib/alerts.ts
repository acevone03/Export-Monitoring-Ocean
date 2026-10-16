import { Prisma, type AlertLevel, type DeadlineType, type PrismaClient } from "@prisma/client";
import { DEADLINE_DEFS, deadlinesMoot, rowState } from "./deadline-status";
import { DEFAULT_RULES } from "./deadlines";
import { formatDateTime, manilaParts, fromManila } from "./time";
import type { Notifier, Recipient } from "./notify";

// Deadline alert engine (spec section 7). Run by the scheduler every 5 minutes, and on demand
// from /dev/simulate-time. Every tick:
//   1. resolves alerts whose deadline was completed, moved, or no longer applies
//   2. creates the alert for each open deadline's *current* slot (idempotent: unique key)
//   3. delivers undelivered alerts (claimed first, so two schedulers never double-send)
//   4. refreshes the shipment's at-risk / overdue flags

type Db = PrismaClient | Prisma.TransactionClient;

export type RuleTiming = {
  enabled: boolean;
  reminderOffsets: number[]; // minutes before due, e.g. [1440, 240, 60]
  overdueRepeatMinutes: number; // e.g. 120
  overdueMaxPerDay: number; // e.g. 3
};

export type Slot = { level: AlertLevel; offsetMinutes: number };

/**
 * The single alert slot that applies right now, or null.
 * Only the latest reached slot counts: if the engine was down (or the clock jumped), we send one
 * up-to-date alert instead of a burst of stale reminders.
 *   before due:  REMINDER at -offset (smallest offset already reached)
 *   at due:      DUE (offset 0), until the first repeat
 *   after due:   OVERDUE at +k * repeat
 */
export function currentSlot(dueAt: Date, now: Date, t: RuleTiming): Slot | null {
  const msLeft = dueAt.getTime() - now.getTime();
  if (msLeft > 0) {
    const reached = t.reminderOffsets.filter((o) => o > 0 && msLeft <= o * 60_000);
    return reached.length ? { level: "REMINDER", offsetMinutes: -Math.min(...reached) } : null;
  }
  const repeatMs = t.overdueRepeatMinutes * 60_000;
  const k = repeatMs > 0 ? Math.floor(-msLeft / repeatMs) : 0;
  return k === 0 ? { level: "DUE", offsetMinutes: 0 } : { level: "OVERDUE", offsetMinutes: k * t.overdueRepeatMinutes };
}

function manilaDayBounds(d: Date) {
  const p = manilaParts(d);
  const start = fromManila(p.year, p.month, p.day);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

const DEF_BY_TYPE = Object.fromEntries(DEADLINE_DEFS.map((d) => [d.type, d])) as Record<DeadlineType, (typeof DEADLINE_DEFS)[number]>;

async function loadTimings(db: Db): Promise<Record<DeadlineType, RuleTiming>> {
  const rows = await db.deadlineRule.findMany();
  const source = rows.length ? rows : DEFAULT_RULES;
  return Object.fromEntries(
    source.map((r) => [
      r.deadlineType,
      {
        enabled: r.enabled,
        reminderOffsets: (Array.isArray(r.reminderOffsets) ? r.reminderOffsets : []).map(Number).filter((n) => n > 0),
        overdueRepeatMinutes: r.overdueRepeatMinutes,
        overdueMaxPerDay: r.overdueMaxPerDay,
      },
    ]),
  ) as Record<DeadlineType, RuleTiming>;
}

// ------------------------------------------------------------------ 1. resolution

/**
 * Closes open alerts that no longer need action. Also called inside milestone/edit transactions,
 * so completing a step clears its alerts immediately rather than at the next tick.
 */
export async function resolveStaleAlerts(db: Db, now: Date, shipmentId?: string): Promise<number> {
  const open = await db.alert.findMany({
    where: { resolvedAt: null, ...(shipmentId ? { shipmentId } : {}) },
    include: { shipment: true },
  });
  let n = 0;
  for (const a of open) {
    const def = DEF_BY_TYPE[a.deadlineType];
    let resolution: string | null = null;
    if (deadlinesMoot(a.shipment)) resolution = "MOOT";
    else if (def.done(a.shipment)) resolution = "COMPLETED";
    else if (def.due(a.shipment)?.getTime() !== a.dueAt.getTime()) resolution = "SUPERSEDED";
    if (resolution) {
      n += (await db.alert.updateMany({ where: { id: a.id, resolvedAt: null }, data: { resolvedAt: now, resolution } })).count;
    }
  }
  return n;
}

// ------------------------------------------------------------------ 2. creation

async function createDueAlerts(db: PrismaClient, now: Date, timings: Record<DeadlineType, RuleTiming>): Promise<number> {
  const shipments = await db.shipment.findMany({
    where: { status: { notIn: ["CLOSED", "CANCELLED"] }, atdMnl: null },
  });
  const day = manilaDayBounds(now);
  let created = 0;

  for (const s of shipments) {
    for (const def of DEADLINE_DEFS) {
      const t = timings[def.type];
      const dueAt = def.due(s);
      if (!t?.enabled || !dueAt || def.done(s)) continue;
      const slot = currentSlot(dueAt, now, t);
      if (!slot) continue;

      const series = { shipmentId: s.id, deadlineType: def.type, dueAt };
      if (slot.level !== "OVERDUE") {
        // Snooze holds back reminders and the DUE alert. OVERDUE escalation to the supervisor always goes out.
        const snoozed = await db.alert.findFirst({ where: { ...series, snoozedUntil: { gt: now } } });
        if (snoozed) continue;
      } else {
        const today = await db.alert.count({ where: { ...series, level: "OVERDUE", createdAt: { gte: day.start, lt: day.end } } });
        if (today >= t.overdueMaxPerDay) continue;
      }

      try {
        await db.alert.create({ data: { ...series, level: slot.level, offsetMinutes: slot.offsetMinutes, createdAt: now } });
        created++;
      } catch (e) {
        // Unique (shipment, deadline, level, offset, dueAt): this alert already exists. That is the idempotency guarantee.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
        throw e;
      }
    }
  }
  return created;
}

// ------------------------------------------------------------------ 3. delivery

function describeTiming(dueAt: Date, now: Date): string {
  const mins = Math.round((dueAt.getTime() - now.getTime()) / 60_000);
  const abs = Math.abs(mins);
  const span = abs >= 1440 ? `${Math.floor(abs / 1440)}d ${Math.floor((abs % 1440) / 60)}h` : abs >= 60 ? `${Math.floor(abs / 60)}h ${abs % 60}m` : `${abs}m`;
  if (mins > 0) return `is due in ${span} (${formatDateTime(dueAt)})`;
  if (mins === 0) return `is due now (${formatDateTime(dueAt)})`;
  return `is OVERDUE by ${span} (was due ${formatDateTime(dueAt)})`;
}

const LEVEL_TAG: Record<AlertLevel, string> = { REMINDER: "Reminder", DUE: "DUE NOW", OVERDUE: "OVERDUE" };

async function deliverPending(db: PrismaClient, now: Date, notifiers: Notifier[]): Promise<number> {
  const baseUrl = (process.env.APP_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
  const pending = await db.alert.findMany({
    where: { sentAt: null, resolvedAt: null },
    include: { shipment: { include: { shipper: true, assignedCs: true } } },
    orderBy: { createdAt: "asc" },
  });
  const supervisors = await db.user.findMany({ where: { role: "SUPERVISOR", active: true } });
  const toRecipient = (u: { id: string; name: string; email: string; telegramId: string | null }): Recipient => ({
    userId: u.id, name: u.name, email: u.email, telegramId: u.telegramId,
  });

  let delivered = 0;
  for (const a of pending) {
    // Claim: only the process that flips sentAt from null delivers this alert.
    const claimed = await db.alert.updateMany({ where: { id: a.id, sentAt: null }, data: { sentAt: now } });
    if (claimed.count !== 1) continue;

    const s = a.shipment;
    const recipients = new Map<string, Recipient>();
    if (s.assignedCs.active) recipients.set(s.assignedCs.id, toRecipient(s.assignedCs));
    // OVERDUE escalates to supervisors; so does anything whose CS is no longer active.
    if (a.level === "OVERDUE" || !s.assignedCs.active) for (const u of supervisors) recipients.set(u.id, toRecipient(u));

    const label = DEF_BY_TYPE[a.deadlineType].label;
    const msg = {
      alertId: a.id,
      subject: `[${LEVEL_TAG[a.level]}] ${label}: ${s.jobNo} · ${s.shipper.name}`,
      text: `${label} for ${s.jobNo} (HBL ${s.hblNo ?? "—"}, ${s.shipper.name}, to ${s.destinationPort}) ${describeTiming(a.dueAt, now)}.`,
      link: `${baseUrl}/shipments/${s.id}`,
      at: now, // app time (simulated in demos), so notifications line up with the alerts
    };

    const channels = new Set<string>();
    const errors: string[] = [];
    for (const n of notifiers) {
      for (const r of recipients.values()) {
        try {
          if ((await n.send(r, msg)) === "sent") channels.add(n.channel);
        } catch (e) {
          errors.push(`${n.channel} to ${r.email}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    await db.alert.update({
      where: { id: a.id },
      data: { channels: [...channels].join(","), deliveryError: errors.length ? errors.join("; ").slice(0, 1000) : null },
    });
    delivered++;
  }
  return delivered;
}

// ------------------------------------------------------------------ 4. flags

async function refreshFlags(db: PrismaClient, now: Date): Promise<number> {
  const rows = await db.shipment.findMany({ where: { status: { notIn: ["CLOSED", "CANCELLED"] } } });
  let changed = 0;
  for (const s of rows) {
    const st = rowState(s, now);
    const overdue = st === "overdue";
    const atRisk = st === "soon";
    if (s.overdue !== overdue || s.atRisk !== atRisk) {
      await db.shipment.update({ where: { id: s.id }, data: { overdue, atRisk } });
      changed++;
    }
  }
  // Closed/cancelled shipments carry no flags.
  changed += (await db.shipment.updateMany({
    where: { status: { in: ["CLOSED", "CANCELLED"] }, OR: [{ overdue: true }, { atRisk: true }] },
    data: { overdue: false, atRisk: false },
  })).count;
  return changed;
}

// ------------------------------------------------------------------ tick

export type TickResult = { resolved: number; created: number; delivered: number; flagsChanged: number };

export async function runAlertTick(db: PrismaClient, now: Date, notifiers: Notifier[]): Promise<TickResult> {
  const timings = await loadTimings(db);
  const resolved = await resolveStaleAlerts(db, now);
  const created = await createDueAlerts(db, now, timings);
  const delivered = await deliverPending(db, now, notifiers);
  const flagsChanged = await refreshFlags(db, now);
  return { resolved, created, delivered, flagsChanged };
}

// ------------------------------------------------------------------ user actions

export class AlertActionError extends Error {}

/** Acknowledges every open alert in the same series (shipment + deadline + due time). */
export async function acknowledgeAlert(db: PrismaClient, alertId: string, userId: string, now: Date) {
  const a = await db.alert.findUnique({ where: { id: alertId } });
  if (!a) throw new AlertActionError("Alert not found.");
  if (a.resolvedAt) throw new AlertActionError("This alert is already resolved.");
  return db.alert.updateMany({
    where: { shipmentId: a.shipmentId, deadlineType: a.deadlineType, dueAt: a.dueAt, resolvedAt: null, ackAt: null },
    data: { ackById: userId, ackAt: now },
  });
}

/** Holds back reminders/DUE for this deadline until `now + minutes`. Only completing the step resolves it. */
export async function snoozeAlert(db: PrismaClient, alertId: string, userId: string, minutes: number, now: Date) {
  if (!Number.isInteger(minutes) || minutes < 15 || minutes > 24 * 60) throw new AlertActionError("Snooze must be between 15 minutes and 24 hours.");
  const a = await db.alert.findUnique({ where: { id: alertId } });
  if (!a) throw new AlertActionError("Alert not found.");
  if (a.resolvedAt) throw new AlertActionError("This alert is already resolved.");
  return db.alert.update({
    where: { id: alertId },
    data: { snoozedUntil: new Date(now.getTime() + minutes * 60_000), ackById: userId, ackAt: a.ackAt ?? now },
  });
}

