import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { saveRuleAction } from "./actions";

const LABEL: Record<string, string> = {
  PICKUP: "Pick-up", FSI: "FSI cut-off", PREADVISE: "Pre-advise cut-off", BOC_UPLOAD: "BOC portal upload", ARRASTRE: "Arrastre payment",
};
const FIELD_LABEL: Record<string, string> = {
  requestedPickupAt: "Requested pick-up", fsiCutoffAt: "FSI cut-off", preadviseCutoffAt: "Pre-advise cut-off", etdMnl: "ETD MNL",
};
const ORDER = ["PICKUP", "FSI", "PREADVISE", "BOC_UPLOAD", "ARRASTRE"];

export default async function RulesPage() {
  await requireUser(["SUPERVISOR"]);
  const rules = (await prisma.deadlineRule.findMany()).sort((a, b) => ORDER.indexOf(a.deadlineType) - ORDER.indexOf(b.deadlineType));
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Deadline rules</h1>
      <p className="max-w-3xl text-sm text-slate-600">
        When each deadline falls due and when alerts go out. Reminders go to the assigned CS; at the due time a DUE alert
        goes to the CS; after that, OVERDUE alerts go to the CS and all supervisors, repeating as set below.
        Saving recomputes deadlines on all open shipments.
      </p>
      {rules.map((r) => {
        const computed = r.deadlineType === "BOC_UPLOAD" || r.deadlineType === "ARRASTRE";
        const reminders = (r.reminderOffsets as number[]).map((m) => +(m / 60).toFixed(2)).join(", ");
        return (
          <section key={r.id} className="card">
            <ActionForm action={saveRuleAction} className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-6">
              <input type="hidden" name="deadlineType" value={r.deadlineType} />
              <div className="lg:col-span-6 flex flex-wrap items-baseline gap-3">
                <h2 className="font-semibold">{LABEL[r.deadlineType]}</h2>
                <label className="flex items-center gap-1 text-sm">
                  <input type="checkbox" name="enabled" defaultChecked={r.enabled} /> Alerts on
                </label>
                <span className="ml-auto text-xs text-slate-400">Last changed {formatDateTime(r.updatedAt)}</span>
              </div>
              {computed ? (
                <>
                  <label className="lg:col-span-2">
                    <span className="label">Due = this date…</span>
                    <select name="baseField" defaultValue={r.baseField} className="input">
                      {Object.entries(FIELD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </label>
                  <label>
                    <span className="label">…plus hours</span>
                    <input name="offsetHours" type="number" step="0.5" defaultValue={r.offsetMinutes / 60} className="input" />
                  </label>
                </>
              ) : (
                <p className="text-sm text-slate-600 lg:col-span-3">Due at the {FIELD_LABEL[r.baseField]?.toLowerCase()} time entered by CS.</p>
              )}
              <label>
                <span className="label">Remind hours before</span>
                <input name="reminderHours" defaultValue={reminders} placeholder="24, 4, 1" className="input" />
              </label>
              <label>
                <span className="label">Repeat overdue every (h)</span>
                <input name="overdueRepeatHours" type="number" step="0.5" min={0} defaultValue={r.overdueRepeatMinutes / 60} className="input" />
              </label>
              <label>
                <span className="label">Max overdue / day</span>
                <input name="overdueMaxPerDay" type="number" min={0} max={24} defaultValue={r.overdueMaxPerDay} className="input" />
              </label>
              <div className="lg:col-span-6"><button className="btn py-1.5">Save</button></div>
            </ActionForm>
          </section>
        );
      })}
    </div>
  );
}
