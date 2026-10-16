import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { acknowledgeAlert, currentSlot, runAlertTick, snoozeAlert, type RuleTiming } from "@/lib/alerts";
import { InAppNotifier } from "@/lib/notify";
import { createShipment, recordMilestone, updateShipment, type Actor } from "@/lib/shipments";
import type { AlertMessage, Notifier, Recipient } from "@/lib/notify";
import { fromManila, HOUR, DAY } from "@/lib/time";
import { DEFAULT_RULES } from "@/lib/deadlines";
import type { ShipmentInput } from "@/lib/shipment-input";
import { prisma, fixtures, input } from "./helpers";

const T: RuleTiming = { enabled: true, reminderOffsets: [1440, 240, 60], overdueRepeatMinutes: 120, overdueMaxPerDay: 3 };
const due = fromManila(2026, 11, 2, 8, 0); // 02-Nov-2026 08:00 Manila
const at = (ms: number) => new Date(due.getTime() + ms);
const MIN = 60_000;

describe("currentSlot", () => {
  it("returns the latest reached slot only", () => {
    expect(currentSlot(due, at(-25 * HOUR), T)).toBeNull();
    expect(currentSlot(due, at(-24 * HOUR), T)).toEqual({ level: "REMINDER", offsetMinutes: -1440 });
    expect(currentSlot(due, at(-3 * HOUR), T)).toEqual({ level: "REMINDER", offsetMinutes: -240 });
    expect(currentSlot(due, at(-30 * MIN), T)).toEqual({ level: "REMINDER", offsetMinutes: -60 });
    expect(currentSlot(due, due, T)).toEqual({ level: "DUE", offsetMinutes: 0 });
    expect(currentSlot(due, at(119 * MIN), T)).toEqual({ level: "DUE", offsetMinutes: 0 });
    expect(currentSlot(due, at(2 * HOUR), T)).toEqual({ level: "OVERDUE", offsetMinutes: 120 });
    expect(currentSlot(due, at(5 * HOUR), T)).toEqual({ level: "OVERDUE", offsetMinutes: 240 });
  });

  it("handles no reminders and no repeats", () => {
    const bare = { ...T, reminderOffsets: [], overdueRepeatMinutes: 0 };
    expect(currentSlot(due, at(-HOUR), bare)).toBeNull();
    expect(currentSlot(due, at(10 * HOUR), bare)).toEqual({ level: "DUE", offsetMinutes: 0 });
  });
});

// ---------------------------------------------------------------- engine

class FakeNotifier implements Notifier {
  readonly channel: string;
  sent: Array<{ to: Recipient; msg: AlertMessage }> = [];
  constructor(channel = "FAKE", private fail = false) {
    this.channel = channel;
  }
  async send(to: Recipient, msg: AlertMessage) {
    if (this.fail) throw new Error("SMTP down");
    this.sent.push({ to, msg });
    return "sent" as const;
  }
  forShipment(id: string) {
    return this.sent.filter((s) => s.msg.link.endsWith(`/shipments/${id}`));
  }
}

let f: Awaited<ReturnType<typeof fixtures>>;
let cs: Actor;

beforeAll(async () => {
  f = await fixtures();
  cs = { id: f.cs.id, role: "CS" };
  if ((await prisma.deadlineRule.count()) === 0) for (const r of DEFAULT_RULES) await prisma.deadlineRule.create({ data: r });
});
afterAll(() => prisma.$disconnect());

/** A shipment whose only open deadline is pick-up at `due`. */
const pickupShipment = (extra: Partial<ShipmentInput> = {}) =>
  createShipment(prisma, { ...input({ shipperId: f.shipper.id, assignedCsId: f.cs.id }), requestedPickupAt: due, ...extra }, cs, { now: at(-3 * DAY) });
const alertsOf = (id: string) => prisma.alert.findMany({ where: { shipmentId: id }, orderBy: { createdAt: "asc" } });

