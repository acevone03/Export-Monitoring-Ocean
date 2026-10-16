import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { now as clockNow } from "@/lib/clock";
import { formatDateTime } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { acknowledgeAction, snoozeAction, markAllReadAction } from "./actions";

const LEVEL_STYLE = {
  REMINDER: "bg-blue-100 text-blue-900",
  DUE: "bg-amber-100 text-amber-900",
  OVERDUE: "bg-red-100 text-red-900",
} as const;

const RESOLUTION_TEXT: Record<string, string> = {
  COMPLETED: "Done: step completed",
  SUPERSEDED: "Closed: deadline changed",
  MOOT: "Closed: shipment departed, cancelled or closed",
};

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const user = await requireUser(["CS", "SUPERVISOR"]);
  const { show } = await searchParams;
  const onlyOpen = show !== "all";
  const now = await clockNow();
  const all = await prisma.notification.findMany({
    where: { userId: user.id, ...(onlyOpen ? { alert: { resolvedAt: null } } : {}) },
    include: { alert: { include: { ackBy: { select: { name: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  // One card per deadline series (shipment + deadline + due time): the newest alert, plus how many came before.
  const seriesKey = (n: (typeof all)[number]) => (n.alert ? `${n.alert.shipmentId}|${n.alert.deadlineType}|${n.alert.dueAt.getTime()}` : n.id);
  const counts = new Map<string, number>();
  for (const n of all) counts.set(seriesKey(n), (counts.get(seriesKey(n)) ?? 0) + 1);
  const seen = new Set<string>();
  const items = all.filter((n) => !seen.has(seriesKey(n)) && seen.add(seriesKey(n)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Notifications</h1>
        <a href={onlyOpen ? "?show=all" : "?"} className="text-sm text-blue-700 hover:underline">
          {onlyOpen ? "Show resolved too" : "Show open only"}
        </a>
        <form action={markAllReadAction} className="ml-auto">
          <button className="btn-secondary py-1">Mark all read</button>
        </form>
      </div>
      <p className="text-sm text-slate-600">
        Alerts close only when the step is done. Acknowledge to show you have seen it; snooze to pause reminders.
      </p>
      {items.length === 0 && <div className="card text-sm text-slate-500">Nothing open. 🎉</div>}
      <ul className="space-y-2">
        {items.map((n) => {
          const a = n.alert;
          const snoozed = a?.snoozedUntil && a.snoozedUntil > now;
          return (
            <li key={n.id} className={`card flex flex-wrap items-start gap-3 ${n.readAt ? "opacity-80" : "border-l-4 border-l-blue-600"}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {a && <span className={`rounded px-2 py-0.5 text-xs font-semibold ${LEVEL_STYLE[a.level]}`}>{a.level}</span>}
                  <a href={`/notifications/open/${n.id}`} className="font-medium text-blue-800 hover:underline">{n.title}</a>
                </div>
                <p className="mt-1 text-sm text-slate-700">{n.body}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {formatDateTime(n.createdAt)}
                  {(counts.get(seriesKey(n)) ?? 1) > 1 && <> · {counts.get(seriesKey(n))} alerts for this deadline</>}
                  {a?.resolvedAt && <> · {RESOLUTION_TEXT[a.resolution ?? ""] ?? "Resolved"} {formatDateTime(a.resolvedAt)}</>}
                  {a?.ackAt && !a.resolvedAt && <> · Acknowledged by {a.ackBy?.name} {formatDateTime(a.ackAt)}</>}
                  {snoozed && !a?.resolvedAt && <> · Snoozed until {formatDateTime(a!.snoozedUntil)}</>}
                </p>
              </div>
              {a && !a.resolvedAt && (
                <div className="flex flex-wrap gap-2">
                  {!a.ackAt && (
                    <ActionForm action={acknowledgeAction}>
                      <input type="hidden" name="notificationId" value={n.id} />
                      <button className="btn-secondary py-1">Acknowledge</button>
                    </ActionForm>
                  )}
                  {[60, 240].map((m) => (
                    <ActionForm key={m} action={snoozeAction}>
                      <input type="hidden" name="notificationId" value={n.id} />
                      <input type="hidden" name="minutes" value={m} />
                      <button className="btn-secondary py-1">Snooze {m / 60}h</button>
                    </ActionForm>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
