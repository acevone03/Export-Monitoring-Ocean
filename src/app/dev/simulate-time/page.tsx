import Link from "next/link";
import { getClockOffsetMs, now } from "@/lib/clock";
import { formatDateTime, toManilaInput } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { requireDevTools } from "../guard";
import { simulateAction } from "./actions";

const STEPS = [
  { label: "+30 min", minutes: 30 },
  { label: "+1 h", minutes: 60 },
  { label: "+4 h", minutes: 240 },
  { label: "+1 day", minutes: 1440 },
];

export default async function SimulateTimePage() {
  await requireDevTools();
  const offset = await getClockOffsetMs();
  const simulated = await now();
  const hours = offset / 3_600_000;

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-lg font-semibold">Simulate time <span className="text-sm font-normal text-amber-700">(dev only)</span></h1>
      <p className="text-sm text-slate-600">
        Moves the app&apos;s clock forward so deadlines turn amber and red and alerts fire, for demos. It affects
        deadlines, alerts and milestone times for everyone using this database, including the scheduler. Logins are not affected.
      </p>

      <div className="card grid gap-2 text-sm sm:grid-cols-3">
        <div><p className="label">Real time</p><p>{formatDateTime(new Date())}</p></div>
        <div><p className="label">App time</p><p className="font-semibold">{formatDateTime(simulated)}</p></div>
        <div><p className="label">Offset</p><p>{offset === 0 ? "none" : `${hours > 0 ? "+" : ""}${hours.toFixed(2)} h`}</p></div>
      </div>

      <section className="card space-y-3">
        <h2 className="font-medium">Move the clock</h2>
        <div className="flex flex-wrap gap-2">
          {STEPS.map((s) => (
            <ActionForm key={s.minutes} action={simulateAction}>
              <input type="hidden" name="op" value="add" />
              <input type="hidden" name="minutes" value={s.minutes} />
              <input type="hidden" name="tick" value="on" />
              <button className="btn-secondary">{s.label}</button>
            </ActionForm>
          ))}
        </div>
        <ActionForm action={simulateAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="op" value="set" />
          <input type="hidden" name="tick" value="on" />
          <label><span className="label">Jump to (Manila)</span><input type="datetime-local" name="at" defaultValue={toManilaInput(simulated)} className="input" /></label>
          <button className="btn-secondary">Jump</button>
        </ActionForm>
        <p className="text-xs text-slate-500">Each move also runs the alert check immediately, so you do not wait for the 5-minute scheduler.</p>
        <div className="flex flex-wrap gap-2">
          <ActionForm action={simulateAction}>
            <input type="hidden" name="op" value="tick" />
            <button className="btn">Run alert check now</button>
          </ActionForm>
          <ActionForm action={simulateAction}>
            <input type="hidden" name="op" value="reset" />
            <button className="btn-secondary">Reset to real time</button>
          </ActionForm>
        </div>
      </section>
      <p className="text-sm">
        <Link href="/dev/outbox" className="text-blue-700 hover:underline">Open the email outbox</Link> to see alert emails
        (used when SMTP is not configured). <Link href="/" className="text-blue-700 hover:underline">Back to the board</Link>.
      </p>
    </div>
  );
}