describe("runAlertTick", () => {
  it("walks reminder -> due -> overdue, once each, escalating overdue to supervisors", async () => {
    const s = await pickupShipment();
    const n = new FakeNotifier();
    const tick = (t: Date) => runAlertTick(prisma, t, [n]);

    await tick(at(-25 * HOUR));
    expect(await alertsOf(s.id)).toHaveLength(0);

    for (const t of [at(-23 * HOUR), at(-23 * HOUR + 5 * MIN), at(-3 * HOUR), at(-30 * MIN), at(MIN), at(2 * HOUR + MIN), at(2 * HOUR + 6 * MIN)]) {
      await tick(t);
    }
    const alerts = await alertsOf(s.id);
    expect(alerts.map((a) => `${a.level}:${a.offsetMinutes}`)).toEqual([
      "REMINDER:-1440", "REMINDER:-240", "REMINDER:-60", "DUE:0", "OVERDUE:120",
    ]);
    expect(alerts.every((a) => a.sentAt && a.channels === "FAKE")).toBe(true);

    const sent = n.forShipment(s.id);
    const toCs = sent.filter((x) => x.to.userId === f.cs.id);
    expect(toCs).toHaveLength(5); // one per alert, never repeated by the extra ticks
    const toSup = sent.filter((x) => x.to.userId === f.sup.id);
    expect(toSup.map((x) => x.msg.subject)).toEqual([expect.stringMatching(/^\[OVERDUE\] Pick-up: EX-O-/)]);
    expect(toSup[0].msg.text).toMatch(/OVERDUE by 2h 1m/);
  });

  it("sends one up-to-date alert after a gap instead of a burst", async () => {
    const s = await pickupShipment();
    await runAlertTick(prisma, at(5 * HOUR), [new FakeNotifier()]);
    expect((await alertsOf(s.id)).map((a) => `${a.level}:${a.offsetMinutes}`)).toEqual(["OVERDUE:240"]);
  });

  it("caps overdue repeats per Manila day", async () => {
    const s = await pickupShipment();
    for (let hrs = 2; hrs <= 12; hrs += 2) await runAlertTick(prisma, at(hrs * HOUR), [new FakeNotifier()]);
    // 08:00 due; repeats at 10, 12, 14 fire; 16, 18, 20 are over the cap for 02-Nov.
    expect((await alertsOf(s.id)).filter((a) => a.level === "OVERDUE").map((a) => a.offsetMinutes)).toEqual([120, 240, 360]);
    // Next Manila day the escalation resumes (02-Nov 08:00 + 18h = 03-Nov 02:00).
    await runAlertTick(prisma, at(18 * HOUR), [new FakeNotifier()]);
    expect((await alertsOf(s.id)).at(-1)?.offsetMinutes).toBe(1080);
  });

  it("never double-sends when two schedulers tick at the same time", { timeout: 60_000 }, async () => {
    const s = await pickupShipment();
    const [c1, c2] = [new PrismaClient(), new PrismaClient()];
    const [n1, n2] = [new FakeNotifier(), new FakeNotifier()];
    try {
      await Promise.all([runAlertTick(c1, at(MIN), [n1]), runAlertTick(c2, at(MIN), [n2])]);
    } finally {
      await Promise.all([c1.$disconnect(), c2.$disconnect()]);
    }
    expect(await alertsOf(s.id)).toHaveLength(1);
    expect([...n1.forShipment(s.id), ...n2.forShipment(s.id)]).toHaveLength(1); // DUE goes to the CS only
  });

  it("completing the milestone resolves the alert immediately and stops further alerts", async () => {
    const s = await pickupShipment();
    await runAlertTick(prisma, at(MIN), [new FakeNotifier()]);
    await recordMilestone(prisma, s.id, { kind: "PICKED_UP", at: at(2 * MIN) }, cs, { now: at(2 * MIN), source: "WEB" });
    expect((await alertsOf(s.id))[0]).toMatchObject({ resolution: "COMPLETED" });
    await runAlertTick(prisma, at(3 * HOUR), [new FakeNotifier()]);
    expect(await alertsOf(s.id)).toHaveLength(1);
  });

  it("a moved deadline supersedes the old series and starts a new one", async () => {
    const s = await pickupShipment();
    await runAlertTick(prisma, at(MIN), [new FakeNotifier()]);
    const later = new Date(due.getTime() + DAY);
    await updateShipment(prisma, s.id, { ...input({ shipperId: f.shipper.id, assignedCsId: f.cs.id }), requestedPickupAt: later }, cs, { now: at(2 * MIN) });
    expect((await alertsOf(s.id))[0]).toMatchObject({ resolution: "SUPERSEDED" });
    await runAlertTick(prisma, at(3 * MIN), [new FakeNotifier()]);
    const a = await alertsOf(s.id);
    expect(a.at(-1)).toMatchObject({ level: "REMINDER", offsetMinutes: -1440, dueAt: later, resolvedAt: null });
  });

  it("creates no alerts after departure and marks open ones moot", async () => {
    const s = await pickupShipment();
    await runAlertTick(prisma, at(MIN), [new FakeNotifier()]);
    await recordMilestone(prisma, s.id, { kind: "DEPARTED", at: at(2 * MIN), eta: at(10 * DAY) }, cs, { now: at(2 * MIN), source: "WEB" });
    expect((await alertsOf(s.id))[0]).toMatchObject({ resolution: "MOOT" });
    await runAlertTick(prisma, at(5 * HOUR), [new FakeNotifier()]);
    expect(await alertsOf(s.id)).toHaveLength(1);
  });

  it("snooze holds back reminders but not overdue escalation", async () => {
    const s = await pickupShipment();
    await runAlertTick(prisma, at(-23 * HOUR), [new FakeNotifier()]);
    const [first] = await alertsOf(s.id);
    await snoozeAlert(prisma, first.id, f.cs.id, 24 * 60, at(-23 * HOUR));
    await runAlertTick(prisma, at(-3 * HOUR), [new FakeNotifier()]);
    expect(await alertsOf(s.id)).toHaveLength(1); // -240 reminder held back
    await runAlertTick(prisma, at(2 * HOUR), [new FakeNotifier()]);
    expect((await alertsOf(s.id)).at(-1)).toMatchObject({ level: "OVERDUE" });
  });

  it("records a channel failure without blocking the other channels", async () => {
    const s = await pickupShipment();
    const ok = new FakeNotifier("IN_APP");
    await runAlertTick(prisma, at(MIN), [ok, new FakeNotifier("EMAIL", true)]);
    const [a] = await alertsOf(s.id);
    expect(a.channels).toBe("IN_APP");
    expect(a.deliveryError).toMatch(/EMAIL .*SMTP down/);
    expect(ok.forShipment(s.id)).toHaveLength(1);
  });

  it("in-app notifications carry the alert's app time, and acknowledging covers the whole series", async () => {
    const s = await pickupShipment();
    await runAlertTick(prisma, at(-3 * HOUR), [new InAppNotifier(prisma)]);
    await runAlertTick(prisma, at(-30 * MIN), [new InAppNotifier(prisma)]);
    const notes = await prisma.notification.findMany({ where: { userId: f.cs.id, alert: { shipmentId: s.id } }, orderBy: { createdAt: "asc" } });
    expect(notes.map((n) => n.createdAt)).toEqual([at(-3 * HOUR), at(-30 * MIN)]);
    await acknowledgeAlert(prisma, notes[0].alertId!, f.cs.id, at(-29 * MIN));
    expect((await alertsOf(s.id)).every((a) => a.ackById === f.cs.id)).toBe(true);
  });

  it("sets the overdue / at-risk flags on the shipment", async () => {
    const s = await pickupShipment();
    await runAlertTick(prisma, at(-2 * HOUR), [new FakeNotifier()]);
    expect(await prisma.shipment.findUnique({ where: { id: s.id } })).toMatchObject({ atRisk: true, overdue: false });
    await runAlertTick(prisma, at(HOUR), [new FakeNotifier()]);
    expect(await prisma.shipment.findUnique({ where: { id: s.id } })).toMatchObject({ atRisk: false, overdue: true });
  });
});
